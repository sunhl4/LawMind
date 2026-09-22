/**
 * 判断项棘轮（P4）——把 `progressive-autonomy.ts` 的「测量换信任」从**交付**推广到**判断项**。
 *
 * > **命名注意（不统一是历史原因）**：本文件用英式拼写 `judgement-ratchet`，
 * > 而同域的 `guardian/judgment-tier.ts` / `guardian/item-judgments.ts` /
 * > `delivery/judgment-labels.ts` 用美式 `judgment-*`。**grep 本域时两个拼写都要搜。**
 * > 改名会牵动文档与既有引用，故保留并在两处都留了指向对方的注释。
 *
 * ## 为什么是「扩域」而不是「新机制」
 *
 * `isAutonomyUnlocked` 已经实现了这套逻辑：双序列达标才解锁，且刻意防了
 * 「橡皮图章一次通过」（单靠 first-pass 不够，必须有逃逸率序列对照）。
 * 判断项的升级是**同一个问题**的不同实例：
 *
 * | | 交付自动放行 | 判断项 advisory → blocking |
 * | -------------- | -------------------------------------- | ------------------------------------------ |
 * | 升级对象 | 某交付类 × 某律师 | 某个判断项（lint 规则 / Guardian 检查项） |
 * | 主要危害 | 放行了本该看的稿 | **拦住了本该放行的稿**（误报） |
 * | 需要的证据 | firstPassRate + lintEscapeRate | precision 代理 + escapeRate |
 * | 退化处理 | 纯函数 → 自动回锁 | 纯函数 → 自动回锁 |
 *
 * 所以本模块**复用** `isAutonomyUnlocked` 的形状与三条不变量，不新造机制。
 *
 * ## 为什么升级判据是 precision 而不是 recall
 *
 * 一个判断项从 advisory 升 blocking，意味着它**获得拦停交付的权力**。
 * 此时危害结构翻转了：
 *   - advisory 阶段，漏报的代价 = 律师没看到提示（他自己会看稿）；
 *   - blocking 阶段，误报的代价 = **律师被迫处理一个不存在的缺陷**，
 *     且多来几次他会学会绕过整个机制（"狼来了"）。
 *
 * 所以升级看的是「报了之后律师是否认可」，即 precision 方向；
 * 而 escapeRate（漏报）作为**对照序列**存在，防止只看 precision 的自我实现
 * ——这正是 `isAutonomyUnlocked` 那句注释的同一理由：
 * *A rubber-stamp first-pass series alone is not enough.*
 *
 * ## 三条不变量（与 `isAutonomyUnlocked` 完全一致）
 *
 * 1. **缺序列不解锁**：`null`（没有该序列）与 `0`（空序列）都拒绝。
 * 2. **样本量达标**：样本太少时比例没有意义。
 * 3. **退化自动回锁**：本模块是**纯函数**，输入退化则输出自动变 false，
 *    不需要任何「回滚」逻辑。这是把棘轮写成纯函数而非状态机的全部好处。
 */

/**
 * 判断项在团队/律师维度的累积战绩。
 *
 * 术语：`fired` = 该项在稿子上报了问题。`clean` = 那次交付一次通过、无实质修改。
 */
export type JudgementItemSeries = {
  itemId: string;
  /** 该项报过问题的样本数（分母）。 */
  firedSamples: number;
  /**
   * 其中交付后**一次通过**（律师未实质修改）的样本数。
   *
   * 这是**误报代理**：报了问题而律师认为无需改动，说明这次报的可能不值得拦。
   * 注意它是代理而非精确标签——律师可能只是没空改（见 §偏置）。
   */
  firedClean: number;
  /**
   * 漏报序列：该项**未报**但律师仍动手改的样本数。
   *
   * `null` = 该序列缺失（不得据此解锁）。`0` = 有序列但为空。
   * 与 `firedSamples` 不同，漏报**无法精确归因到具体判断项**——
   * 改稿可能是别的原因引起的。所以它只作为**对照存在性检查**，
   * 不参与比例计算（见 `isJudgementItemPromotable`）。
   */
  missedAndEdited: number | null;
  /**
   * 法律顾问是否已验收该项的判据。
   *
   * **硬前提，不可绕过。** 依据 `lint/statute-params.ts:3`：
   * *Wrong params are worse than no lint*。一个判错的规则拿到拦停权，
   * 比它不拦更糟——它会教律师不信任整套核对。
   */
  advisorAccepted: boolean;
};

export type JudgementPromotionThresholds = {
  /** 最少样本数。默认 20（与 `DEFAULT_PROGRESSIVE_AUTONOMY.minSamples` 对齐）。 */
  minSamples: number;
  /**
   * 误报率上限：`firedClean / firedSamples` 不得超过此值。
   * 默认 0.10——比交付侧的 `maxLintEscapeRate`（0.15）更严，
   * 因为误报会直接挡住律师的路，而逃逸只是少了一条提示。
   */
  maxFalsePositiveRate: number;
};

export const DEFAULT_JUDGEMENT_PROMOTION = {
  minSamples: 20,
  maxFalsePositiveRate: 0.1,
} as const;

/** 拒绝/通过的原因码（机器可读，便于 Doctor 与聚合统计）。 */
export type JudgementPromotionReason =
  | "promotable"
  | "advisor_not_accepted"
  | "insufficient_samples"
  | "escape_series_missing"
  | "false_positive_rate_above_cap";

export type JudgementPromotionVerdict = {
  itemId: string;
  promotable: boolean;
  reason: JudgementPromotionReason;
  /** 人可读说明（工程师/Doctor 用；不进律师可见面）。 */
  detail: string;
  /** 误报率；`firedSamples === 0` 时为 null（不编造 0）。 */
  falsePositiveRate: number | null;
  samples: number;
};

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function resolveJudgementPromotionThresholds(
  policy?: {
    judgementPromotion?: {
      minSamples?: number;
      maxFalsePositiveRate?: number;
    };
  } | null,
): JudgementPromotionThresholds {
  const raw = policy?.judgementPromotion;
  const minSamples = finiteNonNegative(raw?.minSamples);
  const maxFalsePositiveRate = finiteNonNegative(raw?.maxFalsePositiveRate);
  return {
    minSamples:
      minSamples !== null ? Math.floor(minSamples) : DEFAULT_JUDGEMENT_PROMOTION.minSamples,
    maxFalsePositiveRate:
      maxFalsePositiveRate !== null
        ? maxFalsePositiveRate
        : DEFAULT_JUDGEMENT_PROMOTION.maxFalsePositiveRate,
  };
}

/**
 * 单个判断项是否可从 advisory 升 blocking。
 *
 * **纯函数**：所有判定只依赖入参，所以「退化自动回锁」是结构性的而非流程性的
 * ——不需要审计一次「撤销」，只要序列退化，结果自然变 false。
 *
 * 判定顺序（先硬前提，后统计）：
 *   1. `advisorAccepted` —— 法律顾问未验收，一律拒绝（硬前提）。
 *   2. `firedSamples >= minSamples` —— 样本不足拒绝。
 *   3. `missedAndEdited !== null` —— 无对照序列拒绝（防止只看 precision 的自我实现）。
 *   4. `falsePositiveRate <= maxFalsePositiveRate` —— 误报超标拒绝。
 */
export function isJudgementItemPromotable(
  series: JudgementItemSeries,
  thresholds: JudgementPromotionThresholds = DEFAULT_JUDGEMENT_PROMOTION,
): JudgementPromotionVerdict {
  const firedSamples = Math.max(0, Math.floor(finiteNonNegative(series.firedSamples) ?? 0));
  const rawClean = Math.max(0, Math.floor(finiteNonNegative(series.firedClean) ?? 0));
  // 脏数据防御：`firedClean > firedSamples` 说明上游聚合错了。
  // 夹到 firedSamples 而不是让比例 >1 ——比例是概率量，>1 在 Doctor 里无法解释；
  // 夹取后误报率为 1.0，仍然会被上限拒绝，所以**不掩盖**问题，只是把它变成可读的形状。
  const firedClean = Math.min(rawClean, firedSamples);
  const samples = firedSamples;
  const falsePositiveRate = firedSamples > 0 ? firedClean / firedSamples : null;

  const base = { itemId: series.itemId, falsePositiveRate, samples };

  if (!series.advisorAccepted) {
    return {
      ...base,
      promotable: false,
      reason: "advisor_not_accepted",
      detail: "法律顾问尚未验收该项判据——判错的规则拿到拦停权比不拦更糟。",
    };
  }
  if (firedSamples < thresholds.minSamples) {
    return {
      ...base,
      promotable: false,
      reason: "insufficient_samples",
      detail: `样本不足：${firedSamples} < ${thresholds.minSamples}。比例在此样本量上没有意义。`,
    };
  }
  if (series.missedAndEdited === null) {
    return {
      ...base,
      promotable: false,
      reason: "escape_series_missing",
      detail:
        "缺少漏报对照序列（missedAndEdited=null）。只看误报会退化成「越少报越好」，与『别漏』冲突。",
    };
  }
  if (falsePositiveRate !== null && falsePositiveRate > thresholds.maxFalsePositiveRate) {
    return {
      ...base,
      promotable: false,
      reason: "false_positive_rate_above_cap",
      detail:
        `误报率 ${(falsePositiveRate * 100).toFixed(1)}% 高于上限 ` +
        `${(thresholds.maxFalsePositiveRate * 100).toFixed(1)}%：升 blocking 会拦住本该放行的稿。`,
    };
  }
  return {
    ...base,
    promotable: true,
    reason: "promotable",
    detail: `样本 ${firedSamples}、误报率 ${((falsePositiveRate ?? 0) * 100).toFixed(1)}%、有对照序列、顾问已验收。`,
  };
}

/**
 * 批量判决：返回可直接用于 advisory→blocking 决策的集合。
 *
 * **注意**：本函数只给判决，不改任何门禁。真正的生效点必须显式消费
 * `promotable === true` 的项（见计划 §7：P4 的动作是扩域，不是自动升级）。
 */
export function resolvePromotableJudgementItems(
  series: readonly JudgementItemSeries[],
  thresholds?: JudgementPromotionThresholds,
): {
  verdicts: JudgementPromotionVerdict[];
  promotable: string[];
  rejectedByReason: Record<JudgementPromotionReason, string[]>;
} {
  const verdicts = series.map((s) => isJudgementItemPromotable(s, thresholds));
  const rejectedByReason = {
    promotable: [] as string[],
    advisor_not_accepted: [] as string[],
    insufficient_samples: [] as string[],
    escape_series_missing: [] as string[],
    false_positive_rate_above_cap: [] as string[],
  } satisfies Record<JudgementPromotionReason, string[]>;
  for (const v of verdicts) {
    rejectedByReason[v.reason].push(v.itemId);
  }
  return {
    verdicts,
    promotable: verdicts.filter((v) => v.promotable).map((v) => v.itemId),
    rejectedByReason,
  };
}

/**
 * 从 P0 的决策样本派生判断项序列。
 *
 * **诚实边界**：`firedClean` 是**误报代理**，不是精确标签。理由：
 *   - 决策样本的记录粒度是**任务**，不是「判断项 → 律师动作」的因果链；
 *   - 一次交付里可能有多个判断项报过，无法确定律师的改动是针对哪一个；
 *   - 被静默放行的动作不产生样本（见 `agent/dangerous-tool-policy.ts`）。
 *
 * 因此本函数只在**一个判断项独占该任务的报项**时才计入，避免把
 * 「同任务里别的项报的」算到本项头上。这会让可用样本变少——
 * **宁可少算，也不要算错**（判错的规则会拿到拦停权）。
 */
export function deriveJudgementItemSeries(input: {
  /** 按任务聚合的报项记录：taskId → 该任务报过的判断项 id 列表。 */
  firedByTask: ReadonlyArray<{
    taskId: string;
    itemIds: readonly string[];
    cleanDelivery: boolean;
  }>;
  /** 漏报计数：无归因，只作为序列存在性。`null` 表示该维度没有数据。 */
  missedAndEditedCount: number | null;
  /** 已通过法律顾问验收的项 id 集合。 */
  advisorAcceptedItemIds: ReadonlySet<string>;
}): JudgementItemSeries[] {
  const acc = new Map<string, { firedSamples: number; firedClean: number }>();

  for (const task of input.firedByTask) {
    const uniqueItems = [...new Set(task.itemIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueItems.length === 0) {
      continue;
    }
    for (const id of uniqueItems) {
      const row = acc.get(id) ?? { firedSamples: 0, firedClean: 0 };
      row.firedSamples += 1;
      // 只有「本任务只有这一项报过」时才敢把 clean 归因给它。
      if (task.cleanDelivery && uniqueItems.length === 1) {
        row.firedClean += 1;
      }
      acc.set(id, row);
    }
  }

  return [...acc.entries()]
    .map(([itemId, row]) => ({
      itemId,
      firedSamples: row.firedSamples,
      firedClean: row.firedClean,
      missedAndEdited: input.missedAndEditedCount,
      advisorAccepted: input.advisorAcceptedItemIds.has(itemId),
    }))
    .toSorted((a, b) => a.itemId.localeCompare(b.itemId));
}

/** 供 Doctor / CLI：一行一条的判决摘要。 */
export function describeJudgementPromotion(
  verdicts: readonly JudgementPromotionVerdict[],
): string[] {
  if (verdicts.length === 0) {
    return ["尚无判断项战绩——没有任何项报过问题，故无可升级项。"];
  }
  return verdicts.map((v) => {
    const rate =
      v.falsePositiveRate === null ? "（无样本）" : `${(v.falsePositiveRate * 100).toFixed(1)}%`;
    return `${v.promotable ? "[可升]" : "[保留]"} ${v.itemId} · 样本 ${v.samples} · 误报 ${rate} · ${v.reason}`;
  });
}
