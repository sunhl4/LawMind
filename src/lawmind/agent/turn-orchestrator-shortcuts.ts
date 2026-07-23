/**
 * Pre-loop short-circuits for runTurn: intake clarification gate + auto deliverable workflow.
 * Keeps turn-orchestrator focused on session setup and the model/tool loop.
 */

import type { MemoryContext } from "../memory/index.js";
import { resolveIntakeClarificationQuestions } from "../router/intake-gate.js";
import type { ClarificationQuestion } from "../types.js";
import {
  formatDeliverableWorkflowReply,
  shouldAutoRunDeliverableWorkflow,
} from "./deliverable-pipeline.js";
import { executeWorkflow } from "./tools/engine-tools.js";
import { buildClarificationReply, type RunTurnEvent } from "./turn-orchestrator-events.js";
import {
  finalizeAgentTurn,
  finishShortCircuitTurn,
  type TurnFinalizeShared,
} from "./turn-orchestrator-finalize.js";
import type { AgentContext, AgentMessage, AgentSession, AgentTurn } from "./types.js";

export type TurnRunResult = {
  turn: AgentTurn;
  reply: string;
  sessionId: string;
  memoryContext: MemoryContext;
};

/**
 * If intake gate needs structured answers, finalize as awaiting_clarification.
 * Returns null when the main model loop should continue.
 */
export function tryIntakeClarificationShortcut(opts: {
  instruction: string;
  session: AgentSession;
  turn: AgentTurn;
  shared: TurnFinalizeShared;
  actorId: string;
  resolvedAssistantId: string | undefined;
  modelName: string;
  caseMemory?: string;
  intakeHeuristicsEnabled?: boolean;
}): TurnRunResult | null {
  const intakeQs = resolveIntakeClarificationQuestions(opts.instruction, {
    caseMemory: opts.caseMemory,
    intakeHeuristicsEnabled: opts.intakeHeuristicsEnabled,
  });
  if (intakeQs.length === 0) {
    return null;
  }
  const reply = buildClarificationReply(
    "",
    intakeQs,
    "为少花几轮聊天、提高交件质量，请先确认以下要点（填完后我会继续执行）：",
  );
  const agentMsg: AgentMessage = {
    role: "assistant",
    content: reply,
    timestamp: new Date().toISOString(),
  };
  opts.session.conversationHistory.push(agentMsg);
  opts.turn.messages.push(agentMsg);
  opts.turn.status = "awaiting_clarification";
  opts.turn.clarificationQuestions = intakeQs;
  opts.turn.gateDecisions?.push({
    gate: "intake_gate",
    decision: "awaiting_confirmation",
    reason: "开干前待澄清要点。",
  });
  return finalizeAgentTurn({
    shared: opts.shared,
    finalReply: reply,
    pendingClarificationQuestions: intakeQs,
    turnUsage: undefined,
    actorId: opts.actorId,
    resolvedAssistantId: opts.resolvedAssistantId,
    modelName: opts.modelName,
  });
}

/**
 * ESG / general report draft verbs → one-shot execute_workflow without the model loop.
 * Returns a finished turn, or null when the caller should continue into the model loop
 * (including when auto-wf is ineligible or failed without a taskId).
 */
export async function tryAutoDeliverableWorkflowShortcut(opts: {
  instruction: string;
  session: AgentSession;
  ctx: AgentContext;
  shared: TurnFinalizeShared;
  emitEvent: (event: RunTurnEvent) => void;
  abortRequested: () => boolean;
  onAborted: () => TurnRunResult;
}): Promise<TurnRunResult | null> {
  if (!shouldAutoRunDeliverableWorkflow(opts.instruction)) {
    return null;
  }
  if (opts.abortRequested()) {
    return opts.onAborted();
  }

  const autoWfRound = 1;
  const autoWfToolId = "auto-deliverable-wf";
  opts.emitEvent({ type: "round_start", roundIndex: autoWfRound });
  opts.emitEvent({
    type: "tool_call_start",
    roundIndex: autoWfRound,
    toolCallId: autoWfToolId,
    toolName: "execute_workflow",
    args: { instruction: opts.instruction },
  });
  opts.ctx.emitToolProgress = (label) =>
    opts.emitEvent({
      type: "tool_progress",
      roundIndex: autoWfRound,
      toolCallId: autoWfToolId,
      toolName: "execute_workflow",
      label,
    });

  let wfResult: Awaited<ReturnType<typeof executeWorkflow.execute>>;
  try {
    wfResult = await executeWorkflow.execute(
      {
        instruction: opts.instruction,
        matter_id: opts.session.matterId,
        auto_approve: false,
      },
      opts.ctx,
    );
  } finally {
    opts.ctx.emitToolProgress = undefined;
  }

  if (opts.abortRequested()) {
    return opts.onAborted();
  }

  opts.emitEvent({
    type: "tool_call_end",
    roundIndex: autoWfRound,
    toolCallId: autoWfToolId,
    toolName: "execute_workflow",
    ok: wfResult.ok,
    error: wfResult.error,
  });

  const wfData =
    wfResult.data && typeof wfResult.data === "object"
      ? (wfResult.data as Record<string, unknown>)
      : {};
  const wfReply = formatDeliverableWorkflowReply({
    taskId: typeof wfData.taskId === "string" ? wfData.taskId : undefined,
    title: typeof wfData.title === "string" ? wfData.title : undefined,
    deliverableType:
      typeof wfData.deliverableType === "string" ? wfData.deliverableType : undefined,
    status: typeof wfData.status === "string" ? wfData.status : undefined,
    sectionsCount: typeof wfData.sectionsCount === "number" ? wfData.sectionsCount : undefined,
    steps: Array.isArray(wfData.steps) ? (wfData.steps as string[]) : undefined,
    outputPath: typeof wfData.outputPath === "string" ? wfData.outputPath : undefined,
    researchDegraded: wfData.researchDegraded === true,
    error: wfResult.ok ? undefined : wfResult.error,
  });

  if (wfResult.ok || typeof wfData.taskId === "string") {
    return finishShortCircuitTurn(opts.shared, wfReply);
  }
  return null;
}

/** Pure helper for tests / docs: whether intake would short-circuit. */
export function wouldIntakeClarify(
  instruction: string,
  opts?: { caseMemory?: string; intakeHeuristicsEnabled?: boolean },
): ClarificationQuestion[] {
  return resolveIntakeClarificationQuestions(instruction, opts);
}
