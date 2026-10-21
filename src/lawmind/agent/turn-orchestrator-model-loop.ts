/**
 * Main model ↔ tool loop for runTurn (extracted from turn-orchestrator).
 */

import { recordContextPressure } from "../metrics/context-pressure.js";
import {
  mergeUsageSnapshots,
  createModelUsageRecorder,
  usageFromProvider,
  type ModelUsageSnapshot,
} from "../models/model-usage.js";
import { resolveSamplingParameters } from "../models/sampling-parameters.js";
import { ToolTableMeter } from "../models/tool-table-fingerprint.js";
import { makeContextPinId } from "../platform/compose-context-pin.js";
import {
  readWorkspacePolicyFile,
  type LawMindWorkspacePolicy,
} from "../policy/workspace-policy.js";
import {
  applySameTurnVerifyHistoryCollapse,
  collapseSameTurnVerifyHistoryForTurnEnd,
  shouldBounceSameTurnCompletion,
} from "../runtime/same-turn-verify.js";
import type { ToolCallRef } from "../runtime/tool-concurrency.js";
import { contextUsesHostFileLedger } from "../runtime/tool-pipeline.js";
import type { ClarificationQuestion } from "../types.js";
import { claimAndApplyWorkGoal } from "../work/goal.js";
import { estimateTextTokens, estimateTokenBudget } from "./context-budget.js";
import { dropContextDeferralBounces } from "./context-deferral.js";
import {
  MID_TURN_LLM_DIGEST_MIN_CHARS,
  MID_TURN_LLM_DIGEST_TIMEOUT_MS,
  resolveContextTuning,
} from "./context-tuning.js";
import { consultListGap, pleadingSectionGaps } from "./deliverable-shape.js";
import { appendMechanicalNote } from "./factor-state.js";
import { applyMidTurnCompact } from "./mid-turn-compact.js";
import { friendlyModelErrorMessage } from "./model-error-message.js";
import { missingNamedDeliverables } from "./named-deliverable.js";
import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
import { runSamplingLoop, sampleModelDecision } from "./sampling-loop.js";
import { claimAndApplyPendingContextPins, appendContextPins } from "./session-context-inject.js";
import { claimAndApplyPendingSteer, peekPendingSteer } from "./session-context-steer.js";
import {
  normalizeToolResultMessages,
  repairToolCallPairing,
  rewriteUnfinishedToolPlaceholders,
} from "./session-tool-call-pairing.js";
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
import { resolveToolDecisionMaxTokens } from "./tool-decision-sampling.js";
import { applyToolDisclosureDelta } from "./tool-disclosure-delta.js";
import { mergeTurnDisclosedToolNames } from "./tools/disclosed-turn-tools.js";
import type { ToolRegistry } from "./tools/registry.js";
import { emitTurnLifecycle } from "./turn-lifecycle-hooks.js";
import {
  resolveToolBudgetStop,
  runCompletionPolicies,
  runToolRoundPolicies,
} from "./turn-loop-policies.js";
import { createLoopFlags } from "./turn-loop-state.js";
import {
  buildTurnReplyFallback,
  safeParse,
  type RunTurnEvent,
} from "./turn-orchestrator-events.js";
import { executeToolBatches, type ToolRoundPolicyHints } from "./turn-orchestrator-tool-round.js";
import { applyPendingTurnPlan } from "./turn-plan.js";
import { resolveTurnProfile } from "./turn-profile.js";
import { rebuildStepContext, type TurnContext } from "./turn-step-context.js";
import type { AgentConfig, AgentContext, AgentMessage, AgentSession, AgentTurn } from "./types.js";
import {
  appendPinIdsToWorldState,
  applyPendingWorldStateCraftPatch,
  collectWorldStateHashes,
} from "./world-state.js";
import { SEARCH_SYNTHESIS_TOOL_NAMES } from "./write-synthesis.js";

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
 * Repeat / forbidden-shell / reread helpers live in `turn-loop-policies.ts`
 * (the ordered policy table that decides when to nudge or stop). Re-exported
 * here so existing unit tests keep importing from the loop module.
 */
export {
  IDENTICAL_TOOL_REPEAT_NUDGE_AT,
  advanceIdenticalToolStreak,
  completedDocumentReread,
  formatDocumentRereadContinue,
  formatDocumentRereadNudge,
  formatForbiddenShellNudge,
  formatForbiddenShellStop,
  formatIdenticalToolRepeatNudge,
  formatIdenticalToolRepeatStop,
  formatWordRevisionCapStop,
  formatWordRevisionExportNudge,
  forbiddenShellRejectionCount,
  identicalToolRepeatDecision,
  lawyerRepeatKind,
  shouldContinueCompletedDocumentReread,
  toolCallBatchSignature,
  type CompletedDocumentReread,
  type LawyerRepeatKind,
} from "./turn-loop-policies.js";

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
  /** 计费口径：BYOK 自备密钥，或平台订阅额度。缺省 byok。 */
  billingScope?: import("../models/model-usage.js").ModelBillingScope;
}): Promise<ModelToolLoopResult> {
  let loopCount = 0;
  let turnUsage: ModelUsageSnapshot | undefined;
  let finalReply = "";
  let pendingClarificationQuestions = opts.pendingClarificationQuestions;
  /**
   * All one-shot coaching / retry flags live in one object so the policy table
   * can read and mutate them without a dozen sibling `let`s.
   */
  const flags = createLoopFlags();
  /** 工具 schema 估算按指纹缓存，避免每轮重复 stringify。 */
  const toolTableMeter = new ToolTableMeter();
  const turnCapabilityId = opts.ctx.capabilityId ?? opts.session.lastBoundCapabilityId;
  const turnProfile = resolveTurnProfile({
    instruction: opts.turn.instruction,
    wordRevision: opts.ctx.wordRevisionTurn === true,
    mailContract: opts.ctx.mailContractTurn === true,
    ...(turnCapabilityId ? { capabilityId: turnCapabilityId } : {}),
  });
  opts.turn.profileId = turnProfile.id;

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
    // 律师看到原因（没网、欠费），原始报错只留在 turn.error / 事件里供排查。
    const reply = friendlyModelErrorMessage(message);
    opts.turn.status = "error";
    opts.turn.stopReason = "model_error";
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

  const stopped = await runSamplingLoop<{
    finalReply: string;
    pendingClarificationQuestions: ClarificationQuestion[];
    turnUsage: ModelUsageSnapshot | undefined;
    aborted: boolean;
  }>({
    maxRounds: hardCeiling + 1,
    step: async () => {
      if (opts.abortRequested() || opts.abortSignal?.aborted) {
        collapseHistoryForEnd();
        opts.turn.stopReason = "aborted";
        return {
          finalReply,
          pendingClarificationQuestions,
          turnUsage,
          aborted: true,
        };
      }
      loopCount++;
      opts.turn.roundCount = loopCount;
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
      const missingForWrite = missingNamedDeliverables(
        opts.config.workspaceDir,
        opts.turn.instruction,
      );
      const synthesisRound = flags.synthesisNudged && missingForWrite.length > 0;
      const pleadingRewrite =
        flags.pleadingNudged &&
        pleadingSectionGaps(opts.config.workspaceDir, opts.turn.instruction).length > 0;
      const consultRewrite =
        flags.consultNudged && consultListGap(opts.config.workspaceDir, opts.turn.instruction);
      // Consult lists must not slide back into another research loop; write
      // synthesis locks search while the named deliverable is still missing.
      //
      // 2026-10-21：只在**教练已经提示过之后**才收表。之前 `locksSearchAfterSynthesis`
      // 是静态 profile 属性，consult 类回合从第 0 轮就检索不到东西——把「只列追问」
      // 变成「不能查证就列追问」，正好与正常办案相反。
      const lockSearch =
        (flags.synthesisSearchLocked && missingForWrite.length > 0) ||
        (turnProfile.locksSearchAfterSynthesis && consultRewrite);
      const roundToolNames = step.toolNames;
      openAITools = opts.registry.toOpenAITools({ names: roundToolNames });
      const toolDelta = applyToolDisclosureDelta(opts.session, previousToolNames, roundToolNames);
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
      previousToolNames = [...roundToolNames];
      opts.emitEvent({ type: "round_start", roundIndex });
      emitTurnLifecycle({
        phase: "before_model_round",
        sessionId: opts.session.sessionId,
        turnId: opts.turn.turnId,
        detail: { roundIndex, toolCount: roundToolNames.length },
      });
      if (shouldBounceSameTurnCompletion(opts.turn.sameTurnVerify)) {
        applySameTurnVerifyHistoryCollapse(opts.session, opts.turn, "keep_latest_full");
      } else {
        applySameTurnVerifyHistoryCollapse(opts.session, opts.turn, "drop");
      }

      // Soft warn near tool-call ceiling; hard stop still applies at maxToolCalls.
      if (
        !flags.toolBudgetWarned &&
        shouldWarnToolBudget(opts.turn.toolCallsExecuted, opts.maxToolCalls)
      ) {
        flags.toolBudgetWarned = true;
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
      if (opts.config.model.reproducible !== undefined) {
        opts.session.samplingPreferences = {
          reproducible: opts.config.model.reproducible,
          ...(opts.config.model.seed !== undefined ? { seed: opts.config.model.seed } : {}),
        };
      }
      const modelForRound = { ...opts.config.model, ...opts.session.samplingPreferences };
      opts.ctx.chatModel = { ...opts.ctx.chatModel, ...modelForRound };

      const callModelRound = (mode: "decision" | "deliverable" = "decision") => {
        const toolsAdvertised = openAITools.length > 0;
        // 固定税 = 系统提示 + 实际发出的工具 schema。只在本轮算一次（按工具表指纹缓存）。
        const meter = toolTableMeter.measure(openAITools);
        const systemPromptTokens = estimateTextTokens(
          opts.session.conversationHistory.find((m) => m.role === "system")?.content ?? "",
        );
        const fixedInputTokens = systemPromptTokens + meter.tokens;
        const budget = estimateTokenBudget(opts.session, policyForTurn(), {
          contextTokens: modelForRound.contextTokens ?? opts.config.model.contextTokens,
          fixedInputTokens,
          toolTableFingerprint: meter.fingerprint,
        });
        const decisionMax = resolveToolDecisionMaxTokens(modelForRound.maxTokens, toolsAdvertised);
        const maxTokens =
          mode === "deliverable" || !toolsAdvertised ? modelForRound.maxTokens : decisionMax;
        const model =
          typeof maxTokens === "number" ? { ...modelForRound, maxTokens } : modelForRound;
        const sampling = resolveSamplingParameters(model);
        opts.turn.samplingAudit = {
          model: model.model,
          temperature: sampling.temperature,
          ...(sampling.seed !== undefined ? { seed: sampling.seed } : {}),
          reproducible: model.reproducible === true,
          toolsFingerprint: meter.fingerprint,
          toolCount: openAITools.length,
        };
        // 工具轮先不流式：短回复在收齐后一次吐出；被截断时再开流式把交件写完。
        const stream = mode === "decision" && toolsAdvertised ? false : useUpstreamTokenStream;
        let waitedForModel = false;
        const recordAttempt = createModelUsageRecorder(opts.config.workspaceDir, {
          sessionId: opts.session.sessionId,
          turnId: opts.turn.turnId,
          matterId: opts.session.matterId,
          model: modelForRound.model,
          provider: modelForRound.provider,
          purpose: "parent_turn",
          billingScope: opts.billingScope ?? opts.config.billingScope ?? "byok",
          fixedInputTokens,
          toolTableFingerprint: meter.fingerprint,
        });
        return callModelWithRetry(
          model,
          deriveModelMessagesForSampling(opts.session, budget),
          openAITools,
          {
            stream,
            onDelta: stream
              ? (chunk: string) => opts.emitEvent({ type: "delta", roundIndex, text: chunk })
              : undefined,
            signal: opts.abortSignal,
            admission: { sessionId: opts.session.sessionId, kind: "parent" },
            // 每次模型 HTTP 落一条账：重试与失败也记，否则成本永远少算。
            onModelUsage: (event) => {
              recordAttempt(event);
              const snapshotForEvent = usageFromProvider(event.usage);
              opts.emitEvent({
                type: "token_usage",
                attempt: event.attempt,
                input: snapshotForEvent?.promptTokens,
                output: snapshotForEvent?.completionTokens,
                fixed: fixedInputTokens,
                cached: snapshotForEvent?.cachedTokens,
                uncached: snapshotForEvent?.uncachedTokens,
                failed: event.failed,
              });
            },
            onAdmissionWait: () => {
              waitedForModel = true;
              opts.emitEvent({ type: "turn_wait", reason: "model_slot", label: "排队等模型" });
            },
            onAdmissionGranted: () => {
              if (!waitedForModel) {
                return;
              }
              waitedForModel = false;
              opts.emitEvent({ type: "turn_wait_end", reason: "model_slot" });
            },
            ...(synthesisRound || pleadingRewrite || consultRewrite
              ? { reasoningEffort: "max" as const }
              : {}),
            // 服务端以「工具结果不配对」拒收时：修复来源历史并落盘，再重发一次。
            // 修复必须落到 session，否则下一轮又会从同一份坏历史重建（Claude Code 的教训）。
            onToolPairingReject: () => {
              const rewritten = rewriteUnfinishedToolPlaceholders(opts.session.conversationHistory);
              const normalized = normalizeToolResultMessages(rewritten.messages);
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
      let outputRaised = false;
      const sampleDecision = async () => {
        const sampled = await sampleModelDecision({
          sample: callModelRound,
          toolsAdvertised: openAITools.length > 0,
          configuredMaxTokens: modelForRound.maxTokens,
          flags,
          onResponse: (value) => {
            const usage = usageFromProvider(value.usage);
            turnUsage = mergeUsageSnapshots(turnUsage, usage);
            if (usage?.promptTokens) {
              lastMeasuredPromptTokens = usage.promptTokens;
            }
          },
        });
        outputRaised = sampled.outputRaised;
        return sampled.response;
      };
      try {
        response = await sampleDecision();
      } catch (err) {
        if (
          err instanceof ModelCallUserAbortError ||
          opts.abortSignal?.aborted ||
          opts.abortRequested()
        ) {
          collapseHistoryForEnd();
          opts.turn.stopReason = "aborted";
          return {
            finalReply,
            pendingClarificationQuestions,
            turnUsage,
            aborted: true,
          };
        }
        if (!flags.overflowRetryUsed && isContextOverflowError(err)) {
          const pruned = pruneSessionToolResults(opts.session, {
            maxTokens: OVERFLOW_PRUNE_MAX_TOKENS,
            keepRecent: OVERFLOW_PRUNE_KEEP_RECENT,
          });
          if (pruned.prunedCount > 0 && pruned.charsRemoved > 0) {
            flags.overflowRetryUsed = true;
            opts.emitEvent({
              type: "overflow_prune",
              prunedCount: pruned.prunedCount,
              charsRemoved: pruned.charsRemoved,
            });
            try {
              response = await sampleDecision();
            } catch (retryErr) {
              if (
                retryErr instanceof ModelCallUserAbortError ||
                opts.abortSignal?.aborted ||
                opts.abortRequested()
              ) {
                collapseHistoryForEnd();
                opts.turn.stopReason = "aborted";
                return {
                  finalReply,
                  pendingClarificationQuestions,
                  turnUsage,
                  aborted: true,
                };
              }
              closeOnModelFailure(retryErr, roundIndex);
              return "stop";
            }
          } else {
            closeOnModelFailure(err, roundIndex);
            return "stop";
          }
        } else {
          closeOnModelFailure(err, roundIndex);
          return "stop";
        }
      }
      if (!response) {
        return "stop";
      }
      const choice = response.choices[0];

      const assistantMsg = choice.message as typeof choice.message & {
        reasoning_content?: string | null;
      };
      const toolCalls = assistantMsg.tool_calls;

      const decisionWasQuiet = openAITools.length > 0 && !outputRaised;
      const emitQuietSegment = (text: string) => {
        if ((!useUpstreamTokenStream || decisionWasQuiet) && text.length > 0) {
          opts.emitEvent({ type: "delta", roundIndex, text });
        }
      };
      if (toolCalls && toolCalls.length > 0) {
        emitQuietSegment(assistantMsg.content ?? "");
      }

      const reasoningContent = assistantMsg.reasoning_content?.trim() ?? "";
      const agentMsg: AgentMessage = {
        role: "assistant",
        content: assistantMsg.content ?? "",
        timestamp: new Date().toISOString(),
        ...(reasoningContent ? { reasoningContent } : {}),
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
        const assistantText = assistantMsg.content ?? "";
        const hideAssistantMessage = (): void => {
          agentMsg.hiddenFromLawyer = true;
        };
        const action = runCompletionPolicies(
          {
            instruction: opts.turn.instruction,
            workspaceDir: opts.config.workspaceDir,
            profile: turnProfile,
            flags,
            turn: opts.turn,
            session: opts.session,
            assistantText,
            roundIndex,
            wordRevision: opts.ctx.wordRevisionTurn === true,
            pendingClarificationQuestions,
            deferralBounceMax: () =>
              resolveContextTuning(policyForTurn()).midTurn.deferralBounceMax,
            emit: opts.emitEvent,
            hideAssistantMessage,
            recordPressure: (outcome, detail, meta) =>
              recordContextPressure(opts.config.workspaceDir, outcome, {
                turnId: opts.turn.turnId,
                ...(opts.session.matterId ? { matterId: opts.session.matterId } : {}),
                sessionId: opts.session.sessionId,
                ...(detail ? { detail } : {}),
                ...(meta ? { meta } : {}),
              }),
            hasPendingSteer: () =>
              !opts.abortRequested() &&
              peekPendingSteer(opts.config.workspaceDir, opts.session.sessionId).length > 0,
          },
          {
            beforeBounce: () => emitQuietSegment(assistantText),
          },
        );

        if (action?.kind === "resample") {
          if (action.forceCompact) {
            await compactMidTurn(roundIndex, true);
          }
          action.afterResamplePrep?.();
          if (action.applyMechanicalNote) {
            agentMsg.content = appendMechanicalNote(assistantText, opts.turn.factorState);
          }
          if (action.message) {
            const nudge = {
              role: "user" as const,
              content: action.message,
              timestamp: new Date().toISOString(),
              hiddenFromLawyer: true,
            };
            opts.session.conversationHistory.push(nudge);
            opts.turn.messages.push(nudge);
          }
          action.afterMessagePush?.();
          return "continue";
        }

        if (action?.kind === "stop") {
          if (action.emitReply && action.reply != null) {
            emitQuietSegment(action.reply);
          }
          if (action.status) {
            opts.turn.status = action.status;
          }
          if (action.rewriteAssistant && action.reply != null) {
            agentMsg.content = action.reply;
          }
          if (action.consumeClarificationQuestions) {
            pendingClarificationQuestions = [];
          }
          finalReply = action.reply ?? assistantText;
          opts.turn.stopReason = action.reason;
          return "stop";
        }

        // No policy applied: plain delivery (mechanical note appended when known).
        const voiced = appendMechanicalNote(assistantText, opts.turn.factorState);
        agentMsg.content = voiced;
        finalReply = voiced;
        opts.turn.status = "completed";
        opts.turn.stopReason = "delivered";
        return "stop";
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
          policyHints: lockSearch
            ? {
                ...opts.policyHints,
                deniedToolNames: [
                  ...new Set([
                    ...(opts.policyHints.deniedToolNames ?? []),
                    ...SEARCH_SYNTHESIS_TOOL_NAMES,
                  ]),
                ],
              }
            : opts.policyHints,
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
      if (
        !flags.toolBudgetWarned &&
        shouldWarnToolBudget(opts.turn.toolCallsExecuted, opts.maxToolCalls)
      ) {
        flags.toolBudgetWarned = true;
        opts.emitEvent({
          type: "tool_budget",
          used: opts.turn.toolCallsExecuted,
          maxToolCalls: opts.maxToolCalls,
          level: "warn",
        });
      }

      if (
        opts.turn.status === "awaiting_approval" ||
        opts.turn.status === "awaiting_clarification"
      ) {
        opts.turn.stopReason =
          opts.turn.status === "awaiting_approval" ? "awaiting_approval" : "awaiting_clarification";
        return "stop";
      }
      if (opts.turn.status === "completed" && batchResult.finalReply) {
        finalReply = batchResult.finalReply;
        opts.turn.stopReason = "delivered";
        return "stop";
      }

      // Post-batch coaching: ordered policy table (see `turn-loop-policies.ts`).
      // First non-null action wins; `resample` pushes one hidden user message.
      const postRound = runToolRoundPolicies({
        instruction: opts.turn.instruction,
        workspaceDir: opts.config.workspaceDir,
        profile: turnProfile,
        flags,
        wordRevision: opts.ctx.wordRevisionTurn === true,
        toolRefs,
        advertisedToolNames: stepAfterBatch.toolNames,
        toolNameCallCounts: opts.turn.toolNameCallCounts,
        toolCallSignatures: opts.turn.toolCallSignatures,
        trackedArtifactWritten: opts.turn.trackedArtifactWritten === true,
        messages: opts.session.conversationHistory,
        turnMessages: opts.turn.messages,
      });

      if (postRound?.kind === "resample") {
        const hidden = [
          ...(postRound.messages ?? []),
          ...(postRound.message ? [postRound.message] : []),
        ];
        for (const content of hidden) {
          const nudge = {
            role: "user" as const,
            content,
            timestamp: new Date().toISOString(),
            hiddenFromLawyer: true,
          };
          opts.session.conversationHistory.push(nudge);
          opts.turn.messages.push(nudge);
        }
        postRound.afterMessagePush?.();
        return "continue";
      }
      if (postRound?.kind === "stop") {
        opts.turn.status = postRound.status ?? "completed";
        finalReply = postRound.reply ?? "";
        opts.turn.stopReason = postRound.reason;
        return "stop";
      }

      if (opts.abortRequested() || opts.abortSignal?.aborted) {
        collapseHistoryForEnd();
        opts.turn.stopReason = "aborted";
        return {
          finalReply,
          pendingClarificationQuestions,
          turnUsage,
          aborted: true,
        };
      }

      const budgetStop = resolveToolBudgetStop({
        used: opts.turn.toolCallsExecuted,
        hard: hardCeiling,
        wordRevision: opts.ctx.wordRevisionTurn === true,
        assistantText: assistantMsg.content ?? "",
        turn: opts.turn,
        roundIndex,
        pendingClarificationQuestions,
        emit: opts.emitEvent,
      });
      if (budgetStop) {
        opts.turn.status = budgetStop.status;
        opts.turn.stopReason = budgetStop.reason;
        finalReply = budgetStop.reply;
        if (budgetStop.consumedClarificationQuestions) {
          pendingClarificationQuestions = [];
        }
        return "stop";
      }
      return "continue";
    },
  });
  if (stopped) {
    return stopped;
  }

  collapseHistoryForEnd();

  if (opts.abortRequested() || opts.abortSignal?.aborted) {
    opts.turn.stopReason = "aborted";
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
  if (!opts.turn.stopReason) {
    // Reached here only by exhausting `while (loopCount < hardCeiling + 1)`
    // without a break (every break sets its own cause).
    opts.turn.stopReason = finalReply.trim() ? "round_ceiling" : "unknown";
  }

  return {
    finalReply,
    pendingClarificationQuestions,
    turnUsage,
    aborted: false,
  };
}
