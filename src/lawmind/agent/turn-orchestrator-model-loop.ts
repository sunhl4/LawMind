/**
 * Main model ↔ tool loop for runTurn (extracted from turn-orchestrator).
 */

import {
  mergeUsageSnapshots,
  usageFromProvider,
  type ModelUsageSnapshot,
} from "../models/model-usage.js";
import { makeContextPinId } from "../platform/compose-context-pin.js";
import {
  applySameTurnVerifyHistoryCollapse,
  collapseSameTurnVerifyHistoryForTurnEnd,
  formatSameTurnCompletionBounce,
  formatSameTurnVerifyPaused,
  shouldBounceSameTurnCompletion,
  shouldPauseSameTurnVerify,
} from "../runtime/same-turn-verify.js";
import type { ToolCallRef } from "../runtime/tool-concurrency.js";
import { contextUsesHostFileLedger } from "../runtime/tool-pipeline.js";
import type { ClarificationQuestion } from "../types.js";
import { claimAndApplyWorkGoal } from "../work/goal.js";
import { estimateTokenBudget } from "./context-budget.js";
import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
import { claimAndApplyPendingContextPins, appendContextPins } from "./session-context-inject.js";
import { claimAndApplyPendingSteer } from "./session-context-steer.js";
import { isContextOverflowError, pruneSessionToolResults } from "./session-tool-result-prune.js";
import { deriveModelMessagesForSampling } from "./session.js";
import {
  formatToolBudgetContinueReply,
  formatToolBudgetHardStopReply,
  shouldCheckpointToolBudget,
  shouldHardStopToolBudget,
} from "./tool-budget.js";
import { applyToolDisclosureDelta } from "./tool-disclosure-delta.js";
import { mergeTurnDisclosedToolNames } from "./tools/disclosed-turn-tools.js";
import type { ToolRegistry } from "./tools/registry.js";
import { emitTurnLifecycle } from "./turn-lifecycle-hooks.js";
import {
  buildClarificationReply,
  buildTurnReplyFallback,
  safeParse,
  type RunTurnEvent,
} from "./turn-orchestrator-events.js";
import { executeToolBatches, type ToolRoundPolicyHints } from "./turn-orchestrator-tool-round.js";
import { applyPendingTurnPlan } from "./turn-plan.js";
import { rebuildStepContext, type TurnContext } from "./turn-step-context.js";
import type { AgentConfig, AgentContext, AgentMessage, AgentSession, AgentTurn } from "./types.js";
import {
  appendPinIdsToWorldState,
  applyPendingWorldStateCraftPatch,
  collectWorldStateHashes,
} from "./world-state.js";

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
  let previousToolNames: string[] | null = null;
  const pinIds: string[] = [];
  const collapseHistoryForEnd = (): void => {
    collapseSameTurnVerifyHistoryForTurnEnd(opts.session, opts.turn);
  };

  const closeOnModelFailure = (err: unknown, roundIndex: number): void => {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.trim() || "Model call failed";
    const reply = `本轮模型调用失败：${message.slice(0, 800)}`;
    opts.turn.status = "error";
    opts.turn.error = message.slice(0, 2_000);
    finalReply = reply;
    const agentMsg: AgentMessage = {
      role: "assistant",
      content: reply,
      timestamp: new Date().toISOString(),
    };
    opts.session.conversationHistory.push(agentMsg);
    opts.turn.messages.push(agentMsg);
    opts.emitEvent({
      type: "model_error",
      roundIndex,
      message: message.slice(0, 2_000),
    });
    emitTurnLifecycle({
      phase: "model_error",
      sessionId: opts.session.sessionId,
      turnId: opts.turn.turnId,
      detail: { roundIndex, message: message.slice(0, 400) },
    });
    collapseHistoryForEnd();
  };

  while (loopCount < hardCeiling + 1) {
    if (opts.abortRequested() || opts.abortSignal?.aborted) {
      collapseHistoryForEnd();
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
      opts.ctx.contextPins = appendContextPins(opts.ctx.contextPins, claimedPins);
      pinIds.push(...claimedPins.map((pin) => makeContextPinId(pin)));
      // Recompute disclosure packs from updated pins (summons / folder mid-turn).
      const lastUser = opts.session.conversationHistory
        .toReversed()
        .find((m) => m.role === "user" && typeof m.content === "string");
      opts.session.disclosedToolNames = mergeTurnDisclosedToolNames({
        session: opts.session,
        workspaceDir: opts.config.workspaceDir,
        pins: opts.ctx.contextPins,
        registry: opts.registry,
        instruction: lastUser?.content,
        matterId: opts.ctx.matterId ?? opts.turnContext.matterId,
        projectDir: opts.ctx.projectDir,
      });
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
    applyPendingWorldStateCraftPatch(opts.session, opts.ctx);
    applyPendingTurnPlan(opts.session, opts.ctx);
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
      hostFileLedger: contextUsesHostFileLedger(opts.ctx),
    });
    openAITools = opts.registry.toOpenAITools({ names: step.toolNames });
    const toolDelta = applyToolDisclosureDelta(opts.session, previousToolNames, step.toolNames);
    if (toolDelta) {
      opts.emitEvent({
        type: "tool_delta",
        roundIndex,
        added: toolDelta.added,
        removed: toolDelta.removed,
      });
      emitTurnLifecycle({
        phase: "tool_delta",
        sessionId: opts.session.sessionId,
        turnId: opts.turn.turnId,
        detail: { roundIndex, added: toolDelta.added, removed: toolDelta.removed },
      });
    }
    previousToolNames = [...step.toolNames];
    opts.emitEvent({ type: "round_start", roundIndex });
    emitTurnLifecycle({
      phase: "before_model_round",
      sessionId: opts.session.sessionId,
      turnId: opts.turn.turnId,
      detail: { roundIndex, toolCount: step.toolNames.length },
    });
    if (shouldBounceSameTurnCompletion(opts.turn.sameTurnVerify)) {
      applySameTurnVerifyHistoryCollapse(opts.session, opts.turn, "keep_latest_full");
    } else {
      applySameTurnVerifyHistoryCollapse(opts.session, opts.turn, "drop");
    }

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

    const callModelRound = () => {
      const budget = estimateTokenBudget(opts.session, null, {
        contextTokens: modelForRound.contextTokens ?? opts.config.model.contextTokens,
      });
      return callModelWithRetry(
        modelForRound,
        deriveModelMessagesForSampling(opts.session, budget),
        openAITools,
        {
          stream: useUpstreamTokenStream,
          onDelta: useUpstreamTokenStream
            ? (chunk: string) => opts.emitEvent({ type: "delta", roundIndex, text: chunk })
            : undefined,
          signal: opts.abortSignal,
        },
      );
    };

    let response: Awaited<ReturnType<typeof callModelWithRetry>> | undefined;
    try {
      response = await callModelRound();
    } catch (err) {
      if (
        err instanceof ModelCallUserAbortError ||
        opts.abortSignal?.aborted ||
        opts.abortRequested()
      ) {
        collapseHistoryForEnd();
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
              collapseHistoryForEnd();
              return {
                finalReply,
                pendingClarificationQuestions,
                turnUsage,
                aborted: true,
              };
            }
            closeOnModelFailure(retryErr, roundIndex);
            break;
          }
        } else {
          closeOnModelFailure(err, roundIndex);
          break;
        }
      } else {
        closeOnModelFailure(err, roundIndex);
        break;
      }
    }
    if (!response) {
      break;
    }
    turnUsage = mergeUsageSnapshots(turnUsage, usageFromProvider(response.usage));

    const choice = response.choices[0];
    if (!choice) {
      closeOnModelFailure(new Error("Empty response from model"), roundIndex);
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
        break;
      }
      if (shouldBounceSameTurnCompletion(opts.turn.sameTurnVerify)) {
        if (shouldPauseSameTurnVerify(opts.turn.sameTurnVerify)) {
          opts.turn.status = "paused";
          finalReply = formatSameTurnVerifyPaused(opts.turn.sameTurnVerify!);
          break;
        }
        if (
          shouldCheckpointToolBudget({
            used: opts.turn.toolCallsExecuted,
            soft: opts.maxToolCalls,
            skipCheckpoint: opts.skipToolBudgetCheckpoint === true,
          })
        ) {
          opts.turn.status = "paused";
          finalReply = formatSameTurnVerifyPaused(opts.turn.sameTurnVerify!);
          break;
        }
        const bounce = formatSameTurnCompletionBounce(opts.turn.sameTurnVerify!);
        opts.turn.sameTurnVerify = {
          ...opts.turn.sameTurnVerify!,
          bounceCount: (opts.turn.sameTurnVerify?.bounceCount ?? 0) + 1,
        };
        const bounceMsg = {
          role: "user" as const,
          content: bounce,
          timestamp: new Date().toISOString(),
          hiddenFromLawyer: true,
        };
        opts.session.conversationHistory.push(bounceMsg);
        opts.turn.messages.push(bounceMsg);
        continue;
      }
      finalReply = assistantMsg.content ?? "";
      opts.turn.status = "completed";
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
    applyPendingWorldStateCraftPatch(opts.session, opts.ctx);
    applyPendingTurnPlan(opts.session, opts.ctx);

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

    if (opts.abortRequested() || opts.abortSignal?.aborted) {
      collapseHistoryForEnd();
      return {
        finalReply,
        pendingClarificationQuestions,
        turnUsage,
        aborted: true,
      };
    }

    if (shouldHardStopToolBudget(opts.turn.toolCallsExecuted, hardCeiling)) {
      if (shouldBounceSameTurnCompletion(opts.turn.sameTurnVerify)) {
        opts.turn.status = "paused";
        finalReply = formatSameTurnVerifyPaused(opts.turn.sameTurnVerify!);
      } else if (pendingClarificationQuestions.length > 0) {
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
        // 到达软预算暂停并询问律师（continue_tools 待办）；resume 路径
        // （律师已选「继续」）带 skipToolBudgetCheckpoint，不再重复询问。硬顶仍停。
        skipCheckpoint: opts.skipToolBudgetCheckpoint === true,
      })
    ) {
      opts.turn.status = "paused";
      finalReply = shouldBounceSameTurnCompletion(opts.turn.sameTurnVerify)
        ? formatSameTurnVerifyPaused(opts.turn.sameTurnVerify!)
        : assistantMsg.content?.trim() ||
          formatToolBudgetContinueReply(opts.turn.toolCallsExecuted);
      break;
    }
  }

  collapseSameTurnVerifyHistoryForTurnEnd(opts.session, opts.turn);

  if (opts.abortRequested() || opts.abortSignal?.aborted) {
    return {
      finalReply,
      pendingClarificationQuestions,
      turnUsage,
      aborted: true,
    };
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
