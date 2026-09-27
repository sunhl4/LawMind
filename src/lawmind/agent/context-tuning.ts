/**
 * 上下文 / 压缩管线的**单一调参入口**。
 *
 * ## 为什么要有这个模块
 *
 * 上下文怎么给、怎么压、怎么留，直接决定模型会不会变笨；这条链路上的阈值与帽
 * （触发线、预留、省略门槛、台账上限、续接种子额度……）原先散落在各模块里写成
 * 字面量。散落的字面量有三个问题：
 *
 * 1. **不可调**：律所 / 私有化部署想按自己的窗口与案情调早调晚，只能改源码；
 * 2. **不可审计**：体检页说不出「现在到底按哪套阈值在跑」；
 * 3. **不鲁棒**：`{"midTurnCompactTriggerRatio": "0.9"}`、`-1`、`NaN`、越界值
 *    这类真实会写错的东西没有统一处置——要么静默生效成怪值，要么炸在采样路径上。
 *
 * 因此这里做三件事：
 * - **默认值集中**（`DEFAULT_CONTEXT_TUNING`，行为与接入前逐位一致）；
 * - **逐键校验 + 夹取**（类型不对 → 回落默认；值越界 → 夹到边界；绝不抛错）；
 * - **跨字段不变量**（`min <= max`、`warnRatio <= midTurnCompactTriggerRatio`）。
 *
 * 调用方一律走 {@link resolveContextTuning}，不要再在模块里写数字。
 */

import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";

export type ContextBudgetTuning = {
  /** 未显式给窗口时的兜底（tokens）。 */
  contextTokens: number;
  /** 摘要输出预留（给模型写摘要的额度）。 */
  summaryOutputTokenReserve: number;
  /** 压缩缓冲。 */
  autoCompactBufferTokens: number;
  /** 连续压缩失败上限（超过即停手，等下一回合）。 */
  maxConsecutiveCompactFailures: number;
  /** 追加上下文注记 / warn 的起始填充比。 */
  warnRatio: number;
  /** 回合内（工具轮边界）压缩触发线，占有效窗口比例。 */
  midTurnCompactTriggerRatio: number;
  /** 小窗口的预留上限（占窗口比例），防止写死预留把小窗口压没。 */
  smallWindowReserveRatio: number;
  /** 有效窗口下限（tokens）。 */
  minEffectiveLimitTokens: number;
  /** 模型窗口下限（tokens）。 */
  minContextTokens: number;
};

export type ContextMidTurnTuning = {
  /** 单回合最多整理几次（含模型摘要的那次）。 */
  maxPerTurn: number;
  /** 退让同一回合最多反弹几次。 */
  deferralBounceMax: number;
  /** 就地省略时保护的尾部消息条数。 */
  elideKeepTail: number;
  /** 就地省略门槛：有效窗口的比例。 */
  elideThresholdRatio: number;
  /** 就地省略门槛下限（字符）。 */
  elideThresholdMinChars: number;
  /** 回合内模型摘要的起始素材量（字符）。 */
  llmDigestMinChars: number;
  /** 回合内模型摘要的超时上限（毫秒）。 */
  llmDigestTimeoutMs: number;
};

export type ContextDigestTuning = {
  /** 提取式摘要额度 = 窗口 × 该比例，再夹到 [minChars, maxChars]。 */
  charRatio: number;
  minChars: number;
  maxChars: number;
  /** 任务陈述段落额度。 */
  taskRatio: number;
  taskMinChars: number;
  taskMaxChars: number;
  /** 律师要点单行额度。 */
  lawyerLineRatio: number;
  lawyerLineMinChars: number;
  lawyerLineMaxChars: number;
  /** 旧策略仍接受。整理稿不再把上一轮摘要嵌进提示，原文在会话归档里。 */
  carriedRatio: number;
  /** 接续额度的绝对下限（字符）；`maxChars × carriedRatio` 小于它时按它给。 */
  carriedMinChars: number;
  /** 任务陈述候选上限（条）：被丢弃区段里最早的若干条真实律师发言。 */
  taskLineMax: number;
  /** 律师要点 / 助手结论各保留最近多少条。 */
  recentLineKeep: number;
  /** 从被丢弃区段召回的法条锚点上限。 */
  citationAnchorMax: number;
  /** LLM 摘要低于该长度视为不可用。 */
  llmMinSummaryChars: number;
  /** LLM 摘要头部占摘要额度的比例。 */
  llmSummaryShare: number;
  /** LLM 摘要总开关（env `LAWMIND_COMPACT_LLM` 仍可一刀切关掉）。 */
  llmDigestEnabled: boolean;
};

export type ContextPinsTuning = {
  /** 任务锚点（钉子）字符上限。 */
  taskCharCap: number;
  /** 事实台账总开关。 */
  factEnabled: boolean;
  /** 事实台账条数上限。 */
  factMaxItems: number;
  /** 事实台账单条字符上限。 */
  factItemCharCap: number;
  /** 事实台账总字符上限。 */
  factTotalCharCap: number;
  /** 事实台账召回法条锚点的上限。 */
  factCitationAnchorMax: number;
};

export type ContextCarryoverTuning = {
  /** 续接种子额度 = 窗口 × 该比例，再夹到 [seedMinChars, seedMaxChars]。 */
  seedCharRatio: number;
  seedMinChars: number;
  seedMaxChars: number;
  /** 种子正文（蒸馏）在额度里的占比，其余给状态头与指针。 */
  digestShare: number;
  /** 蒸馏正文额度的绝对下限（字符）。 */
  digestMinChars: number;
  /** 状态头 + 指针的最低额度（字符）。 */
  frameMinChars: number;
  /** 「续接来源」卡片摘要预览长度。 */
  digestPreviewChars: number;
  /** 建议另起新对话的压缩次数门槛。 */
  suggestMinCompacts: number;
};

export type ContextTuning = {
  budget: ContextBudgetTuning;
  midTurn: ContextMidTurnTuning;
  digest: ContextDigestTuning;
  pins: ContextPinsTuning;
  carryover: ContextCarryoverTuning;
};

/**
 * 默认调参：**接入 policy 之前的行为逐位一致**。
 * 改这里的数等于改产品默认；要按部署调，请写 `lawmind.policy.json` 的 `context.*`。
 */
export const DEFAULT_CONTEXT_TUNING: Readonly<ContextTuning> = deepFreeze({
  budget: {
    contextTokens: 128_000,
    summaryOutputTokenReserve: 20_000,
    autoCompactBufferTokens: 13_000,
    maxConsecutiveCompactFailures: 3,
    warnRatio: 0.85,
    midTurnCompactTriggerRatio: 0.9,
    smallWindowReserveRatio: 0.25,
    minEffectiveLimitTokens: 8_000,
    minContextTokens: 8_000,
  },
  midTurn: {
    maxPerTurn: 3,
    deferralBounceMax: 2,
    elideKeepTail: 2,
    elideThresholdRatio: 0.125,
    elideThresholdMinChars: 4_000,
    llmDigestMinChars: 600,
    llmDigestTimeoutMs: 15_000,
  },
  digest: {
    charRatio: 0.08,
    minChars: 6_000,
    maxChars: 96_000,
    taskRatio: 0.25,
    taskMinChars: 800,
    taskMaxChars: 4_000,
    lawyerLineRatio: 0.06,
    lawyerLineMinChars: 400,
    lawyerLineMaxChars: 1_200,
    carriedRatio: 0.35,
    carriedMinChars: 400,
    taskLineMax: 2,
    recentLineKeep: 8,
    citationAnchorMax: 24,
    llmMinSummaryChars: 40,
    llmSummaryShare: 0.45,
    llmDigestEnabled: true,
  },
  pins: {
    taskCharCap: 600,
    factEnabled: true,
    factMaxItems: 12,
    factItemCharCap: 320,
    factTotalCharCap: 1_200,
    factCitationAnchorMax: 8,
  },
  carryover: {
    seedCharRatio: 0.1,
    seedMinChars: 8_000,
    seedMaxChars: 32_000,
    digestShare: 0.6,
    digestMinChars: 1_000,
    frameMinChars: 500,
    digestPreviewChars: 400,
    suggestMinCompacts: 2,
  },
});

/** 默认值里的旧名字（历史导出，避免调用方散落引用）。 */
export const TOKEN_BUDGET_WARN_RATIO = DEFAULT_CONTEXT_TUNING.budget.warnRatio;
export const DEFAULT_MID_TURN_COMPACT_TRIGGER_RATIO =
  DEFAULT_CONTEXT_TUNING.budget.midTurnCompactTriggerRatio;
export const SMALL_WINDOW_RESERVE_RATIO = DEFAULT_CONTEXT_TUNING.budget.smallWindowReserveRatio;
export const MID_TURN_COMPACT_MAX = DEFAULT_CONTEXT_TUNING.midTurn.maxPerTurn;
export const MID_TURN_ELIDE_KEEP_TAIL = DEFAULT_CONTEXT_TUNING.midTurn.elideKeepTail;
export const CONTEXT_DEFERRAL_BOUNCE_MAX = DEFAULT_CONTEXT_TUNING.midTurn.deferralBounceMax;
export const MID_TURN_LLM_DIGEST_MIN_CHARS = DEFAULT_CONTEXT_TUNING.midTurn.llmDigestMinChars;
export const MID_TURN_LLM_DIGEST_TIMEOUT_MS = DEFAULT_CONTEXT_TUNING.midTurn.llmDigestTimeoutMs;
export const FACT_PIN_MAX_ITEMS = DEFAULT_CONTEXT_TUNING.pins.factMaxItems;
export const FACT_PIN_ITEM_CHAR_CAP = DEFAULT_CONTEXT_TUNING.pins.factItemCharCap;
export const FACT_PIN_TOTAL_CHAR_CAP = DEFAULT_CONTEXT_TUNING.pins.factTotalCharCap;
export const TASK_PIN_CHAR_CAP = DEFAULT_CONTEXT_TUNING.pins.taskCharCap;
export const CARRYOVER_SEED_CHAR_RATIO = DEFAULT_CONTEXT_TUNING.carryover.seedCharRatio;
export const CARRYOVER_DIGEST_PREVIEW_CHARS = DEFAULT_CONTEXT_TUNING.carryover.digestPreviewChars;

// ── 校验原语：类型不对回落默认，越界夹取，永不抛错 ──────────────────────────

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 比例：越界夹到 [min, max]，非法回落默认。 */
function readRatio(value: unknown, fallback: number, min: number, max: number): number {
  const n = readNumber(value);
  if (n === undefined) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

/**
 * 比例类调参的**统一下界**：只要求「正的、极小的」即可，不设业务性下限。
 *
 * 为什么不设（踩过的坑）：曾把 `midTurnCompactTriggerRatio` 下界写成 0.1，于是
 * 「把触发线压到 0.02 以强制触发」这种合法配置被**静默**改成 0.1 —— 越界的自动
 * 修正掩盖了律师/测试的真实意图。越界夹取只该拦「明显非法」（负数、0、>1），
 * 不该替调用方决定「多小才算合理」。
 */
const RATIO_MIN = 0.001;

/** {@link RATIO_MIN} 的对外名字（测试与体检页需要引用同一个下界）。 */
export const CONTEXT_RATIO_MIN = RATIO_MIN;

/** 整数：四舍五入后夹到 [min, max]，非法回落默认。 */
function readInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = readNumber(value);
  if (n === undefined) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** 递归冻结，防止调用方改到共享的默认表。 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) {
      deepFreeze(inner);
    }
  }
  return value;
}

/**
 * 解析 `lawmind.policy.json` 的 `context.*` 为**已校验、已夹取**的完整调参。
 *
 * - `policy` 为 `null` / 缺 `context` / 键写错类型 → 一律回落默认，绝不抛错；
 * - 越界值夹到边界（例如 `warnRatio: 5` → `1`）；
 * - 跨字段不变量在此处收敛：`min <= max`、`warnRatio <= midTurnCompactTriggerRatio`。
 */
export function resolveContextTuning(
  policy: LawMindWorkspacePolicy | null | undefined,
): ContextTuning {
  const d = DEFAULT_CONTEXT_TUNING;
  let ctx = asObject(policy?.context);
  if (!ctx) {
    const raw = process.env.LAWMIND_CONTEXT_TUNING?.trim();
    if (raw) {
      try {
        ctx = asObject(JSON.parse(raw) as unknown);
      } catch {
        ctx = undefined;
      }
    }
  }
  if (!ctx) {
    return d;
  }
  const midTurnRaw = asObject(ctx.midTurn);
  const digestRaw = asObject(ctx.digest);
  const pinsRaw = asObject(ctx.pins);
  const carryoverRaw = asObject(ctx.carryover);

  const midTurnCompactTriggerRatio = readRatio(
    ctx.midTurnCompactTriggerRatio,
    d.budget.midTurnCompactTriggerRatio,
    RATIO_MIN,
    1,
  );

  const budget: ContextBudgetTuning = {
    contextTokens: readInt(ctx.contextTokens, d.budget.contextTokens, 1_000, 10_000_000),
    summaryOutputTokenReserve: readInt(
      ctx.summaryOutputTokenReserve,
      d.budget.summaryOutputTokenReserve,
      0,
      1_000_000,
    ),
    autoCompactBufferTokens: readInt(
      ctx.autoCompactBufferTokens,
      d.budget.autoCompactBufferTokens,
      0,
      1_000_000,
    ),
    maxConsecutiveCompactFailures: readInt(
      ctx.maxConsecutiveCompactFailures,
      d.budget.maxConsecutiveCompactFailures,
      1,
      50,
    ),
    // 注记线晚于压缩线是无意义的（注记永远看不到），故夹到不超过压缩线。
    warnRatio: Math.min(
      readRatio(ctx.warnRatio, d.budget.warnRatio, RATIO_MIN, 1),
      midTurnCompactTriggerRatio,
    ),
    midTurnCompactTriggerRatio,
    smallWindowReserveRatio: readRatio(
      ctx.smallWindowReserveRatio,
      d.budget.smallWindowReserveRatio,
      RATIO_MIN,
      0.9,
    ),
    minEffectiveLimitTokens: readInt(
      ctx.minEffectiveLimitTokens,
      d.budget.minEffectiveLimitTokens,
      500,
      1_000_000,
    ),
    minContextTokens: readInt(ctx.minContextTokens, d.budget.minContextTokens, 500, 1_000_000),
  };

  const midTurn: ContextMidTurnTuning = {
    maxPerTurn: readInt(midTurnRaw?.maxPerTurn, d.midTurn.maxPerTurn, 1, 20),
    deferralBounceMax: readInt(midTurnRaw?.deferralBounceMax, d.midTurn.deferralBounceMax, 0, 10),
    elideKeepTail: readInt(midTurnRaw?.elideKeepTail, d.midTurn.elideKeepTail, 0, 50),
    elideThresholdRatio: readRatio(
      midTurnRaw?.elideThresholdRatio,
      d.midTurn.elideThresholdRatio,
      RATIO_MIN,
      1,
    ),
    elideThresholdMinChars: readInt(
      midTurnRaw?.elideThresholdMinChars,
      d.midTurn.elideThresholdMinChars,
      200,
      200_000,
    ),
    llmDigestMinChars: readInt(
      midTurnRaw?.llmDigestMinChars,
      d.midTurn.llmDigestMinChars,
      0,
      200_000,
    ),
    llmDigestTimeoutMs: readInt(
      midTurnRaw?.llmDigestTimeoutMs,
      d.midTurn.llmDigestTimeoutMs,
      500,
      600_000,
    ),
  };

  const digestMinChars = readInt(digestRaw?.minChars, d.digest.minChars, 200, 200_000);
  const digestMaxChars = readInt(digestRaw?.maxChars, d.digest.maxChars, 200, 500_000);
  const taskMinChars = readInt(digestRaw?.taskMinChars, d.digest.taskMinChars, 100, 200_000);
  const taskMaxChars = readInt(digestRaw?.taskMaxChars, d.digest.taskMaxChars, 100, 200_000);
  const lawyerLineMinChars = readInt(
    digestRaw?.lawyerLineMinChars,
    d.digest.lawyerLineMinChars,
    50,
    100_000,
  );
  const lawyerLineMaxChars = readInt(
    digestRaw?.lawyerLineMaxChars,
    d.digest.lawyerLineMaxChars,
    50,
    100_000,
  );
  const digest: ContextDigestTuning = {
    charRatio: readRatio(digestRaw?.charRatio, d.digest.charRatio, RATIO_MIN, 0.5),
    // 写反了也不炸：min 夹到不超过 max。
    minChars: Math.min(digestMinChars, digestMaxChars),
    maxChars: digestMaxChars,
    taskRatio: readRatio(digestRaw?.taskRatio, d.digest.taskRatio, RATIO_MIN, 0.9),
    taskMinChars: Math.min(taskMinChars, taskMaxChars),
    taskMaxChars,
    lawyerLineRatio: readRatio(
      digestRaw?.lawyerLineRatio,
      d.digest.lawyerLineRatio,
      RATIO_MIN,
      0.5,
    ),
    lawyerLineMinChars: Math.min(lawyerLineMinChars, lawyerLineMaxChars),
    lawyerLineMaxChars,
    carriedRatio: readRatio(digestRaw?.carriedRatio, d.digest.carriedRatio, RATIO_MIN, 0.9),
    carriedMinChars: readInt(digestRaw?.carriedMinChars, d.digest.carriedMinChars, 100, 100_000),
    taskLineMax: readInt(digestRaw?.taskLineMax, d.digest.taskLineMax, 1, 20),
    recentLineKeep: readInt(digestRaw?.recentLineKeep, d.digest.recentLineKeep, 1, 50),
    citationAnchorMax: readInt(digestRaw?.citationAnchorMax, d.digest.citationAnchorMax, 0, 200),
    llmMinSummaryChars: readInt(
      digestRaw?.llmMinSummaryChars,
      d.digest.llmMinSummaryChars,
      0,
      10_000,
    ),
    llmSummaryShare: readRatio(
      digestRaw?.llmSummaryShare,
      d.digest.llmSummaryShare,
      RATIO_MIN,
      0.9,
    ),
    llmDigestEnabled: readBool(digestRaw?.llmDigestEnabled, d.digest.llmDigestEnabled),
  };

  const pins: ContextPinsTuning = {
    taskCharCap: readInt(pinsRaw?.taskCharCap, d.pins.taskCharCap, 50, 10_000),
    factEnabled: readBool(pinsRaw?.factEnabled, d.pins.factEnabled),
    factMaxItems: readInt(pinsRaw?.factMaxItems, d.pins.factMaxItems, 0, 100),
    factItemCharCap: readInt(pinsRaw?.factItemCharCap, d.pins.factItemCharCap, 20, 2_000),
    factTotalCharCap: readInt(pinsRaw?.factTotalCharCap, d.pins.factTotalCharCap, 100, 20_000),
    factCitationAnchorMax: readInt(
      pinsRaw?.factCitationAnchorMax,
      d.pins.factCitationAnchorMax,
      0,
      100,
    ),
  };

  const seedMinChars = readInt(carryoverRaw?.seedMinChars, d.carryover.seedMinChars, 500, 500_000);
  const seedMaxChars = readInt(carryoverRaw?.seedMaxChars, d.carryover.seedMaxChars, 500, 500_000);
  const carryover: ContextCarryoverTuning = {
    seedCharRatio: readRatio(
      carryoverRaw?.seedCharRatio,
      d.carryover.seedCharRatio,
      // 与其它比例同一纪律：只拦明显非法。额度本身另有 [seedMinChars, seedMaxChars] 兜底，
      // 不需要在这里替调用方决定「多小才算合理」。
      RATIO_MIN,
      0.5,
    ),
    seedMinChars: Math.min(seedMinChars, seedMaxChars),
    seedMaxChars,
    // 正文占比过高会把状态头/指针挤没（那才是「能不能接着办」的关键），故夹 [0.05, 0.9]。
    digestShare: readRatio(carryoverRaw?.digestShare, d.carryover.digestShare, 0.05, 0.9),
    digestMinChars: readInt(carryoverRaw?.digestMinChars, d.carryover.digestMinChars, 100, 500_000),
    frameMinChars: readInt(carryoverRaw?.frameMinChars, d.carryover.frameMinChars, 100, 100_000),
    digestPreviewChars: readInt(
      carryoverRaw?.digestPreviewChars,
      d.carryover.digestPreviewChars,
      50,
      10_000,
    ),
    suggestMinCompacts: readInt(
      carryoverRaw?.suggestMinCompacts,
      d.carryover.suggestMinCompacts,
      1,
      50,
    ),
  };

  return deepFreeze({ budget, midTurn, digest, pins, carryover });
}

/**
 * 列出**显式写过**的 `context.*` 键（点分路径），供体检页核对「现在按什么在跑」。
 * 只报告真的被识别到的键；未知键也会列出（拼错的键需要被发现，而不是静默忽略）。
 */
export function collectContextTuningKeys(
  policy: LawMindWorkspacePolicy | null | undefined,
): string[] {
  const ctx = asObject(policy?.context);
  if (!ctx) {
    return [];
  }
  const keys: string[] = [];
  const pushFlat = (prefix: string, obj: Record<string, unknown> | undefined): void => {
    if (!obj) {
      return;
    }
    for (const key of Object.keys(obj)) {
      keys.push(`${prefix}.${key}`);
    }
  };
  pushFlat(
    "context",
    Object.fromEntries(Object.entries(ctx).filter(([, v]) => asObject(v) === undefined)),
  );
  pushFlat("context.midTurn", asObject(ctx.midTurn));
  pushFlat("context.digest", asObject(ctx.digest));
  pushFlat("context.pins", asObject(ctx.pins));
  pushFlat("context.carryover", asObject(ctx.carryover));
  return keys.toSorted();
}

/** 只取 budget 组（旧 `resolveContextPolicy` 的兼容视图）。 */
export function resolveContextPolicy(policy: LawMindWorkspacePolicy | null | undefined) {
  return resolveContextTuning(policy).budget;
}
