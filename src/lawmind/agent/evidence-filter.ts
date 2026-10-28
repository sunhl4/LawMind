/**
 * 弱测量序贯证据过滤器。
 *
 * 一句话把某个槽写成确定值，只是一次很弱的读数；同一读数在连续几轮、经由
 * 互不相交的通道重复出现，才升级成一次强判定。这是经典贝叶斯滤波 /
 * 序贯概率比检验，不是量子测量；借的只是「单次测量不足以投影」这条纪律。
 *
 * 用途：
 * - 给「红灯」加迟滞，避免单句措辞造成误报；
 * - 给 witness 抽查的多次回答累积置信，而不是一次答对就升格；
 * - 在证据衰减后自动退回 mixed，避免旧结论永久占位。
 *
 * 不调用模型，不写 FactorState，不改稿。
 */

export type EvidenceObservation = {
  outcomeId: string;
  /** 该通道给这个读法的对数似然比；正数支持，负数反对。 */
  llr: number;
  round: number;
  /** 通道 id。同一通道重复观测不增加独立通道数。 */
  channel: string;
};

export type EvidenceFilterConfig = {
  /** 先验对数几率；缺省全 0。 */
  prior?: Readonly<Record<string, number>>;
  /** 每轮证据衰减；1 表示不衰减。 */
  decay?: number;
  /** 判定确定所需的对数几率下限。 */
  upper?: number;
  /** 低于此值一律 mixed。 */
  lower?: number;
  /** 第一名与第二名的最小差距；不够则记冲突。 */
  margin?: number;
  /** 判定确定所需的最少独立通道数。普通工具结果可设 1；弱读数建议 2。 */
  minChannels?: number;
};

export type EvidenceFilterState = {
  anchor: string;
  logOdds: Record<string, number>;
  /** 每个读法实际出现过的通道 id。 */
  channels: Record<string, string[]>;
  lastRound: number;
  observations: number;
};

export type EvidenceFilterDecision =
  | { kind: "definite"; id: string; logOdds: number }
  | { kind: "mixed"; ids: string[]; reason: string }
  | { kind: "conflict"; ids: string[]; reason: string };

const DEFAULT_UPPER = 2;
const DEFAULT_LOWER = 0;
const DEFAULT_MARGIN = 1.5;
const DEFAULT_MIN_CHANNELS = 1;
const LOG_ODDS_CLAMP = 60;

function clamp(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(LOG_ODDS_CLAMP, Math.max(-LOG_ODDS_CLAMP, value));
}

function decayFor(steps: number, config: EvidenceFilterConfig): number {
  const decay = config.decay ?? 1;
  if (!Number.isFinite(decay) || decay <= 0 || decay > 1 || steps <= 0) {
    return 1;
  }
  return decay ** steps;
}

export function createFilter(
  anchor: string,
  config: EvidenceFilterConfig = {},
): EvidenceFilterState {
  const prior = config.prior ?? {};
  const logOdds: Record<string, number> = {};
  const channels: Record<string, string[]> = {};
  for (const [id, value] of Object.entries(prior)) {
    const key = id.trim();
    if (!key || !Number.isFinite(value)) {
      continue;
    }
    logOdds[key] = clamp(value);
    channels[key] = [];
  }
  return { anchor, logOdds, channels, lastRound: 0, observations: 0 };
}

/** 纯函数：返回新状态，不修改入参。 */
export function observe(
  state: EvidenceFilterState,
  observation: EvidenceObservation,
  config: EvidenceFilterConfig = {},
): EvidenceFilterState {
  const outcomeId = observation.outcomeId.trim();
  const channel = observation.channel.trim();
  if (!outcomeId || !channel || !Number.isFinite(observation.llr)) {
    return state;
  }
  const round = Number.isFinite(observation.round) ? observation.round : state.lastRound;
  const steps = Math.max(0, round - state.lastRound);
  const factor = decayFor(steps, config);
  const logOdds: Record<string, number> = {};
  for (const [id, value] of Object.entries(state.logOdds)) {
    logOdds[id] = clamp(value * factor);
  }
  logOdds[outcomeId] = clamp((logOdds[outcomeId] ?? 0) + observation.llr);
  const channels: Record<string, string[]> = {};
  for (const [id, ids] of Object.entries(state.channels)) {
    channels[id] = [...ids];
  }
  const known = channels[outcomeId] ?? [];
  if (!known.includes(channel)) {
    known.push(channel);
  }
  channels[outcomeId] = known;
  return {
    anchor: state.anchor,
    logOdds,
    channels,
    lastRound: Math.max(state.lastRound, round),
    observations: state.observations + 1,
  };
}

/** softmax 后的读法概率，仅用于显示/评测；判定仍用对数几率与门槛。 */
export function posterior(state: EvidenceFilterState): Record<string, number> {
  const entries = Object.entries(state.logOdds).filter(([, value]) => Number.isFinite(value));
  if (entries.length === 0) {
    return {};
  }
  const max = Math.max(...entries.map(([, value]) => value));
  const weights = entries.map(([id, value]) => [id, Math.exp(value - max)] as const);
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) {
    return {};
  }
  return Object.fromEntries(weights.map(([id, weight]) => [id, weight / total]));
}

export function decide(
  state: EvidenceFilterState,
  config: EvidenceFilterConfig = {},
): EvidenceFilterDecision {
  const entries = Object.entries(state.logOdds)
    .filter(([id, value]) => id.trim() && Number.isFinite(value))
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    return { kind: "mixed", ids: [], reason: "没有读数" };
  }
  const upper = config.upper ?? DEFAULT_UPPER;
  const lower = config.lower ?? DEFAULT_LOWER;
  const margin = config.margin ?? DEFAULT_MARGIN;
  const minChannels = Math.max(1, config.minChannels ?? DEFAULT_MIN_CHANNELS);
  const [topId, topValue] = entries[0] ?? ["", Number.NEGATIVE_INFINITY];
  const [secondId, secondValue] = entries[1] ?? ["", Number.NEGATIVE_INFINITY];
  if (!topId) {
    return { kind: "mixed", ids: [], reason: "没有读数" };
  }
  const topChannels = state.channels[topId] ?? [];
  if (topValue < lower) {
    return {
      kind: "mixed",
      ids: entries.filter(([, value]) => value >= lower).map(([id]) => id),
      reason: "证据不足",
    };
  }
  if (secondId && secondValue > lower && topValue - secondValue < margin) {
    return {
      kind: "conflict",
      ids: [topId, secondId],
      reason: "两个读法差距不足，不选边",
    };
  }
  if (topValue < upper) {
    return { kind: "mixed", ids: [topId], reason: "单次读数太弱" };
  }
  if (topChannels.length < minChannels) {
    return {
      kind: "mixed",
      ids: [topId],
      reason: `独立通道不足（${topChannels.length}/${minChannels}）`,
    };
  }
  return { kind: "definite", id: topId, logOdds: topValue };
}

/** 只保留指定读法；不给则清空。lastRound 保留，衰减从上一轮继续。 */
export function resetFilter(
  state: EvidenceFilterState,
  keep: readonly string[] = [],
): EvidenceFilterState {
  const wanted = new Set(keep.map((id) => id.trim()).filter(Boolean));
  const logOdds: Record<string, number> = {};
  const channels: Record<string, string[]> = {};
  for (const [id] of Object.entries(state.logOdds)) {
    if (!wanted.has(id)) {
      continue;
    }
    logOdds[id] = 0;
    channels[id] = [];
  }
  return {
    anchor: state.anchor,
    logOdds,
    channels,
    lastRound: state.lastRound,
    observations: 0,
  };
}

/** 强证据（工具返回、原文抄录）可以一次性投影；弱读数仍走观察累积。 */
export function observeStrong(
  state: EvidenceFilterState,
  observation: EvidenceObservation,
  strength = 6,
): EvidenceFilterState {
  return observe(state, { ...observation, llr: strength });
}
