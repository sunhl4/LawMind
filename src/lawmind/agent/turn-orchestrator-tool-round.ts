/**
 * Tool-round execution for the agent turn loop (extracted from turn-orchestrator).
 *
 * Hardening (P1-3):
 * - First-wins for pendingToolApproval under concurrent batches
 * - Stop further batches once awaiting_approval
 */

import type { GateDecision } from "../platform/contracts.js";
import { partitionToolCalls, type ToolCallRef } from "../runtime/tool-concurrency.js";
import {
  buildDefaultToolPipeline,
  composeToolPipeline,
  type ToolCallContext,
} from "../runtime/tool-pipeline.js";
import type { RiskLevel } from "../types.js";
import type { ClarificationQuestion } from "../types.js";
import {
  stringifyToolResultForHistory,
  summarizeToolResultForHistory,
} from "./tool-result-history.js";
import type { ToolRegistry } from "./tools/registry.js";
import {
  extractClarificationQuestions,
  extractToolErrorMessage,
  type RunTurnEvent,
} from "./turn-orchestrator-events.js";
import type { AgentContext, AgentMessage, AgentTurn } from "./types.js";

/** Lazy: avoids TDZ when tool-pipeline ↔ legal-tools ↔ turn-orchestrator cycle loads. */
let runToolPipeline: ReturnType<typeof composeToolPipeline> | undefined;
function getRunToolPipeline(): ReturnType<typeof composeToolPipeline> {
  if (!runToolPipeline) {
    runToolPipeline = composeToolPipeline(buildDefaultToolPipeline());
  }
  return runToolPipeline;
}

export type ToolRoundPolicyHints = {
  allowedToolNames?: string[];
  roleId?: string;
  riskCeiling?: RiskLevel;
};

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
};

export type ExecuteToolBatchesResult = {
  stoppedForApproval: boolean;
  pendingClarificationQuestions: ClarificationQuestion[];
  finalReply?: string;
};

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
  } = params;

  let pendingClarificationQuestions = params.pendingClarificationQuestions;
  let finalReply: string | undefined;

  const toolBatches = partitionToolCalls(toolRefs, registry);
  toolBatchLoop: for (const batch of toolBatches) {
    const runOne = async (ref: ToolCallRef): Promise<void> => {
      const tc = {
        id: ref.id,
        function: { name: ref.name, arguments: JSON.stringify(ref.arguments) },
      };
      ctx.clarificationBlockingHeavyTools = pendingClarificationQuestions.length > 0;
      turn.toolCallsExecuted++;

      const toolName = tc.function.name;
      const toolArgs = { ...ref.arguments };
      if (ctx.preApproveToolName && ctx.preApproveToolName === toolName) {
        toolArgs.__approved = true;
        if (ctx.preApproveToolArgs && typeof ctx.preApproveToolArgs === "object") {
          Object.assign(toolArgs, ctx.preApproveToolArgs);
        }
      }
      emitEvent({
        type: "tool_call_start",
        roundIndex,
        toolCallId: tc.id,
        toolName,
        args: toolArgs,
      });
      ctx.emitToolProgress = (label: string) => {
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
          roleId: policyHints?.roleId,
          riskCeiling: policyHints?.riskCeiling,
          actorId,
          auditDir: `${ctx.workspaceDir}/audit`,
          sessionMatterId,
          sessionAssistantId,
        },
      };
      const result = await getRunToolPipeline()(callCtx);
      emitEvent({
        type: "tool_call_end",
        roundIndex,
        toolCallId: tc.id,
        toolName,
        ok: result.ok,
        error: result.ok ? undefined : extractToolErrorMessage(result),
      });
      ctx.emitToolProgress = undefined;

      const historyResult = summarizeToolResultForHistory(result);
      const toolResponseMsg: AgentMessage = {
        role: "tool",
        content: stringifyToolResultForHistory(historyResult),
        toolCallResponses: [{ toolCallId: tc.id, name: toolName, result: historyResult }],
        timestamp: new Date().toISOString(),
      };
      pushMessage(toolResponseMsg);

      const clarificationQuestions = extractClarificationQuestions(result);
      if (clarificationQuestions.length > 0) {
        pendingClarificationQuestions = clarificationQuestions;
      }

      if (result.pendingApproval) {
        const gateDecision: GateDecision = {
          gate: "approval_gate",
          decision: "awaiting_confirmation",
          reason: `工具 ${toolName} 返回 pendingApproval`,
        };
        turn.gateDecisions?.push(gateDecision);
        turn.status = "awaiting_approval";
        // First-wins: concurrent batch must not overwrite the first pending slot.
        if (!turn.pendingToolApproval) {
          turn.pendingToolApproval = {
            toolName,
            toolCallId: tc.id,
            toolArgs,
          };
          finalReply = assistantContent || `操作 ${toolName} 需要您的确认。`;
        }
      }
    };

    if (batch.concurrencySafe && batch.calls.length > 1) {
      await Promise.all(batch.calls.map((ref) => runOne(ref)));
    } else {
      for (const ref of batch.calls) {
        await runOne(ref);
        if (turn.status === "awaiting_approval") {
          break toolBatchLoop;
        }
      }
    }
    if (turn.status === "awaiting_approval") {
      break toolBatchLoop;
    }
  }

  return {
    stoppedForApproval: turn.status === "awaiting_approval",
    pendingClarificationQuestions,
    finalReply,
  };
}
