/**
 * Turn short-circuit finish + finalization (status, requiresAction, persist, audit).
 * Extracted from turn-orchestrator.ts to keep the main loop readable.
 */

import { emit } from "../audit/index.js";
import type { MemoryContext } from "../memory/index.js";
import { maybeAutoAppendSessionSummary } from "../memory/session-summary.js";
import { recordModelUsage, type ModelUsageSnapshot } from "../models/model-usage.js";
import { emitPlatformGateSnapshot } from "../platform/audit-gate.js";
import { syncDispatchLedgerForTurn } from "../platform/automation-dispatch-ledger.js";
import { executionStateFromTurn } from "../platform/execution-state.js";
import { detectGateStop } from "../platform/gate-stop.js";
import { buildJudgmentEscalationForTask } from "../platform/judgment-escalation.js";
import { buildRequiresActionsFromTurn } from "../platform/requires-action.js";
import {
  isLawyerEscalationAvailable,
  resolveEscalationPosture,
} from "../policy/judgment-tiering.js";
import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import { selectHardClarificationKeys } from "../router/intake-gate.js";
import { collapseSameTurnVerifyHistoryForTurnEnd } from "../runtime/same-turn-verify.js";
import { persistAgentInstructionTask } from "../tasks/index.js";
import type { ClarificationQuestion } from "../types.js";
import { markWorkNeedsLawyer } from "../work/store.js";
import { attachPersistedLiveTraceToLastAssistant } from "./live-turn-progress.js";
import { inspectPersistedSessionHistoryAlignment } from "./session-history-alignment.js";
import {
  appendTurn,
  maybeUpdateSessionTitleFromInstruction,
  saveSession,
  upsertSessionTurn,
} from "./session.js";
import { buildClarificationReply, type RunTurnEvent } from "./turn-orchestrator-events.js";
import type { AgentMessage, AgentSession, AgentTurn } from "./types.js";

function auditSessionHistoryAlignment(
  workspaceDir: string,
  session: AgentSession,
  actorId: string,
  turnId: string,
): void {
  try {
    const alignment = inspectPersistedSessionHistoryAlignment(workspaceDir, session);
    if (alignment.ok) {
      return;
    }
    void emit(`${workspaceDir}/audit`, {
      kind: "agent_turn",
      actor: "system",
      actorId,
      detail: `session_history_drift ${JSON.stringify(alignment.issues)}`,
      taskId: turnId,
    });
  } catch {
    /* inspect never blocks the turn */
  }
}

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
  upsertSessionTurn(session, {
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
  auditSessionHistoryAlignment(workspaceDir, session, "system", turn.turnId);
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

  collapseSameTurnVerifyHistoryForTurnEnd(session, turn);

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
    const hardKeys = selectHardClarificationKeys(turn.clarificationQuestions.map((q) => q.key));
    if (hardKeys.length > 0) {
      session.pendingClarificationKeys = hardKeys;
    } else {
      delete session.pendingClarificationKeys;
    }
    emitEvent({ type: "clarification", questions: turn.clarificationQuestions });
  } else {
    delete session.pendingClarificationKeys;
  }
  emitEvent({ type: "final", status: turn.status, reply: turn.result ?? "" });
  turn.executionState = {
    ...executionStateFromTurn(turn),
    linkedTaskId: linkedTaskIdForCtx,
  };

  // 门禁已判停：本件转「待律师」，缺口进待办（在办/待拍板可见），
  // 否则同一份材料会被自动化反复重派、律师也找不到「在等我什么」。
  const gateStop = detectGateStop({
    gateDecisions: turn.gateDecisions,
    sameTurnVerify: turn.sameTurnVerify,
  });

  turn.requiresAction = buildRequiresActionsFromTurn({
    status: turn.status,
    clarificationQuestions: turn.clarificationQuestions,
    turnId: turn.turnId,
    sessionId: turn.sessionId,
    toolCallsExecuted: turn.toolCallsExecuted,
    matterId: session.matterId,
    pendingToolApproval: turn.pendingToolApproval,
    ...(gateStop.stopped ? { gateStop } : {}),
  });

  /**
   * G3：判断项升级卡。
   *
   * 只在**通道已接通 + 姿态为 block** 时并入 `requiresAction`。
   * `advisory`（solo 缺省）时**不打断**——卡片由审核台按需展示，
   * 不进 `pendingRequiresAction`，否则单人执业每件都会被拦。
   *
   * 必须用同一个 `linkedTaskIdForCtx`：Guardian 落 sidecar 用的就是它。
   *
   * 策略**按工作区策略文件解析**（`policy` 显式 → env → edition 缺省）。此前这里是
   * 无参调用，等于把解析顺序的第一档整条丢掉：`lawmind.policy.json` 里的
   * `judgmentEscalation` / `judgmentEscalationPosture` / `edition` 都不生效，
   * 只有 env 说话。同一条解析必须与 Guardian 侧（`guardian/run.ts`）和本地路由
   * （`server/lawmind-server-route-judgment.ts`）同源，否则会出现
   * 「通道算开（摘项）但没人收」（或反过来）的静默缺口。
   */
  if (linkedTaskIdForCtx) {
    const judgmentPolicy = readWorkspacePolicyFile(workspaceDir);
    if (
      isLawyerEscalationAvailable({ policy: judgmentPolicy }) &&
      resolveEscalationPosture({ policy: judgmentPolicy }) === "block"
    ) {
      const escalation = buildJudgmentEscalationForTask({
        workspaceDir,
        taskId: linkedTaskIdForCtx,
        sessionId: session.sessionId,
        ...(session.matterId ? { matterId: session.matterId } : {}),
      });
      if (escalation) {
        turn.requiresAction = [...turn.requiresAction, escalation];
      }
    }
  }

  if (turn.requiresAction.length > 0) {
    session.pendingRequiresAction = turn.requiresAction;
  } else {
    delete session.pendingRequiresAction;
  }

  maybeUpdateSessionTitleFromInstruction(session, turn.instruction, sessionTitleHint);

  if (gateStop.stopped) {
    try {
      markWorkNeedsLawyer(workspaceDir, {
        sessionId: session.sessionId,
        taskId: turn.turnId,
        matterId: session.matterId,
        reason: gateStop.reason ?? (gateStop.gaps ?? []).join("；"),
      });
    } catch {
      /* 本件状态是尽力而为，不影响对话结果 */
    }
  }
  // 防重复派单：门禁停下→记账拦截；正常收口→解除（律师继续推进即恢复派单）。
  syncDispatchLedgerForTurn({
    workspaceDir,
    matterId: session.matterId,
    instruction: turn.instruction,
    gateStop: gateStop.stopped,
    ...(gateStop.reason ? { reason: gateStop.reason } : {}),
  });

  upsertSessionTurn(session, {
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
  auditSessionHistoryAlignment(workspaceDir, session, actorId, turn.turnId);

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
