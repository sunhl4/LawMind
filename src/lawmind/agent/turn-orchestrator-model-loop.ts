/**
 * Main model ↔ tool loop for runTurn (extracted from turn-orchestrator).
 */

import {
  mergeUsageSnapshots,
  usageFromProvider,
  type ModelUsageSnapshot,
} from "../models/model-usage.js";
import { makeContextPinId } from "../platform/compose-context-pin.js";
import type { ToolCallRef } from "../runtime/tool-concurrency.js";
import type { ClarificationQuestion } from "../types.js";
import { claimAndApplyWorkGoal } from "../work/goal.js";
import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
import { claimAndApplyPendingContextPins } from "./session-context-inject.js";
import { claimAndApplyPendingSteer } from "./session-context-steer.js";
import { isContextOverflowError, pruneSessionToolResults } from "./session-tool-result-prune.js";
import { deriveModelMessages } from "./session.js";
import {
  formatToolBudgetContinueReply,
  formatToolBudgetHardStopReply,
  shouldCheckpointToolBudget,
  shouldHardStopToolBudget,
} from "./tool-budget.js";
import type { ToolRegistry } from "./tools/registry.js";
import {
  buildClarificationReply,
  buildTurnReplyFallback,
  safeParse,
  type RunTurnEvent,
} from "./turn-orchestrator-events.js";
import { executeToolBatches, type ToolRoundPolicyHints } from "./turn-orchestrator-tool-round.js";
import { rebuildStepContext, type TurnContext } from "./turn-step-context.js";
import type { AgentConfig, AgentContext, AgentMessage, AgentSession, AgentTurn } from "./types.js";
import { appendPinIdsToWorldState, collectWorldStateHashes } from "./world-state.js";

/**
 * Strict tool streaming is opt-in (D3): desktop/SSE defaults relaxed so tool_calls
 * can arrive without forcing upstream stream constraints. Set LAWMIND_STRICT_TOOL_STREAM=1 to enable.
 */
export function resolveStrictUpstreamToolStreaming(
  hasOnEvent: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!hasOnEvent) {
    return false;
  }
  const raw = env.LAWMIND_STRICT_TOOL_STREAM?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "on";
}

/** Soft warn when tool calls reach 80% of the hard ceiling. */
export function shouldWarnToolBudget(used: number, maxToolCalls: number): boolean {
  return maxToolCalls > 0 && used >= Math.ceil(maxToolCalls * 0.8);
}

export type ModelToolLoopResult = {
  finalReply: string;
  pendingClarificationQuestions: ClarificationQuestion[];
  turnUsage: ModelUsageSnapshot | undefined;
  aborted: boolean;
};

/**
 * Run model → tools until completion, approval, abort, or tool-call ceiling.
 */
export async function runModelToolLoop(opts: {
  config: AgentConfig;
  registry: ToolRegistry;
  session: AgentSession;
  turn: AgentTurn;
  ctx: AgentContext;
  openAITools: ReturnType<ToolRegistry["toOpenAITools"]>;
  turnContext: TurnContext;
  maxToolCalls: number;
  /** Hard runaway ceiling (defaults to 2× soft). */
  hardToolCallCeiling?: number;
  /** Lawyer already said continue — do not pause again at the soft budget. */
  skipToolBudgetCheckpoint?: boolean;
  toolTimeoutMs: number;
  strictDangerousToolApproval: boolean;
  allowDangerousToolsWithoutApproval: boolean;
  toolSandboxEnabled: boolean;
  policyHints: ToolRoundPolicyHints;
  actorId: string;
  hasOnEvent: boolean;
  pendingClarificationQuestions: ClarificationQuestion[];
  emitEvent: (event: RunTurnEvent) => void;
  abortRequested: () => boolean;
  /** Aborts in-flight model HTTP when Stop is pressed. */
  abortSignal?: AbortSignal;
}): Promise<ModelToolLoopResult> {
  let loopCount = 0;
  let turnUsage: ModelUsageSnapshot | undefined;
  let finalReply = "";
  let pendingClarificationQuestions = opts.pendingClarificationQuestions;
  let toolBudgetWarned = false;
  let overflowRetryUsed = false;

  const strictUpstreamToolStreaming = resolveStrictUpstreamToolStreaming(opts.hasOnEvent);
  const hardCeiling =
    opts.hardToolCallCeiling ?? Math.max(opts.maxToolCalls * 2, opts.maxToolCalls);
  let openAITools = opts.openAITools;
  const pinIds: string[] = [];

  while (loopCount < hardCeiling + 1) {
    if (opts.abortRequested() || opts.abortSignal?.aborted) {
      return {
        finalReply,
        pendingClarificationQuestions,
        turnUsage,
        aborted: true,
      };
    }
    loopCount++;
    const roundIndex = loopCount;
    const claimedPins = claimAndApplyPendingContextPins(opts.session, opts.config.workspaceDir);
    if (claimedPins.length > 0) {
      pinIds.push(...claimedPins.map((pin) => makeContextPinId(pin)));
      const sys = opts.session.conversationHistory[0];
      if (sys?.role === "system") {
        sys.content = appendPinIdsToWorldState(
          sys.content,
          claimedPins.map((pin) => makeContextPinId(pin)),
        );
        opts.session.worldStateBaseline = collectWorldStateHashes(sys.content);
        opts.session.worldStateEpoch = (opts.session.worldStateEpoch ?? 0) + 1;
      }
    }
    claimAndApplyPendingSteer(opts.session, opts.config.workspaceDir);
    claimAndApplyWorkGoal(opts.session, opts.config.workspaceDir);
    opts.ctx.permissionMode = opts.turnContext.permissionMode;
    if (opts.turnContext.matterId) {
      opts.ctx.matterId = opts.turnContext.matterId;
    }
    const step = rebuildStepContext({
      session: opts.session,
      registry: opts.registry,
      turnContext: opts.turnContext,
      pinIds,
      discoveryCallCounts: opts.turn.toolNameCallCounts,
    });
    openAITools = opts.registry.toOpenAITools({ names: step.toolNames });
    opts.emitEvent({ type: "round_start", roundIndex });

    // Soft warn near tool-call ceiling; hard stop still applies at maxToolCalls.
    if (!toolBudgetWarned && shouldWarnToolBudget(opts.turn.toolCallsExecuted, opts.maxToolCalls)) {
      toolBudgetWarned = true;
      opts.emitEvent({
        type: "tool_budget",
        used: opts.turn.toolCallsExecuted,
        maxToolCalls: opts.maxToolCalls,
        level: "warn",
      });
    }

    const hadToolResponsesThisTurn = opts.turn.messages.some((m) => m.role === "tool");
    const useUpstreamTokenStream =
      opts.hasOnEvent &&
      (!strictUpstreamToolStreaming || openAITools.length === 0 || hadToolResponsesThisTurn);

    // E7: tool rounds prefer workerModel when configured; final no-tool reply uses primary.
    const modelForRound =
      openAITools.length > 0 && opts.config.workerModel
        ? opts.config.workerModel
        : opts.config.model;

    const callModelRound = () =>
      callModelWithRetry(modelForRound, deriveModelMessages(opts.session), openAITools, {
        stream: useUpstreamTokenStream,
        onDelta: useUpstreamTokenStream
          ? (chunk: string) => opts.emitEvent({ type: "delta", roundIndex, text: chunk })
          : undefined,
        signal: opts.abortSignal,
      });

    let response: Awaited<ReturnType<typeof callModelWithRetry>>;
    try {
      response = await callModelRound();
    } catch (err) {
      if (
        err instanceof ModelCallUserAbortError ||
        opts.abortSignal?.aborted ||
        opts.abortRequested()
      ) {
        return {
          finalReply,
          pendingClarificationQuestions,
          turnUsage,
          aborted: true,
        };
      }
      if (!overflowRetryUsed && isContextOverflowError(err)) {
        const pruned = pruneSessionToolResults(opts.session);
        if (pruned.prunedCount > 0 && pruned.charsRemoved > 0) {
          overflowRetryUsed = true;
          opts.emitEvent({
            type: "overflow_prune",
            prunedCount: pruned.prunedCount,
            charsRemoved: pruned.charsRemoved,
          });
          try {
            response = await callModelRound();
          } catch (retryErr) {
            if (
              retryErr instanceof ModelCallUserAbortError ||
              opts.abortSignal?.aborted ||
              opts.abortRequested()
            ) {
              return {
                finalReply,
                pendingClarificationQuestions,
                turnUsage,
                aborted: true,
              };
            }
            throw retryErr;
          }
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
    turnUsage = mergeUsageSnapshots(turnUsage, usageFromProvider(response.usage));

    const choice = response.choices[0];
    if (!choice) {
      opts.turn.status = "error";
      opts.turn.error = "Empty response from model";
      break;
    }

    const assistantMsg = choice.message;
    const toolCalls = assistantMsg.tool_calls;

    if (!useUpstreamTokenStream) {
      const segment = assistantMsg.content ?? "";
      if (segment.length > 0) {
        opts.emitEvent({ type: "delta", roundIndex, text: segment });
      }
    }

    const agentMsg: AgentMessage = {
      role: "assistant",
      content: assistantMsg.content ?? "",
      timestamp: new Date().toISOString(),
    };

    if (toolCalls && toolCalls.length > 0) {
      agentMsg.toolCalls = toolCalls.map(
        (tc: { id: string; function: { name: string; arguments: string } }) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: safeParse(tc.function.arguments),
        }),
      );
    }

    opts.session.conversationHistory.push(agentMsg);
    opts.turn.messages.push(agentMsg);

    if (!toolCalls || toolCalls.length === 0) {
      if (pendingClarificationQuestions.length > 0) {
        finalReply = buildClarificationReply(
          assistantMsg.content ?? "",
          pendingClarificationQuestions,
        );
        opts.turn.status = "awaiting_clarification";
        opts.turn.clarificationQuestions = pendingClarificationQuestions;
      } else {
        finalReply = assistantMsg.content ?? "";
        opts.turn.status = "completed";
      }
      break;
    }

    const toolRefs: ToolCallRef[] = toolCalls.map(
      (tc: { id: string; function: { name: string; arguments: string } }) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParse(tc.function.arguments),
      }),
    );
    const batchResult = await executeToolBatches({
      toolRefs,
      registry: opts.registry,
      turn: opts.turn,
      ctx: opts.ctx,
      roundIndex,
      assistantContent: assistantMsg.content ?? "",
      maxToolCalls: hardCeiling,
      toolTimeoutMs: opts.toolTimeoutMs,
      strictDangerousToolApproval: opts.strictDangerousToolApproval,
      allowDangerousToolsWithoutApproval: opts.allowDangerousToolsWithoutApproval,
      toolSandboxEnabled: opts.toolSandboxEnabled,
      policyHints: opts.policyHints,
      actorId: opts.actorId,
      sessionMatterId: opts.session.matterId,
      sessionAssistantId: opts.session.assistantId,
      pendingClarificationQuestions,
      emitEvent: opts.emitEvent,
      abortRequested: opts.abortRequested,
      pushMessage: (msg) => {
        opts.session.conversationHistory.push(msg);
        opts.turn.messages.push(msg);
      },
    });
    pendingClarificationQuestions = batchResult.pendingClarificationQuestions;
    if (batchResult.finalReply) {
      finalReply = batchResult.finalReply;
    }

    const stepAfterBatch = rebuildStepContext({
      session: opts.session,
      registry: opts.registry,
      turnContext: opts.turnContext,
      pinIds,
    });
    openAITools = opts.registry.toOpenAITools({ names: stepAfterBatch.toolNames });

    // Warn after batches too — a single round can jump past 80% without another round_start.
    if (!toolBudgetWarned && shouldWarnToolBudget(opts.turn.toolCallsExecuted, opts.maxToolCalls)) {
      toolBudgetWarned = true;
      opts.emitEvent({
        type: "tool_budget",
        used: opts.turn.toolCallsExecuted,
        maxToolCalls: opts.maxToolCalls,
        level: "warn",
      });
    }

    if (opts.turn.status === "awaiting_approval") {
      break;
    }

    if (shouldHardStopToolBudget(opts.turn.toolCallsExecuted, hardCeiling)) {
      if (pendingClarificationQuestions.length > 0) {
        opts.turn.status = "awaiting_clarification";
        opts.turn.clarificationQuestions = pendingClarificationQuestions;
        finalReply = buildClarificationReply(
          assistantMsg.content ?? "",
          pendingClarificationQuestions,
          "已生成带待补充项的正式草稿，但当前轮次已达到办理上限。为完成最终交付，请补充：",
        );
      } else {
        opts.turn.status = "completed";
        finalReply = assistantMsg.content?.trim() || formatToolBudgetHardStopReply();
      }
      break;
    }

    if (
      shouldCheckpointToolBudget({
        used: opts.turn.toolCallsExecuted,
        soft: opts.maxToolCalls,
        // 内部办理不因步数打断律师；硬顶仍停。外发仍走 send_email 拍板。
        skipCheckpoint: true,
      })
    ) {
      opts.turn.status = "paused";
      finalReply =
        assistantMsg.content?.trim() || formatToolBudgetContinueReply(opts.turn.toolCallsExecuted);
      break;
    }
  }

  if (!finalReply.trim() && opts.turn.toolCallsExecuted > 0) {
    finalReply = buildTurnReplyFallback(opts.turn);
  }

  return {
    finalReply,
    pendingClarificationQuestions,
    turnUsage,
    aborted: false,
  };
}
