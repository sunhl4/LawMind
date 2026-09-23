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

import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import { resolveAgentMandatoryRulesForPrompt } from "../policy/workspace-policy.js";
import { applyCompactReinjectionToSession } from "./compact-reinjection.js";
import { autoCompactSessionHistory } from "./compact.js";
import {
  estimateTokenBudget,
  type TokenBudgetLevel,
  DEFAULT_MID_TURN_COMPACT_TRIGGER_RATIO,
} from "./context-budget.js";
import { pruneSessionToolResults } from "./session-tool-result-prune.js";
import type { AgentMessage, AgentSession } from "./types.js";

/** 一个回合里最多整理几次；超出后只做工具结果瘦身，避免压缩本身开始空转。 */
export const MID_TURN_COMPACT_MAX = 3;

export type MidTurnCompactPrune = { prunedCount: number; charsRemoved: number };

export type MidTurnCompactOutcome =
  | {
      applied: false;
      reason: "below_trigger" | "cap" | "round_start" | "pruned_enough" | "no_reduction";
      prune?: MidTurnCompactPrune;
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
  },
): MidTurnCompactOutcome {
  const policy = opts.policy ?? null;
  const budgetOpts = { contextTokens: opts.contextTokens };
  const before = estimateTokenBudget(session, policy, budgetOpts);
  if (
    !shouldCompactMidTurn({
      roundIndex: opts.roundIndex,
      used: before.used,
      effectiveLimit: before.effectiveLimit,
      level: before.level,
      compactionsDone: opts.compactionsDone,
      triggerRatio: opts.triggerRatio,
      force: opts.force,
      maxCompactions: opts.maxCompactions,
      measuredUsed: opts.measuredUsed,
    })
  ) {
    return {
      applied: false,
      reason: opts.roundIndex <= 1 ? "round_start" : "below_trigger",
    };
  }

  // ── 1) 便宜的瘦身：缩写旧工具回包（无 LLM 调用，不丢消息）──
  const pruned = pruneSessionToolResults(session);
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
    // 尾巴自身就超窗口（例如单条巨型消息）：压了也不减，别把摘要再堆进去。
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

  return {
    applied: true,
    prune,
    droppedMessageCount: dropped,
    digestCharCount: compactResult.droppedDigest?.length,
    sessionSummaryPath: compactResult.sessionSummaryPath,
    boundaryId,
    firstKeptTimestamp: compactResult.firstKeptTimestamp,
    firstKeptRole: compactResult.firstKeptRole,
  };
}
