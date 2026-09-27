/**
 * Main model ↔ tool loop for runTurn (extracted from turn-orchestrator).
 */

import { recordContextPressure } from "../metrics/context-pressure.js";
import {
  mergeUsageSnapshots,
  usageFromProvider,
  type ModelUsageSnapshot,
} from "../models/model-usage.js";
import { makeContextPinId } from "../platform/compose-context-pin.js";
import {
  readWorkspacePolicyFile,
  type LawMindWorkspacePolicy,
} from "../policy/workspace-policy.js";
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
import {
  dropContextDeferralBounces,
  formatContextDeferralBounce,
  formatContextDeferralHandoff,
  isContextBudgetDeferralReply,
} from "./context-deferral.js";
import {
  MID_TURN_LLM_DIGEST_MIN_CHARS,
  MID_TURN_LLM_DIGEST_TIMEOUT_MS,
  resolveContextTuning,
} from "./context-tuning.js";
import { applyMidTurnCompact } from "./mid-turn-compact.js";
import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
import { claimAndApplyPendingContextPins, appendContextPins } from "./session-context-inject.js";
import { claimAndApplyPendingSteer } from "./session-context-steer.js";
import { normalizeToolResultMessages, repairToolCallPairing } from "./session-tool-call-pairing.js";
import {
  isContextOverflowError,
  OVERFLOW_PRUNE_KEEP_RECENT,
  OVERFLOW_PRUNE_MAX_TOKENS,
  pruneSessionToolResults,
} from "./session-tool-result-prune.js";
import {
  beginSessionToolBatch,
  commitSessionToolBatch,
  deriveModelMessagesForSampling,
  saveSession,
} from "./session.js";
import { formatToolBudgetHardStopReply, shouldHardStopToolBudget } from "./tool-budget.js";
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

/**
 * Same tool batch this many times in a row is a spin, not progress.
 * Nudge once (the model may still change course); the next identical batch stops.
 */
export const IDENTICAL_TOOL_REPEAT_NUDGE_AT = 3;

export type IdenticalToolStreak = {
  signature: string;
  streak: number;
  nudged: boolean;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).toSorted();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

/** Exact batch the model just requested, argument key order ignored. */
export function toolCallBatchSignature(
  calls: ReadonlyArray<{ name: string; arguments: unknown }>,
): string {
  return calls.map((call) => `${call.name}\n${stableJson(call.arguments)}`).join("\n---\n");
}

export function advanceIdenticalToolStreak(
  prev: IdenticalToolStreak | null,
  signature: string,
): IdenticalToolStreak {
  if (prev && prev.signature === signature) {
    return { signature, streak: prev.streak + 1, nudged: prev.nudged };
  }
  return { signature, streak: 1, nudged: false };
}

/** Soft coach after a repeated batch; hard stop only if the nudge is ignored. */
export function identicalToolRepeatDecision(state: IdenticalToolStreak): "ok" | "nudge" | "stop" {
  if (state.streak < IDENTICAL_TOOL_REPEAT_NUDGE_AT) {
    return "ok";
  }
  return state.nudged ? "stop" : "nudge";
}

export function formatIdenticalToolRepeatNudge(): string {
  return "【重复调用】刚才这组工具和参数已经连续重复，没有新信息。换一种做法，或根据已有结果直接写回复。";
}

export function formatIdenticalToolRepeatStop(): string {
  return "同一操作已连续重复，先停在这里以防空转。已有的结果都还在。需要时在对话里接着办。";
}

/**
 * 回合内模型摘要的下限：提取式摘要比这还短时已经够用，不值得在工具轮边界
 * 多花一次模型调用（延迟直接叠进律师的等待）。默认见 `context-tuning.ts`。
 */
export { MID_TURN_LLM_DIGEST_MIN_CHARS };

/**
 * 回合内模型摘要的超时上限。这是**同步等**的位置，所以显著短于手动整理的 sidecar 超时；
 * 超时即回落提取式，绝不拖住对话（Codex 在 loop boundary 也是同步做的，但它没设这个帽）。
 * 默认见 `context-tuning.ts`（policy `context.midTurn.llmDigestTimeoutMs`）。
 */
export { MID_TURN_LLM_DIGEST_TIMEOUT_MS };

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
  /** Silent runaway ceiling (anti-loop). Never a lawyer question. */
  hardToolCallCeiling?: number;
  /** Kept for resume of already-paused continue_tools cards; new turns never checkpoint. */
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
  /** 回合内自动压缩需要与回合开始同源的保留条数 / 关联任务。 */
  maxHistoryMessages: number;
  linkedTaskId?: string;
}): Promise<ModelToolLoopResult> {
  let loopCount = 0;
  let turnUsage: ModelUsageSnapshot | undefined;
  let finalReply = "";
  let pendingClarificationQuestions = opts.pendingClarificationQuestions;
  let toolBudgetWarned = false;
  let overflowRetryUsed = false;
  /** One missing provider choice per turn is a glitch, not a failed delivery. */
  let emptyChoiceRetryUsed = false;
  let identicalToolStreak: IdenticalToolStreak | null = null;

  const strictUpstreamToolStreaming = resolveStrictUpstreamToolStreaming(opts.hasOnEvent);
  const hardCeiling =
    opts.hardToolCallCeiling ?? Math.max(opts.maxToolCalls * 2, opts.maxToolCalls);
  let openAITools = opts.openAITools;
  let previousToolNames: string[] | null = null;
  const pinIds: string[] = [];
  /** 本回合已做过的工具轮边界压缩次数（上限见 `mid-turn-compact.ts`）。 */
  let midTurnCompactions = 0;
  /** 上一轮 provider 回报的真实 prompt 占用；估算偏小时用它当天花板。 */
  let lastMeasuredPromptTokens = 0;
  let turnPolicy: LawMindWorkspacePolicy | null | undefined;
  const policyForTurn = (): LawMindWorkspacePolicy | null => {
    if (turnPolicy === undefined) {
      try {
        turnPolicy = readWorkspacePolicyFile(opts.config.workspaceDir);
      } catch {
        turnPolicy = null;
      }
    }
    return turnPolicy ?? null;
  };
  const collapseHistoryForEnd = (): void => {
    collapseSameTurnVerifyHistoryForTurnEnd(opts.session, opts.turn);
    // 退让反弹只服务下一轮采样，收口时清掉（与 same-turn verify 同取向）。
    opts.session.conversationHistory = dropContextDeferralBounces(opts.session.conversationHistory);
    opts.turn.messages = dropContextDeferralBounces(opts.turn.messages);
  };

  /**
   * 工具轮边界自动整理上下文（Codex mid-turn trigger / Cursor self-summarization）：
   * 压缩后**继续本回合**，而不是让模型「收口」再把活儿退回律师。
   * 返回 true 表示历史已被重写。
   */
  const compactMidTurn = async (roundIndex: number, force = false): Promise<boolean> => {
    const policy = policyForTurn();
    const tuning = resolveContextTuning(policy);
    const { midTurnCompactTriggerRatio } = tuning.budget;
    if (midTurnCompactions >= tuning.midTurn.maxPerTurn) {
      return false;
    }
    if (midTurnCompactions >= tuning.midTurn.maxPerTurn && force) {
      // 只在「模型已证明没空间」时记 cap：那是真正触到上限的信号。
      recordContextPressure(opts.config.workspaceDir, "mid_turn_cap", {
        turnId: opts.turn.turnId,
        ...(opts.session.matterId ? { matterId: opts.session.matterId } : {}),
        sessionId: opts.session.sessionId,
        meta: { compactionsDone: midTurnCompactions, roundIndex },
      });
    }
    let outcome: ReturnType<typeof applyMidTurnCompact>;
    try {
      outcome = applyMidTurnCompact(opts.session, opts.config.workspaceDir, {
        maxHistoryMessages: opts.maxHistoryMessages,
        policy,
        linkedTaskId: opts.linkedTaskId,
        contextTokens: opts.config.model.contextTokens ?? policy?.context?.contextTokens,
        roundIndex,
        compactionsDone: midTurnCompactions,
        force,
        triggerRatio: midTurnCompactTriggerRatio,
        maxCompactions: tuning.midTurn.maxPerTurn,
        turnId: opts.turn.turnId,
        tuning,
        // 估算器偏小时以真实占用为准（Codex：阈值/占用都要贴有效窗口）。
        ...(lastMeasuredPromptTokens > 0 ? { measuredUsed: lastMeasuredPromptTokens } : {}),
      });
    } catch {
      // 整理失败不拖垮本回合：工具轮继续，水位问题下一轮再试。
      return false;
    }
    if (outcome.prune && outcome.prune.charsRemoved > 0) {
      opts.emitEvent({
        type: "overflow_prune",
        prunedCount: outcome.prune.prunedCount,
        charsRemoved: outcome.prune.charsRemoved,
      });
    }
    if (!outcome.applied) {
      // 压不动时改走「就地中间省略」：复用既有的 overflow_prune 提示（律师看到的仍是
      // 「上下文较满，已精简后继续」），不新增界面、也不假装做了整段压缩。
      if (outcome.elide && outcome.elide.charsRemoved > 0) {
        opts.emitEvent({
          type: "overflow_prune",
          prunedCount: outcome.elide.elidedCount,
          charsRemoved: outcome.elide.charsRemoved,
        });
      }
      return false;
    }
    midTurnCompactions += 1;
    opts.emitEvent({
      type: "compact_boundary",
      sessionSummaryPath: outcome.sessionSummaryPath,
      droppedMessageCount: outcome.droppedMessageCount,
      firstKeptTimestamp: outcome.firstKeptTimestamp,
      firstKeptRole: outcome.firstKeptRole,
      digestCharCount: outcome.digestCharCount,
      boundaryId: outcome.boundaryId,
      midTurn: true,
      roundIndex,
    });
    emitTurnLifecycle({
      phase: "after_compact",
      sessionId: opts.session.sessionId,
      turnId: opts.turn.turnId,
      detail: {
        boundaryId: outcome.boundaryId,
        droppedMessageCount: outcome.droppedMessageCount,
        midTurn: true,
        roundIndex,
      },
    });

    // 自动整理只留提取式原文。模型摘要只在手动「整理」和承前分叉（useLlmDigest）里跑。
    return true;
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
        hiddenNames: opts.turnContext.hiddenToolNames,
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
    if (opts.ctx.noTaskTurn === true) {
      // 无任务回合不得写清单：丢掉模型塞进来的 pending 计划，保留上一轮清单。
      opts.ctx.pendingTurnPlan = undefined;
    }
    applyPendingTurnPlan(opts.session, opts.ctx);
    claimAndApplyPendingSteer(opts.session, opts.config.workspaceDir);
    claimAndApplyWorkGoal(opts.session, opts.config.workspaceDir);
    opts.ctx.permissionMode = opts.turnContext.permissionMode;
    if (opts.turnContext.matterId) {
      opts.ctx.matterId = opts.turnContext.matterId;
    }
    // ── 工具轮边界整理上下文（Codex mid-turn compact）：压完继续本轮，
    //    不要让模型在「窗口快满」时把活儿退回律师（客户事故：请另开一轮）。
    //    待批准 / 待澄清时不动历史（审批卡与澄清问题还没有结论）。
    if (
      !opts.abortRequested() &&
      opts.turn.status !== "awaiting_approval" &&
      pendingClarificationQuestions.length === 0
    ) {
      await compactMidTurn(roundIndex);
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

    // 选工具、读结果、写回复都是判断，一律用律师选的主模型。
    // 更快模型只做摘要（上面）和审稿（reviewModel），不接管这一轮。
    const modelForRound = opts.config.model;

    const callModelRound = () => {
      const budget = estimateTokenBudget(opts.session, policyForTurn(), {
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
          // 服务端以「工具结果不配对」拒收时：修复来源历史并落盘，再重发一次。
          // 修复必须落到 session，否则下一轮又会从同一份坏历史重建（Claude Code 的教训）。
          onToolPairingReject: () => {
            const normalized = normalizeToolResultMessages(opts.session.conversationHistory);
            const pairing = repairToolCallPairing(normalized.messages);
            opts.session.conversationHistory = pairing.messages;
            try {
              saveSession(opts.config.workspaceDir, opts.session);
            } catch {
              /* 落盘失败不阻塞自愈：内存已修复，后续 saveSession 仍会写入 */
            }
            const repairedBudget = estimateTokenBudget(opts.session, policyForTurn(), {
              contextTokens: modelForRound.contextTokens ?? opts.config.model.contextTokens,
            });
            return deriveModelMessagesForSampling(opts.session, repairedBudget);
          },
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
        const pruned = pruneSessionToolResults(opts.session, {
          maxTokens: OVERFLOW_PRUNE_MAX_TOKENS,
          keepRecent: OVERFLOW_PRUNE_KEEP_RECENT,
        });
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
    const measuredPromptTokens = usageFromProvider(response.usage)?.promptTokens ?? 0;
    if (measuredPromptTokens > 0) {
      lastMeasuredPromptTokens = measuredPromptTokens;
    }

    let choice = response.choices[0];
    if (!choice && !emptyChoiceRetryUsed) {
      emptyChoiceRetryUsed = true;
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
        closeOnModelFailure(err, roundIndex);
        break;
      }
      turnUsage = mergeUsageSnapshots(turnUsage, usageFromProvider(response.usage));
      const retryPromptTokens = usageFromProvider(response.usage)?.promptTokens ?? 0;
      if (retryPromptTokens > 0) {
        lastMeasuredPromptTokens = retryPromptTokens;
      }
      choice = response.choices[0];
    }
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
      // 客户事故：模型以上下文预算为由把活儿退回律师（「请另开一轮」）。
      // 先给它腾出窗口（工具轮边界压缩），再把一条隐藏的反弹消息塞回下一轮；
      // 上限之后才如实收下它的回复（fail-open，不无限循环）。
      const deferralText = assistantMsg.content ?? "";
      if (isContextBudgetDeferralReply(deferralText)) {
        const bounces = opts.turn.contextDeferralBounces ?? 0;
        recordContextPressure(opts.config.workspaceDir, "deferral_detected", {
          turnId: opts.turn.turnId,
          ...(opts.session.matterId ? { matterId: opts.session.matterId } : {}),
          sessionId: opts.session.sessionId,
          detail: deferralText.trim().slice(0, 200),
          meta: { bouncesSoFar: bounces, roundIndex },
        });
        if (bounces < resolveContextTuning(policyForTurn()).midTurn.deferralBounceMax) {
          await compactMidTurn(roundIndex, true);
          opts.turn.contextDeferralBounces = bounces + 1;
          agentMsg.hiddenFromLawyer = true;
          const deferralBounce = {
            role: "user" as const,
            content: formatContextDeferralBounce(),
            timestamp: new Date().toISOString(),
            hiddenFromLawyer: true,
          };
          opts.session.conversationHistory.push(deferralBounce);
          opts.turn.messages.push(deferralBounce);
          opts.emitEvent({
            type: "context_deferral_bounce",
            roundIndex,
            bounceCount: opts.turn.contextDeferralBounces,
          });
          recordContextPressure(opts.config.workspaceDir, "deferral_bounced", {
            turnId: opts.turn.turnId,
            ...(opts.session.matterId ? { matterId: opts.session.matterId } : {}),
            sessionId: opts.session.sessionId,
            meta: { bounceCount: opts.turn.contextDeferralBounces, roundIndex },
          });
          continue;
        }
        // 反弹用尽：不把模型的推诿原文丢给律师，换成可核对的事实 + 正确的继续方式。
        // fail-open 是刻意的（绝不无限循环），但**交接必须诚实**。
        const planOpen =
          opts.session.turnPlan?.items
            .filter((item) => item.status !== "completed")
            .map((item) => item.step) ?? [];
        recordContextPressure(opts.config.workspaceDir, "deferral_reached_lawyer", {
          turnId: opts.turn.turnId,
          ...(opts.session.matterId ? { matterId: opts.session.matterId } : {}),
          sessionId: opts.session.sessionId,
          detail: deferralText.trim().slice(0, 200),
          meta: { bounces: bounces, toolCallsExecuted: opts.turn.toolCallsExecuted },
        });
        // 回弹用尽的这一轮不再冒充「已完成」的正文：置为 paused，交给律师定夺要不要带上文续办。
        opts.turn.status = "paused";
        finalReply = formatContextDeferralHandoff({
          toolCallsExecuted: opts.turn.toolCallsExecuted,
          planOpen,
        });
        break;
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
    // 批次屏障：批次期间落盘写「已配对快照」，提交时整体落盘一次。
    beginSessionToolBatch(opts.session.sessionId);
    let batchResult: Awaited<ReturnType<typeof executeToolBatches>>;
    try {
      batchResult = await executeToolBatches({
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
    } catch (err) {
      // 工具异常优先：提交仍要跑（补占位并落盘），但不能掩盖原始错误。
      try {
        commitSessionToolBatch(opts.config.workspaceDir, opts.session);
      } catch {
        /* 保留原始工具异常 */
      }
      throw err;
    }
    // 成功路径：落盘失败必须停止本轮（fail-closed），与 session-persist 取向一致。
    commitSessionToolBatch(opts.config.workspaceDir, opts.session);
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

    if (toolRefs.length > 0) {
      identicalToolStreak = advanceIdenticalToolStreak(
        identicalToolStreak,
        toolCallBatchSignature(toolRefs),
      );
      const repeat = identicalToolRepeatDecision(identicalToolStreak);
      if (repeat === "nudge") {
        identicalToolStreak = { ...identicalToolStreak, nudged: true };
        const nudge = {
          role: "user" as const,
          content: formatIdenticalToolRepeatNudge(),
          timestamp: new Date().toISOString(),
          hiddenFromLawyer: true,
        };
        opts.session.conversationHistory.push(nudge);
        opts.turn.messages.push(nudge);
        continue;
      }
      if (repeat === "stop") {
        opts.turn.status = "completed";
        finalReply = formatIdenticalToolRepeatStop();
        break;
      }
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
  }

  collapseHistoryForEnd();

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
