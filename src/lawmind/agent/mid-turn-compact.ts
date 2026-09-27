/**
 * Mid-turn (loop-boundary) auto-compaction — Codex parity.
 *
 * Codex 在长工具链跑完一轮、上下文越线时**在循环边界压缩**，把未完成的请求重放进
 * 压缩后的窗口继续跑；Cursor 在固定 token 触发点让模型自我摘要后**回到循环**继续。
 * LawMind 原来只在回合开始压缩一次（`turn-orchestrator.ts`），回合内越线时模型手里
 * 只有「先收口本回合结论」这句 note，于是把活儿退回律师（客户事故：请另开一轮）。
 *
 * 这里把同一套 `autoCompactSessionHistory` + 红线重注搬到工具轮边界，压缩后
 * **继续本回合**。两个 Codex 教训一并吸收：
 *   1. 先做便宜的瘦身（缩写旧工具回包），再做整段压缩；
 *   2. 压缩不减反增时（尾巴本身超窗口）宁可不动，也不把摘要再堆进去。
 */

import { recordContextPressure } from "../metrics/context-pressure.js";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import { resolveAgentMandatoryRulesForPrompt } from "../policy/workspace-policy.js";
import { applyCompactReinjectionToSession } from "./compact-reinjection.js";
import { autoCompactSessionHistory } from "./compact.js";
import { estimateTokenBudget, type TokenBudgetLevel } from "./context-budget.js";
import {
  type ContextTuning,
  DEFAULT_MID_TURN_COMPACT_TRIGGER_RATIO,
  MID_TURN_COMPACT_MAX,
  resolveContextTuning,
} from "./context-tuning.js";
import {
  MID_TURN_PRUNE_KEEP_RECENT,
  MID_TURN_PRUNE_MAX_TOKENS,
  pruneSessionToolResults,
} from "./session-tool-result-prune.js";
import { elideMiddle } from "./text-elide.js";
import type { AgentMessage, AgentSession } from "./types.js";

/** 一个回合里最多整理几次；默认见 `context-tuning.ts`（policy `context.midTurn.maxPerTurn`）。 */
export { MID_TURN_COMPACT_MAX };

export type MidTurnCompactPrune = { prunedCount: number; charsRemoved: number };

export type MidTurnCompactOutcome =
  | {
      applied: false;
      reason:
        | "below_trigger"
        | "cap"
        | "round_start"
        | "pruned_enough"
        | "no_reduction"
        /** 压不动（单条巨型消息）→ 已就地中间省略，腾出了空间。 */
        | "elided";
      prune?: MidTurnCompactPrune;
      /** 就地省略的统计（`reason === "elided"` 时有值）。 */
      elide?: { elidedCount: number; charsRemoved: number };
    }
  | {
      applied: true;
      prune?: MidTurnCompactPrune;
      droppedMessageCount: number;
      digestCharCount?: number;
      sessionSummaryPath?: string;
      boundaryId: string;
      firstKeptTimestamp?: string;
      firstKeptRole?: AgentMessage["role"];
      /** 提取式蒸馏正文：调用方可据此做模型摘要（对齐 Codex 的模型摘要）。 */
      droppedDigest?: string;
      /** 被丢弃的原始消息：模型摘要的输入。 */
      droppedSpan?: AgentMessage[];
    };

export function midTurnBudgetOverTrigger(input: {
  used: number;
  effectiveLimit: number;
  level: TokenBudgetLevel;
  triggerRatio?: number;
}): boolean {
  if (input.level === "compact") {
    return true;
  }
  const limit = Math.max(1, input.effectiveLimit);
  const ratio = input.triggerRatio ?? DEFAULT_MID_TURN_COMPACT_TRIGGER_RATIO;
  return input.used / limit >= ratio;
}

/**
 * 尾部保留条数：那是「当前正在办」的上下文，省略它会直接改变模型当下的判断。
 *
 * 刻意只留 2 条（不是更大的数）：`no_reduction` 恰恰发生在**历史很短**的时候
 * （单条巨型消息占满窗口），保护太多就等于什么都不动，加固形同虚设 —— 这是实测出来的。
 * 可调：`context.midTurn.elideKeepTail`。
 */

/** 单条正文超过这个量（或有效窗口的 1/8）才值得省略。可调：`context.midTurn.elideThreshold*`。 */
function elideThresholdChars(effectiveLimit: number, tuning: ContextTuning): number {
  const limit = Math.max(1, effectiveLimit);
  return Math.max(
    tuning.midTurn.elideThresholdMinChars,
    Math.floor(limit * tuning.midTurn.elideThresholdRatio),
  );
}

/**
 * `no_reduction` 的兜底：不丢消息，而是把**超大单条正文**就地中间省略（头尾都留）。
 *
 * 为什么需要：单条巨型消息（把一份合同整段粘进来、或一次超长工具回包被内联）会让
 * 「保留尾部」的压缩压不动 —— 旧的处置是放弃（记 `no_reduction`），于是水位继续顶，
 * 直到模型自己报上下文溢出。这里改成就地瘦身：复用 `elideMiddle`（Codex
 * `truncate_middle_with_token_budget` 同形），只动 user/assistant 正文，
 * 不碰 tool 消息（配对安全），也不动尾部（当下正在办的那几轮）。
 */
export function elideOversizedMessages(
  session: AgentSession,
  effectiveLimit: number,
  tuning: ContextTuning = resolveContextTuning(null),
): { elidedCount: number; charsRemoved: number } {
  const threshold = elideThresholdChars(effectiveLimit, tuning);
  const history = session.conversationHistory;
  const keepTail = Math.max(0, tuning.midTurn.elideKeepTail);
  const lastEditable = Math.max(0, history.length - keepTail);
  let elidedCount = 0;
  let charsRemoved = 0;
  for (let i = 0; i < lastEditable; i += 1) {
    const msg = history[i];
    if (!msg || (msg.role !== "user" && msg.role !== "assistant")) {
      continue;
    }
    const content = msg.content ?? "";
    if (content.length <= threshold) {
      continue;
    }
    const result = elideMiddle(content, threshold);
    if (!result.elided || result.elidedChars <= 0) {
      continue;
    }
    history[i] = { ...msg, content: result.text };
    elidedCount += 1;
    charsRemoved += result.elidedChars;
  }
  return { elidedCount, charsRemoved };
}

export function shouldCompactMidTurn(input: {
  roundIndex: number;
  used: number;
  effectiveLimit: number;
  level: TokenBudgetLevel;
  compactionsDone: number;
  triggerRatio?: number;
  /** 模型已经用回复证明它没地方了：跳过比例检查，直接尝试腾空间。 */
  force?: boolean;
  maxCompactions?: number;
  /**
   * 上一轮 provider 回报的 `usage.prompt_tokens`（真实占用）。
   * 估算器（CJK 感知但仍是估价）偏小时，用它当天花板——Codex 的教训是
   * 「阈值必须从**有效**窗口推」，逆向同理：占用要以真实数为准。
   */
  measuredUsed?: number;
}): boolean {
  if (input.compactionsDone >= (input.maxCompactions ?? MID_TURN_COMPACT_MAX)) {
    return false;
  }
  // 第一次采样前，回合开始的压缩已经跑过（turn-orchestrator），不重复 —— 即便
  // 模型一上来就退让也不在这里重写历史（那时压缩也腾不出空间，交给反弹处理）。
  if (input.roundIndex <= 1) {
    return false;
  }
  if (input.force === true) {
    return true;
  }
  const used = Math.max(input.used, input.measuredUsed ?? 0);
  return midTurnBudgetOverTrigger({ ...input, used });
}

/**
 * 在工具轮边界尝试整理上下文。返回 `applied:false` 时 `session` 至多被瘦身过
 * （工具回包缩写），历史顺序与消息条数不变。
 */
export function applyMidTurnCompact(
  session: AgentSession,
  workspaceDir: string,
  opts: {
    maxHistoryMessages: number;
    policy?: LawMindWorkspacePolicy | null;
    linkedTaskId?: string;
    contextTokens?: number;
    roundIndex: number;
    compactionsDone: number;
    force?: boolean;
    triggerRatio?: number;
    maxCompactions?: number;
    /** 上一轮 provider 回报的真实 prompt tokens（见 `shouldCompactMidTurn`）。 */
    measuredUsed?: number;
    /** 观测归属：回合 id（用于「有压力的回合数」）。 */
    turnId?: string;
    /** 已解析的调参；不传则从 `policy` 现场解析（默认值 = 接入 policy 前的行为）。 */
    tuning?: ContextTuning;
  },
): MidTurnCompactOutcome {
  const policy = opts.policy ?? null;
  const tuning = opts.tuning ?? resolveContextTuning(policy);
  const budgetOpts = { contextTokens: opts.contextTokens };
  const before = estimateTokenBudget(session, policy, budgetOpts);
  const record = (
    outcome: Parameters<typeof recordContextPressure>[1],
    meta?: Record<string, string | number | boolean | null>,
  ): void => {
    recordContextPressure(workspaceDir, outcome, {
      ...(opts.turnId ? { turnId: opts.turnId } : {}),
      ...(session.matterId ? { matterId: session.matterId } : {}),
      sessionId: session.sessionId,
      ...(meta ? { meta } : {}),
    });
  };
  const maxCompactions = opts.maxCompactions ?? tuning.midTurn.maxPerTurn;
  if (
    !shouldCompactMidTurn({
      roundIndex: opts.roundIndex,
      used: before.used,
      effectiveLimit: before.effectiveLimit,
      level: before.level,
      compactionsDone: opts.compactionsDone,
      triggerRatio: opts.triggerRatio,
      force: opts.force,
      maxCompactions,
      measuredUsed: opts.measuredUsed,
    })
  ) {
    // 与 shouldCompactMidTurn 的短路顺序一致：先到次数帽，再是回合起点，最后才是没越线。
    // 以前次数帽也被记成 below_trigger，用量面板和压力指标分不清「没必要压」和「这回合不能再压」。
    const reason =
      opts.compactionsDone >= maxCompactions
        ? "cap"
        : opts.roundIndex <= 1
          ? "round_start"
          : "below_trigger";
    return { applied: false, reason };
  }

  // ── 1) 便宜的瘦身：缩写旧工具回包（无 LLM 调用，不丢消息）──
  const pruned = pruneSessionToolResults(session, {
    maxTokens: MID_TURN_PRUNE_MAX_TOKENS,
    keepRecent: MID_TURN_PRUNE_KEEP_RECENT,
  });
  const prune = pruned.prunedCount > 0 ? pruned : undefined;
  if (opts.force !== true && prune) {
    const afterPrune = estimateTokenBudget(session, policy, budgetOpts);
    if (
      !midTurnBudgetOverTrigger({
        used: afterPrune.used,
        effectiveLimit: afterPrune.effectiveLimit,
        level: afterPrune.level,
        triggerRatio: opts.triggerRatio,
      })
    ) {
      record("mid_turn_prune_only", {
        prunedCount: pruned.prunedCount,
        charsRemoved: pruned.charsRemoved,
      });
      return { applied: false, reason: "pruned_enough", prune };
    }
  }

  // ── 2) 仍然越线：整段压缩（保留最近消息 + 蒸馏 + 案件锚点 + 红线重注）──
  const compactResult = autoCompactSessionHistory(session, workspaceDir, {
    maxHistoryMessages: opts.maxHistoryMessages,
    policy,
    linkedTaskId: opts.linkedTaskId,
    contextTokens: opts.contextTokens,
  });
  const dropped = compactResult.droppedMessageCount ?? 0;
  if (!compactResult.compacted || dropped <= 0) {
    // 尾巴自身就超窗口（单条巨型消息）：别把摘要再堆进去，改成就地中间省略。
    const elided = elideOversizedMessages(session, before.effectiveLimit, tuning);
    if (elided.elidedCount > 0) {
      record("mid_turn_elided", {
        roundIndex: opts.roundIndex,
        used: before.used,
        effectiveLimit: before.effectiveLimit,
        elidedCount: elided.elidedCount,
        charsRemoved: elided.charsRemoved,
        ...(prune ? { prunedCount: prune.prunedCount } : {}),
      });
      return { applied: false, reason: "elided", prune, elide: elided };
    }
    record("mid_turn_no_reduction", {
      roundIndex: opts.roundIndex,
      used: before.used,
      effectiveLimit: before.effectiveLimit,
      ...(prune ? { prunedCount: prune.prunedCount } : {}),
    });
    return { applied: false, reason: "no_reduction", prune };
  }

  session.conversationHistory = compactResult.messages;
  session.needsCompactReinjection = true;
  // 红线重注：强制规则仍生效时必须如实说（不要把工作区 RULES 说没了）。
  applyCompactReinjectionToSession(session, {
    mandatoryRulesActive: resolveAgentMandatoryRulesForPrompt(workspaceDir, policy).active,
  });
  const boundaryId = compactResult.boundaryId ?? `${new Date().toISOString()}#${dropped}`;
  session.lastCompactBoundary = {
    boundaryId,
    at: new Date().toISOString(),
    droppedMessageCount: dropped,
    firstKeptTimestamp: compactResult.firstKeptTimestamp,
    firstKeptRole: compactResult.firstKeptRole,
    digestCharCount: compactResult.droppedDigest?.length,
    sessionSummaryPath: compactResult.sessionSummaryPath,
    midTurn: true,
    roundIndex: opts.roundIndex,
  };

  record("mid_turn_compact", {
    roundIndex: opts.roundIndex,
    droppedMessageCount: dropped,
    usedBefore: before.used,
    effectiveLimit: before.effectiveLimit,
    ...(prune ? { prunedCount: prune.prunedCount, charsRemoved: prune.charsRemoved } : {}),
    ...(opts.measuredUsed ? { measuredUsed: opts.measuredUsed } : {}),
  });
  return {
    applied: true,
    prune,
    droppedMessageCount: dropped,
    digestCharCount: compactResult.droppedDigest?.length,
    sessionSummaryPath: compactResult.sessionSummaryPath,
    boundaryId,
    firstKeptTimestamp: compactResult.firstKeptTimestamp,
    firstKeptRole: compactResult.firstKeptRole,
    ...(compactResult.droppedDigest ? { droppedDigest: compactResult.droppedDigest } : {}),
    ...(compactResult.droppedSpan?.length ? { droppedSpan: compactResult.droppedSpan } : {}),
  };
}
