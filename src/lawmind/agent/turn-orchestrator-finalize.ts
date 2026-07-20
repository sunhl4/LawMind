/**
 * Turn short-circuit finish + finalization (status, requiresAction, persist, audit).
 * Extracted from turn-orchestrator.ts to keep the main loop readable.
 */

import { emit } from "../audit/index.js";
import type { MemoryContext } from "../memory/index.js";
import { maybeAutoAppendSessionSummary } from "../memory/session-summary.js";
import { recordModelUsage, type ModelUsageSnapshot } from "../models/model-usage.js";
import { emitPlatformGateSnapshot } from "../platform/audit-gate.js";
import { executionStateFromTurn } from "../platform/execution-state.js";
import { buildRequiresActionsFromTurn } from "../platform/requires-action.js";
import { persistAgentInstructionTask } from "../tasks/index.js";
import type { ClarificationQuestion } from "../types.js";
import { attachPersistedLiveTraceToLastAssistant } from "./live-turn-progress.js";
import { appendTurn, maybeUpdateSessionTitleFromInstruction, saveSession } from "./session.js";
import { buildClarificationReply, type RunTurnEvent } from "./turn-orchestrator-events.js";
import type { AgentMessage, AgentSession, AgentTurn } from "./types.js";

export type TurnFinalizeShared = {
  workspaceDir: string;
  session: AgentSession;
  turn: AgentTurn;
  emitEvent: (event: RunTurnEvent) => void;
  sessionTitleHint?: string;
  liveProgressKey: string | undefined;
  linkedTaskIdForCtx: string | undefined;
  memory: MemoryContext;
  ensureLiveProgressFinished: (status: "completed" | "failed") => void;
};

export function finishShortCircuitTurn(
  shared: TurnFinalizeShared,
  shortReply: string,
): {
  turn: AgentTurn;
  reply: string;
  sessionId: string;
  memoryContext: MemoryContext;
} {
  const {
    workspaceDir,
    session,
    turn,
    emitEvent,
    sessionTitleHint,
    liveProgressKey,
    linkedTaskIdForCtx,
    memory,
    ensureLiveProgressFinished,
  } = shared;

  const agentMsg: AgentMessage = {
    role: "assistant",
    content: shortReply,
    timestamp: new Date().toISOString(),
  };
  session.conversationHistory.push(agentMsg);
  turn.messages.push(agentMsg);
  turn.status = "completed";
  turn.result = shortReply;
  turn.completedAt = new Date().toISOString();
  emitEvent({ type: "round_start", roundIndex: 1 });
  emitEvent({ type: "delta", roundIndex: 1, text: shortReply });
  emitEvent({ type: "final", status: "completed", reply: shortReply });
  maybeUpdateSessionTitleFromInstruction(session, turn.instruction, sessionTitleHint);
  session.turns.push({
    turnId: turn.turnId,
    sessionId: turn.sessionId,
    instruction: turn.instruction,
    messages: turn.messages,
    toolCallsExecuted: 0,
    status: turn.status,
    gateDecisions: turn.gateDecisions,
    executionState: {
      ...executionStateFromTurn(turn),
      linkedTaskId: linkedTaskIdForCtx,
    },
    result: turn.result,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
  });
  appendTurn(workspaceDir, turn);
  ensureLiveProgressFinished("completed");
  if (liveProgressKey) {
    attachPersistedLiveTraceToLastAssistant(session, liveProgressKey, {
      ...executionStateFromTurn(turn),
      linkedTaskId: linkedTaskIdForCtx,
    });
  }
  saveSession(workspaceDir, session);
  return { turn, reply: shortReply, sessionId: session.sessionId, memoryContext: memory };
}

export function finalizeAgentTurn(opts: {
  shared: TurnFinalizeShared;
  finalReply: string;
  pendingClarificationQuestions: ClarificationQuestion[];
  turnUsage: ModelUsageSnapshot | undefined;
  actorId: string;
  resolvedAssistantId: string | undefined;
  modelName: string;
}): {
  turn: AgentTurn;
  reply: string;
  sessionId: string;
  memoryContext: MemoryContext;
} {
  const {
    shared,
    pendingClarificationQuestions,
    turnUsage,
    actorId,
    resolvedAssistantId,
    modelName,
  } = opts;
  let { finalReply } = opts;
  const {
    workspaceDir,
    session,
    turn,
    emitEvent,
    sessionTitleHint,
    liveProgressKey,
    linkedTaskIdForCtx,
    memory,
    ensureLiveProgressFinished,
  } = shared;

  turn.result = finalReply;
  turn.completedAt = new Date().toISOString();

  if (turn.status === "running") {
    if (pendingClarificationQuestions.length > 0) {
      turn.status = "awaiting_clarification";
      turn.gateDecisions?.push({
        gate: "clarification_gate",
        decision: "awaiting_confirmation",
        reason: "本轮含待澄清问题。",
      });
      turn.clarificationQuestions = pendingClarificationQuestions;
      if (!turn.result?.trim()) {
        turn.result = buildClarificationReply("", pendingClarificationQuestions);
        finalReply = turn.result;
      }
    } else {
      turn.status = "completed";
    }
  }

  if (turn.status === "awaiting_clarification" && turn.clarificationQuestions?.length) {
    session.pendingClarificationKeys = turn.clarificationQuestions.map((q) => q.key);
    emitEvent({ type: "clarification", questions: turn.clarificationQuestions });
  } else {
    delete session.pendingClarificationKeys;
  }
  emitEvent({ type: "final", status: turn.status, reply: turn.result ?? "" });
  turn.executionState = {
    ...executionStateFromTurn(turn),
    linkedTaskId: linkedTaskIdForCtx,
  };

  turn.requiresAction = buildRequiresActionsFromTurn({
    status: turn.status,
    clarificationQuestions: turn.clarificationQuestions,
    turnId: turn.turnId,
    sessionId: turn.sessionId,
    matterId: session.matterId,
    pendingToolApproval: turn.pendingToolApproval,
  });
  if (turn.requiresAction.length > 0) {
    session.pendingRequiresAction = turn.requiresAction;
  } else {
    delete session.pendingRequiresAction;
  }

  maybeUpdateSessionTitleFromInstruction(session, turn.instruction, sessionTitleHint);

  session.turns.push({
    turnId: turn.turnId,
    sessionId: turn.sessionId,
    instruction: turn.instruction,
    messages: [],
    toolCallsExecuted: turn.toolCallsExecuted,
    status: turn.status,
    clarificationQuestions: turn.clarificationQuestions,
    gateDecisions: turn.gateDecisions,
    executionState: turn.executionState,
    requiresAction: turn.requiresAction,
    pendingToolApproval: turn.pendingToolApproval,
    result: turn.result,
    error: turn.error,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
  });

  ensureLiveProgressFinished(turn.status === "error" ? "failed" : "completed");
  if (liveProgressKey) {
    attachPersistedLiveTraceToLastAssistant(session, liveProgressKey, turn.executionState);
  }
  if (turnUsage) {
    turn.modelUsage = turnUsage;
  }
  saveSession(workspaceDir, session);
  appendTurn(workspaceDir, turn);
  if (turn.status === "completed" || turn.status === "awaiting_clarification") {
    maybeAutoAppendSessionSummary(workspaceDir, session, turn);
    saveSession(workspaceDir, session);
  }

  if (turnUsage && turn.status !== "error") {
    try {
      recordModelUsage(workspaceDir, {
        sessionId: session.sessionId,
        turnId: turn.turnId,
        matterId: session.matterId,
        model: modelName,
        promptTokens: turnUsage.promptTokens,
        completionTokens: turnUsage.completionTokens,
        totalTokens: turnUsage.totalTokens,
      });
    } catch {
      /* ledger is best-effort */
    }
  }

  if (turn.status !== "error") {
    try {
      persistAgentInstructionTask(workspaceDir, {
        taskId: turn.turnId,
        instruction: turn.instruction,
        sessionId: session.sessionId,
        matterId: session.matterId,
        assistantId: resolvedAssistantId,
      });
    } catch {
      /* ignore disk errors; chat result still returned */
    }
  }

  void emit(`${workspaceDir}/audit`, {
    kind: "agent_turn",
    actor: "model",
    actorId,
    detail: `turn=${turn.turnId} tools=${turn.toolCallsExecuted} status=${turn.status}`,
    taskId: turn.turnId,
  });

  if (turn.executionState || (turn.gateDecisions?.length ?? 0) > 0) {
    void emitPlatformGateSnapshot(`${workspaceDir}/audit`, {
      taskId: turn.turnId,
      source: "agent_turn",
      actor: "model",
      actorId,
      executionState: turn.executionState,
      gateDecisions: turn.gateDecisions,
      context: { status: turn.status },
    });
  }

  return {
    turn,
    reply: turn.result ?? finalReply,
    sessionId: session.sessionId,
    memoryContext: memory,
  };
}

export function cleanupFailedTurn(opts: {
  workspaceDir: string;
  session: AgentSession;
  turn: AgentTurn;
  liveProgressKey: string | undefined;
  ensureLiveProgressFinished: (status: "completed" | "failed") => void;
}): void {
  const { workspaceDir, session, turn, liveProgressKey, ensureLiveProgressFinished } = opts;
  ensureLiveProgressFinished("failed");
  if (liveProgressKey) {
    attachPersistedLiveTraceToLastAssistant(session, liveProgressKey, turn.executionState);
  }
  try {
    saveSession(workspaceDir, session);
  } catch {
    /* ignore disk errors */
  }
}
