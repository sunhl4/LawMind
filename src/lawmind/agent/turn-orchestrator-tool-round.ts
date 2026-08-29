/**
 * Tool-round execution for the agent turn loop (extracted from turn-orchestrator).
 *
 * Hardening (P1-3):
 * - First-wins for pendingToolApproval under concurrent batches
 * - Stop further batches once awaiting_approval
 */

import type { GateDecision, GateDecisionKind, GateCategory } from "../platform/contracts.js";
import { withGateCategory } from "../platform/gate-category.js";
import {
  getMaxToolUseConcurrency,
  partitionToolCalls,
  type ToolCallRef,
} from "../runtime/tool-concurrency.js";
import {
  DISCOVERY_LOOP_TOOL_LIMITS,
  buildDefaultToolPipeline,
  composeToolPipeline,
  wouldHitDiscoveryCap,
  type ToolCallContext,
} from "../runtime/tool-pipeline.js";
import type { RiskLevel } from "../types.js";
import type { ClarificationQuestion } from "../types.js";
import { resolvePreApprovalInjection } from "./approval-cache-key.js";
import { presentLawyerToolResult } from "./tool-lawyer-card.js";
import {
  stringifyToolResultForHistory,
  summarizeToolResultForHistory,
} from "./tool-result-history.js";
import { shouldSpillToolResult } from "./tool-result-spill.js";
import type { ToolRegistry } from "./tools/registry.js";
import {
  extractClarificationQuestions,
  extractToolErrorMessage,
  type RunTurnEvent,
} from "./turn-orchestrator-events.js";
import type { AgentContext, AgentMessage, AgentTurn } from "./types.js";

/** Lazy: avoids TDZ when tool-pipeline ↔ legal-tools ↔ turn-orchestrator cycle loads. */
let runToolPipeline: ReturnType<typeof composeToolPipeline> | undefined;
export function getRunToolPipeline(): ReturnType<typeof composeToolPipeline> {
  if (!runToolPipeline) {
    runToolPipeline = composeToolPipeline(buildDefaultToolPipeline());
  }
  return runToolPipeline;
}

export type ToolRoundPolicyHints = {
  allowedToolNames?: string[];
  allowlistDenyHint?: string;
  roleId?: string;
  riskCeiling?: RiskLevel;
  autoApproveSandboxWorkflowSteps?: boolean;
};

const GATE_KINDS = new Set<GateDecisionKind>([
  "clarification_gate",
  "intake_gate",
  "dangerous_tool_gate",
  "approval_gate",
  "acceptance_gate",
  "reasoning_gate",
  "redline_hunks_gate",
  "surgical_span_gate",
  "citation_integrity_gate",
  "outbound_privilege_gate",
  "outbound_recipient_gate",
]);

/** Exported for unit tests — pull categorized gateDecision off tool `data`. */
export function extractGateDecisionFromToolResult(result: {
  data?: unknown;
}): GateDecision | undefined {
  const data = result.data;
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const raw = (data as { gateDecision?: unknown }).gateDecision;
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const g = raw as {
    gate?: unknown;
    decision?: unknown;
    reason?: unknown;
    category?: unknown;
  };
  if (typeof g.gate !== "string" || !GATE_KINDS.has(g.gate as GateDecisionKind)) {
    return undefined;
  }
  if (g.decision !== "allow" && g.decision !== "block" && g.decision !== "awaiting_confirmation") {
    return undefined;
  }
  return withGateCategory({
    gate: g.gate as GateDecisionKind,
    decision: g.decision,
    ...(typeof g.reason === "string" ? { reason: g.reason } : {}),
    ...(g.category === "safety_hard" || g.category === "judgment_soft"
      ? { category: g.category as GateCategory }
      : {}),
  });
}

/** Tools eligible for C3 sandbox auto-approve (never render / mail). */
const SANDBOX_AUTO_APPROVE_TOOLS = new Set(["execute_workflow", "draft_document"]);

/** Pure gate for C3 (exported for unit tests). */
export function shouldPreApproveSandboxWorkflowStep(opts: {
  autoApproveSandboxWorkflowSteps?: boolean;
  toolSandboxEnabled?: boolean;
  toolName: string;
  strictDangerousToolApproval?: boolean;
}): boolean {
  return (
    opts.autoApproveSandboxWorkflowSteps === true &&
    opts.toolSandboxEnabled === true &&
    SANDBOX_AUTO_APPROVE_TOOLS.has(opts.toolName) &&
    opts.strictDangerousToolApproval !== true
  );
}

export type ExecuteToolBatchesParams = {
  toolRefs: ToolCallRef[];
  registry: ToolRegistry;
  turn: AgentTurn;
  ctx: AgentContext;
  roundIndex: number;
  assistantContent: string;
  maxToolCalls: number;
  toolTimeoutMs: number;
  strictDangerousToolApproval: boolean;
  allowDangerousToolsWithoutApproval: boolean;
  toolSandboxEnabled: boolean;
  policyHints?: ToolRoundPolicyHints;
  actorId: string;
  sessionMatterId?: string;
  sessionAssistantId?: string;
  pendingClarificationQuestions: ClarificationQuestion[];
  emitEvent: (event: RunTurnEvent) => void;
  pushMessage: (msg: AgentMessage) => void;
  /** Stop pressed: skip tools that have not started; in-flight ones see ctx.abortSignal. */
  abortRequested?: () => boolean;
};

export type ExecuteToolBatchesResult = {
  stoppedForApproval: boolean;
  /** Batch had approval/clarification — no tool results were written to history. */
  heldForElicitation: boolean;
  pendingClarificationQuestions: ClarificationQuestion[];
  finalReply?: string;
};

type StagedToolOutcome = {
  toolResponseMsg: AgentMessage;
  clarificationQuestions: ClarificationQuestion[];
  pendingApproval: boolean;
  toolName: string;
  toolCallId: string;
  toolArgs: Record<string, unknown>;
};

function outcomeNeedsElicitation(outcome: StagedToolOutcome): boolean {
  return outcome.pendingApproval || outcome.clarificationQuestions.length > 0;
}

export async function executeToolBatches(
  params: ExecuteToolBatchesParams,
): Promise<ExecuteToolBatchesResult> {
  const {
    toolRefs,
    registry,
    turn,
    ctx,
    roundIndex,
    assistantContent,
    maxToolCalls,
    toolTimeoutMs,
    strictDangerousToolApproval,
    allowDangerousToolsWithoutApproval,
    toolSandboxEnabled,
    policyHints,
    actorId,
    sessionMatterId,
    sessionAssistantId,
    emitEvent,
    pushMessage,
    abortRequested,
  } = params;

  let pendingClarificationQuestions = params.pendingClarificationQuestions;
  let finalReply: string | undefined;
  let heldForElicitation = false;

  const isAborted = (): boolean => abortRequested?.() === true || ctx.abortSignal?.aborted === true;

  const skipToolDueToAbort = (ref: ToolCallRef): void => {
    emitEvent({
      type: "tool_call_start",
      roundIndex,
      toolCallId: ref.id,
      toolName: ref.name,
      args: { ...ref.arguments },
    });
    emitEvent({
      type: "tool_call_end",
      roundIndex,
      toolCallId: ref.id,
      toolName: ref.name,
      ok: false,
      error: "已停止",
      resultPreview: "已停止",
    });
    pushMessage({
      role: "tool",
      content: stringifyToolResultForHistory({ ok: false, error: "已停止", aborted: true }),
      toolCallResponses: [
        {
          toolCallId: ref.id,
          name: ref.name,
          result: { ok: false, error: "已停止", aborted: true },
        },
      ],
      timestamp: new Date().toISOString(),
    });
  };

  const toolBatches = partitionToolCalls(toolRefs, registry);
  toolBatchLoop: for (const batch of toolBatches) {
    const commitStagedBatch = (staged: StagedToolOutcome[]): boolean => {
      const needsElicitation = staged.some(outcomeNeedsElicitation);
      if (needsElicitation) {
        heldForElicitation = true;
      }
      // Barrier: publish the whole batch together so a later sample never sees a prefix.
      for (const outcome of staged) {
        pushMessage(outcome.toolResponseMsg);
        if (outcome.clarificationQuestions.length > 0) {
          pendingClarificationQuestions = outcome.clarificationQuestions;
        }
        if (outcome.pendingApproval) {
          const gateDecision: GateDecision = {
            gate: "approval_gate",
            decision: "awaiting_confirmation",
            reason: `工具 ${outcome.toolName} 返回 pendingApproval`,
            category: "safety_hard",
          };
          turn.gateDecisions?.push(gateDecision);
          turn.status = "awaiting_approval";
          if (!turn.pendingToolApproval) {
            turn.pendingToolApproval = {
              toolName: outcome.toolName,
              toolCallId: outcome.toolCallId,
              toolArgs: outcome.toolArgs,
            };
            finalReply = assistantContent || `操作 ${outcome.toolName} 需要您的确认。`;
          }
        }
      }
      return turn.status === "awaiting_approval";
    };

    const runOne = async (ref: ToolCallRef): Promise<StagedToolOutcome> => {
      const tc = {
        id: ref.id,
        function: { name: ref.name, arguments: JSON.stringify(ref.arguments) },
      };
      // 跨轮门禁（orchestrator 依据 session.pendingClarificationKeys 置位）不能被
      // 本轮重置；同轮工具返回澄清时再置位。
      ctx.clarificationBlockingHeavyTools =
        ctx.clarificationBlockingHeavyTools || pendingClarificationQuestions.length > 0;
      turn.toolCallsExecuted++;

      const toolName = tc.function.name;
      const toolNameCallCountsBefore = { ...turn.toolNameCallCounts };
      turn.toolNameCallCounts = turn.toolNameCallCounts ?? {};
      turn.toolNameCallCounts[toolName] = (turn.toolNameCallCounts[toolName] ?? 0) + 1;
      const toolArgs = { ...ref.arguments };
      const hideFromLiveTrace = wouldHitDiscoveryCap(toolName, toolNameCallCountsBefore);
      const preApproval = resolvePreApprovalInjection({
        toolName,
        modelArgs: toolArgs,
        preApproveToolName: ctx.preApproveToolName,
        preApproveToolArgs: ctx.preApproveToolArgs,
        preApproveToolNames: ctx.preApproveToolNames,
      });
      if (preApproval.inject) {
        if (preApproval.mergedArgs) {
          Object.assign(toolArgs, preApproval.mergedArgs);
        }
        toolArgs.__approved = true;
      } else if (
        shouldPreApproveSandboxWorkflowStep({
          autoApproveSandboxWorkflowSteps: policyHints?.autoApproveSandboxWorkflowSteps,
          toolSandboxEnabled,
          toolName,
          strictDangerousToolApproval,
        })
      ) {
        // C3: Solo/opt-in sandbox steps — never when Firm strict approval is on.
        toolArgs.__approved = true;
      }
      if (!hideFromLiveTrace) {
        emitEvent({
          type: "tool_call_start",
          roundIndex,
          toolCallId: tc.id,
          toolName,
          args: toolArgs,
        });
      }
      ctx.emitToolProgress = hideFromLiveTrace
        ? undefined
        : (label: string) => {
            emitEvent({
              type: "tool_progress",
              roundIndex,
              toolCallId: tc.id,
              toolName,
              label,
            });
          };
      const callCtx: ToolCallContext = {
        toolCallId: tc.id,
        toolName,
        args: toolArgs,
        tool: registry.get(toolName),
        ctx,
        turn: { turnId: turn.turnId },
        policy: {
          usedToolCalls: turn.toolCallsExecuted,
          maxToolCalls,
          toolTimeoutMs,
          strictDangerousToolApproval,
          allowDangerousToolsWithoutApproval,
          toolSandboxEnabled,
          allowedToolNames: policyHints?.allowedToolNames,
          allowlistDenyHint: policyHints?.allowlistDenyHint,
          roleId: policyHints?.roleId,
          riskCeiling: policyHints?.riskCeiling,
          toolNameCallCounts: toolNameCallCountsBefore,
          actorId,
          auditDir: `${ctx.workspaceDir}/audit`,
          sessionMatterId,
          sessionAssistantId,
        },
      };
      const result = await getRunToolPipeline()(callCtx);
      if (!result.ok) {
        if (DISCOVERY_LOOP_TOOL_LIMITS[toolName] != null) {
          const nextCount = (turn.toolNameCallCounts[toolName] ?? 1) - 1;
          if (nextCount <= 0) {
            delete turn.toolNameCallCounts[toolName];
          } else {
            turn.toolNameCallCounts[toolName] = nextCount;
          }
        }
      }
      const { authorityGapFromToolResult, demoCorpusFromToolResult } =
        await import("../retrieval/authority-gap.js");
      const nextActionsRaw =
        result.data &&
        typeof result.data === "object" &&
        Array.isArray((result.data as { nextActions?: unknown }).nextActions)
          ? (result.data as { nextActions: unknown[] }).nextActions.filter(
              (x): x is string => typeof x === "string" && x.trim().length > 0,
            )
          : [];
      const resultCard = presentLawyerToolResult(toolName, toolArgs, result);
      if (!hideFromLiveTrace) {
        emitEvent({
          type: "tool_call_end",
          roundIndex,
          toolCallId: tc.id,
          toolName,
          ok: result.ok,
          error: result.ok ? undefined : extractToolErrorMessage(result),
          ...(authorityGapFromToolResult(result) ? { authorityGap: true } : {}),
          ...(demoCorpusFromToolResult(result) ? { demoCorpus: true } : {}),
          ...(nextActionsRaw.length > 0 ? { nextActions: nextActionsRaw } : {}),
          ...(resultCard.detail ? { resultPreview: resultCard.detail } : {}),
        });
      }
      ctx.emitToolProgress = undefined;

      const historyResult = summarizeToolResultForHistory(result, {
        spill: shouldSpillToolResult(toolName)
          ? {
              workspaceDir: ctx.workspaceDir,
              sessionId: ctx.sessionId,
              callId: tc.id,
              toolName,
            }
          : undefined,
      });
      const toolResponseMsg: AgentMessage = {
        role: "tool",
        content: stringifyToolResultForHistory(historyResult),
        toolCallResponses: [{ toolCallId: tc.id, name: toolName, result: historyResult }],
        timestamp: new Date().toISOString(),
      };

      const clarificationQuestions = extractClarificationQuestions(result);
      const toolGate = extractGateDecisionFromToolResult(result);
      if (toolGate) {
        turn.gateDecisions?.push(toolGate);
      }

      return {
        toolResponseMsg,
        clarificationQuestions,
        pendingApproval: result.pendingApproval === true,
        toolName,
        toolCallId: tc.id,
        toolArgs,
      };
    };

    if (batch.concurrencySafe && batch.calls.length > 1) {
      // 并发批按上限分片（LAWMIND_MAX_TOOL_CONCURRENCY，默认 4），避免模型一次
      // 抛出大量只读调用时对磁盘/检索/模型端造成无节流压力。
      const cap = Math.max(1, getMaxToolUseConcurrency());
      for (let i = 0; i < batch.calls.length; i += cap) {
        const slice = batch.calls.slice(i, i + cap);
        if (isAborted()) {
          for (const ref of slice) {
            skipToolDueToAbort(ref);
          }
          continue;
        }
        const staged = await Promise.all(slice.map((ref) => runOne(ref)));
        if (commitStagedBatch(staged)) {
          break toolBatchLoop;
        }
      }
    } else {
      const staged: StagedToolOutcome[] = [];
      for (const ref of batch.calls) {
        if (isAborted()) {
          skipToolDueToAbort(ref);
          continue;
        }
        staged.push(await runOne(ref));
        if (staged.some(outcomeNeedsElicitation)) {
          break;
        }
      }
      if (commitStagedBatch(staged)) {
        break toolBatchLoop;
      }
    }
    if (turn.status === "awaiting_approval") {
      break toolBatchLoop;
    }
  }

  return {
    stoppedForApproval: turn.status === "awaiting_approval",
    heldForElicitation,
    pendingClarificationQuestions,
    finalReply,
  };
}
