/**
 * Pre-loop short-circuits for runTurn: intake clarification gate + auto deliverable workflow.
 * Keeps turn-orchestrator focused on session setup and the model/tool loop.
 */

import type { MemoryContext } from "../memory/index.js";
import { resolveIntakeClarificationQuestions } from "../router/intake-gate.js";
import type { ToolCallContext } from "../runtime/tool-pipeline.js";
import type { RiskLevel } from "../types.js";
import type { ClarificationQuestion } from "../types.js";
import {
  formatDeliverableWorkflowReply,
  shouldAutoRunDeliverableWorkflow,
} from "./deliverable-pipeline.js";
import type { executeWorkflow } from "./tools/engine-tools.js";
import type { ToolRegistry } from "./tools/registry.js";
import { buildClarificationReply, type RunTurnEvent } from "./turn-orchestrator-events.js";
import {
  finalizeAgentTurn,
  finishShortCircuitTurn,
  type TurnFinalizeShared,
} from "./turn-orchestrator-finalize.js";
import { getRunToolPipeline } from "./turn-orchestrator-tool-round.js";
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
  hasContextPins?: boolean;
}): TurnRunResult | null {
  const intakeQs = resolveIntakeClarificationQuestions(opts.instruction, {
    caseMemory: opts.caseMemory,
    intakeHeuristicsEnabled: opts.intakeHeuristicsEnabled,
    hasContextPins: opts.hasContextPins,
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
    category: "safety_hard",
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
  turn: AgentTurn;
  registry: ToolRegistry;
  shared: TurnFinalizeShared;
  emitEvent: (event: RunTurnEvent) => void;
  abortRequested: () => boolean;
  onAborted: () => TurnRunResult;
  autoDeliverableWorkflow?: boolean;
  actorId: string;
  maxToolCalls: number;
  toolTimeoutMs: number;
  strictDangerousToolApproval: boolean;
  allowDangerousToolsWithoutApproval: boolean;
  toolSandboxEnabled: boolean;
  allowedToolNames?: string[];
  roleId?: string;
  riskCeiling?: RiskLevel;
}): Promise<TurnRunResult | null> {
  if (
    !shouldAutoRunDeliverableWorkflow(opts.instruction, {
      policy: { autoDeliverableWorkflow: opts.autoDeliverableWorkflow },
    })
  ) {
    return null;
  }
  if (opts.abortRequested()) {
    return opts.onAborted();
  }

  const autoWfRound = 1;
  const autoWfToolId = "auto-deliverable-wf";
  const toolArgs: Record<string, unknown> = {
    instruction: opts.instruction,
    matter_id: opts.session.matterId,
    auto_approve: false,
  };
  opts.emitEvent({ type: "round_start", roundIndex: autoWfRound });
  opts.emitEvent({
    type: "tool_call_start",
    roundIndex: autoWfRound,
    toolCallId: autoWfToolId,
    toolName: "execute_workflow",
    args: toolArgs,
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
    // 与模型循环同一条 tool-pipeline：approval / clarification / budget / audit /
    // timeout 全部生效——shortcut 不再是绕过治理的后门（strict 版下会正常
    // 落入 awaiting_approval，而不是静默执行）。
    opts.turn.toolCallsExecuted++;
    const callCtx: ToolCallContext = {
      toolCallId: autoWfToolId,
      toolName: "execute_workflow",
      args: toolArgs,
      tool: opts.registry.get("execute_workflow"),
      ctx: opts.ctx,
      turn: { turnId: opts.turn.turnId },
      policy: {
        usedToolCalls: opts.turn.toolCallsExecuted,
        maxToolCalls: opts.maxToolCalls,
        toolTimeoutMs: opts.toolTimeoutMs,
        strictDangerousToolApproval: opts.strictDangerousToolApproval,
        allowDangerousToolsWithoutApproval: opts.allowDangerousToolsWithoutApproval,
        toolSandboxEnabled: opts.toolSandboxEnabled,
        allowedToolNames: opts.allowedToolNames,
        roleId: opts.roleId,
        riskCeiling: opts.riskCeiling,
        actorId: opts.actorId,
        auditDir: `${opts.ctx.workspaceDir}/audit`,
        sessionMatterId: opts.session.matterId,
        sessionAssistantId: opts.session.assistantId,
      },
    };
    wfResult = await getRunToolPipeline()(callCtx);
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

  // 审批门禁（strict 版）：与模型循环同语义，挂起等律师拍板。
  if (wfResult.approvalRequest) {
    opts.turn.gateDecisions?.push({
      gate: "approval_gate",
      decision: "awaiting_confirmation",
      reason: "执行完整工作流需要律师在「待我拍板」中确认。",
    });
    opts.turn.status = "awaiting_approval";
    if (!opts.turn.pendingToolApproval) {
      opts.turn.pendingToolApproval = {
        toolName: "execute_workflow",
        toolCallId: autoWfToolId,
        toolArgs,
      };
    }
    return finishShortCircuitTurn(opts.shared, "执行完整工作流需要您的确认。批准后将自动继续。");
  }

  // 澄清门禁：交回模型循环，由模型按澄清流程与律师对齐（而非直接报错收尾）。
  if (!wfResult.ok && typeof wfResult.error === "string" && wfResult.error.includes("待澄清")) {
    return null;
  }

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
