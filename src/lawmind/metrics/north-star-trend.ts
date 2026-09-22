/**
 * 北极星**趋势**：把一次性数字变成曲线。
 *
 * ## 为什么需要它（科学口径）
 *
 * `buildNorthStarSnapshot` 给的是**一个点**：到目前为止的首过率 / 逃逸率。
 * 一个点回答不了「这套东西有没有让律师越用越省事」，因为水平值会被三类噪声污染：
 * 案件难度分布、律师个人风格、产品改版。**只有同一家所的前后期对比**才有意义——
 * 跨所横比测到的是风格差异，不是能力提升。
 *
 * 所以本模块只做一件事：按固定时间桶切出**同一工作区的纵向序列**，供人看趋势。
 * 它**不做**回归、不做显著性、不预测未来——那几个桶的样本量撑不起这些方法，
 * 硬做出来的是伪科学。
 *
 * ## 三条诚实约束（都有测试锁定）
 *
 * 1. **样本不足的桶报 `null`，不是 0%。** 一个桶里只有 1 次交付时，
 *    「首过率 100%」与「首过率 0%」信息量相同——都等于没有信息。
 * 2. **桶数不足时不给趋势结论。** `trend` 会返回 `null` 并写明原因，而不是拿两三个点
 *    画一条看着很鼓舞人的线。
 * 3. **只按周分桶，不做自适应窗口。** 桶宽一旦随数据浮动，不同时间跑出来的曲线不可比，
 *    而「可比」正是这份产物唯一的价值。
 *
 * ## 与 `north-star.ts` 的关系
 *
 * 两者都是 `product-events.jsonl` 的**派生物**，重算永远安全，落盘只为省一次扫描。
 * 口径必须与 `north-star.ts` 逐字一致（否则两个数会打架）：
 * 逃逸只计 `lint_escape` + `lawyer_edit`；一次通过看 `first_pass`；
 * 交付分母 = `first_pass` + `rewrite`。
 */

import fs from "node:fs";
import path from "node:path";
import { northStarTrendPath } from "./north-star.js";
import { listProductMetricEvents } from "./product-metrics.js";

/** 一个桶里至少要有几次交付，才允许报比率。低于此值只报计数。 */
export const MIN_DELIVERIES_PER_BUCKET = 5;

/** 至少要有几个「够样本」的桶，才允许给趋势结论。 */
export const MIN_BUCKETS_FOR_TREND = 3;

export type NorthStarBucket = {
  /** ISO 周（周一起算），形如 `2026-W38`。 */
  week: string;
  /** 该周第一天（本地日期，`YYYY-MM-DD`）。 */
  weekStart: string;
  deliveries: number;
  firstPassOk: number;
  firstPassFail: number;
  lintEscapes: number;
  unattended: number;
  attended: number;
  /**
   * 比率。**交付数 < MIN_DELIVERIES_PER_BUCKET 时为 `null`**——
   * 样本太少的比率会剧烈跳动，报出来只会误导。
   */
  firstPassRate: number | null;
  lintEscapeRate: number | null;
  unattendedCompleteRate: number | null;
  /** 该周改稿幅度样本数（`kind=rewrite_amplitude`）。 */
  rewriteAmplitudeSamples: number;
  /**
   * 改稿幅度**中位数**（字符，取绝对值）。
   *
   * 为什么用中位数不用均值：改稿幅度是重尾分布——一次整稿重写能把均值拉飞，
   * 而中位数回答的是「通常改多少」，那才是「越用越省事」要测的东西。
   * 样本不足时 `null`（同 `MIN_DELIVERIES_PER_BUCKET` 门槛）。
   */
  rewriteAmplitudeMedianChars: number | null;
};

export type NorthStarTrend = {
  schemaVersion: 1;
  capturedAt: string;
  /** 统计窗口（天）。 */
  windowDays: number;
  buckets: NorthStarBucket[];
  /**
   * 趋势结论。桶不足时 `null`——**不拿两三个点画线**。
   */
  trend: {
    /** 有足够样本的桶数（= 结论的样本量）。 */
    usableBuckets: number;
    firstPassRateDelta: number;
    lintEscapeRateDelta: number;
    /**
     * 改稿幅度中位数差值（字符，**负数 = 改得少了 = 变好**）。
     *
     * **仅当每个可用桶都有幅度样本时才有值**——否则 `null`。
     * 为什么不用「有就平均」：若只有一半的周有幅度数据，差值就是在比不同的东西，
     * 那种数字比没有更糟（看起来像结论，其实是采样偏差）。
     */
    rewriteAmplitudeDeltaChars: number | null;
    /** 幅度未进结论的原因（`null` = 进了）。 */
    amplitudeUnavailableReason: string | null;
    /** `improving` = 三项全都往好的方向；口径见 `directionOf`。 */
    direction: "improving" | "worsening" | "flat" | "mixed";
  } | null;
  /** `trend` 为 null 的原因（可诊断，不是空白）。 */
  trendUnavailableReason: string | null;
};

function rate(ok: number, total: number): number | null {
  if (total <= 0) {
    return null;
  }
  return ok / total;
}

/** ISO 周编号 + 该周周一（用 UTC 构造，避免夏令时把日期挪一天）。 */
function isoWeekOf(ts: Date): { week: string; weekStart: string } {
  const d = new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate()));
  // ISO：周四是所在周的中点，用它定位年份可避开跨年周归属错误。
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Thursday = new Date(jan4);
  jan4Thursday.setUTCDate(jan4.getUTCDate() + 3 - ((jan4.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((thursday.getTime() - jan4Thursday.getTime()) / (7 * 86_400_000));
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return {
    week: `${isoYear}-W${String(week).padStart(2, "0")}`,
    weekStart: monday.toISOString().slice(0, 10),
  };
}

/**
 * 趋势方向：多项指标投票。
 *
 * 三条判据方向不同（首过率**升**是好，逃逸率与改稿幅度**降**是好），所以先把每项
 * 折算成「更好 / 更坏 / 没动」，再投票：
 *   - 全是「没动」→ `flat`
 *   - 所有表态都是「更好」→ `improving`
 *   - 所有表态都是「更坏」→ `worsening`
 *   - 其余（有分歧）→ `mixed`
 *
 * **不允许挑好看的那一项报。** 分歧时只能说 `mixed`——这正是报告最容易作弊的地方。
 * `amplitudeDelta` 传 `null` 表示该项无样本、不参与投票（不当作「没动」）。
 */
function directionOf(input: {
  firstPassDelta: number;
  escapeDelta: number;
  amplitudeDelta: number | null;
}): "improving" | "worsening" | "flat" | "mixed" {
  /** 比率用 0.5 个百分点作为「没动」的容忍；幅度是字符数，1 字符以下视为没动。 */
  const RATIO_EPS = 0.005;
  const CHARS_EPS = 1;
  const votes: Array<"better" | "worse"> = [];
  const push = (delta: number, diminishingIsGood: boolean, tolerance: number): void => {
    if (Math.abs(delta) <= tolerance) {
      return;
    }
    const improving = diminishingIsGood ? delta < 0 : delta > 0;
    votes.push(improving ? "better" : "worse");
  };
  push(input.firstPassDelta, false, RATIO_EPS);
  push(input.escapeDelta, true, RATIO_EPS);
  if (input.amplitudeDelta !== null) {
    push(input.amplitudeDelta, true, CHARS_EPS);
  }
  const better = votes.filter((v) => v === "better").length;
  const worse = votes.filter((v) => v === "worse").length;
  if (votes.length === 0) {
    return "flat";
  }
  if (worse === 0) {
    return "improving";
  }
  if (better === 0) {
    return "worsening";
  }
  return "mixed";
}

/** 中位数（空数组返回 null）。 */
function medianOf(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? null;
  }
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (lo == null || hi == null) {
    return null;
  }
  return (lo + hi) / 2;
}

export function buildNorthStarTrend(
  workspaceDir: string,
  opts?: { windowDays?: number; now?: Date },
): NorthStarTrend {
  const windowDays = Math.max(1, Math.min(365, opts?.windowDays ?? 90));
  const now = opts?.now ?? new Date();
  const from = new Date(now.getTime() - windowDays * 86_400_000);

  type Acc = {
    deliveries: number;
    firstPassOk: number;
    firstPassFail: number;
    lintEscapes: number;
    unattended: number;
    attended: number;
    amplitudes: number[];
  };
  const byWeek = new Map<string, { weekStart: string; acc: Acc }>();

  for (const ev of listProductMetricEvents(workspaceDir)) {
    const at = new Date(ev.ts);
    if (Number.isNaN(at.getTime()) || at < from || at > now) {
      continue;
    }
    const { week, weekStart } = isoWeekOf(at);
    let row = byWeek.get(week);
    if (!row) {
      row = {
        weekStart,
        acc: {
          deliveries: 0,
          firstPassOk: 0,
          firstPassFail: 0,
          lintEscapes: 0,
          unattended: 0,
          attended: 0,
          amplitudes: [],
        },
      };
      byWeek.set(week, row);
    }
    const acc = row.acc;
    // 口径与 north-star.ts 逐字一致：交付分母 = first_pass + rewrite。
    if (ev.kind === "first_pass") {
      acc.deliveries += 1;
      if (ev.outcome === "ok") {
        acc.firstPassOk += 1;
      } else {
        acc.firstPassFail += 1;
      }
    } else if (ev.kind === "rewrite") {
      acc.deliveries += 1;
    } else if (ev.kind === "lint_escape" && ev.outcome === "lawyer_edit") {
      acc.lintEscapes += 1;
    } else if (ev.kind === "delivery_autonomy") {
      if (ev.outcome === "unattended") {
        acc.unattended += 1;
      } else if (ev.outcome === "attended") {
        acc.attended += 1;
      }
    } else if (ev.kind === "rewrite_amplitude") {
      /**
       * 只取**律师直接改稿**（`source === "lawyer_edit"`）。
       *
       * 为什么必须过滤：同一 kind 下有两种语义完全不同的样本 ——
       *   - `lawyer_edit`：律师在文书台改了多少 → **本判据要测的编辑负担**
       *   - `assistant_revision`：助手后台修订改了多少 → 模型行为指标
       * 混在一起算中位数，得到的既不是律师负担也不是模型行为。
       *
       * 兼容性：本字段 2026-09-22 才加，此前的事件没有 `source`。
       * 那些事件**只能来自**助手修订路径（当时唯一的产出点），所以按
       * `assistant_revision` 归类是准确的，不会把助手样本错算成律师样本。
       */
      const source = typeof ev.meta?.source === "string" ? ev.meta.source : "assistant_revision";
      if (source !== "lawyer_edit") {
        continue;
      }
      // 取绝对值：方向（变长/变短）不是我们要测的，「改了多少」才是。
      const absRaw = ev.meta?.absCharDelta;
      const signedRaw = ev.meta?.charDelta;
      const value =
        typeof absRaw === "number" && Number.isFinite(absRaw)
          ? Math.abs(absRaw)
          : typeof signedRaw === "number" && Number.isFinite(signedRaw)
            ? Math.abs(signedRaw)
            : null;
      if (value !== null) {
        acc.amplitudes.push(value);
      }
    }
  }

  const buckets: NorthStarBucket[] = [...byWeek.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([week, { weekStart, acc }]) => {
      const enough = acc.deliveries >= MIN_DELIVERIES_PER_BUCKET;
      return {
        week,
        weekStart,
        deliveries: acc.deliveries,
        firstPassOk: acc.firstPassOk,
        firstPassFail: acc.firstPassFail,
        lintEscapes: acc.lintEscapes,
        unattended: acc.unattended,
        attended: acc.attended,
        firstPassRate: enough ? rate(acc.firstPassOk, acc.firstPassOk + acc.firstPassFail) : null,
        lintEscapeRate: enough ? rate(acc.lintEscapes, acc.deliveries) : null,
        unattendedCompleteRate: enough ? rate(acc.unattended, acc.unattended + acc.attended) : null,
        rewriteAmplitudeSamples: acc.amplitudes.length,
        rewriteAmplitudeMedianChars: enough ? medianOf(acc.amplitudes) : null,
      };
    });

  const usable = buckets.filter((b) => b.firstPassRate !== null && b.lintEscapeRate !== null);
  const base: Omit<NorthStarTrend, "trend" | "trendUnavailableReason"> = {
    schemaVersion: 1,
    capturedAt: now.toISOString(),
    windowDays,
    buckets,
  };

  if (usable.length < MIN_BUCKETS_FOR_TREND) {
    return {
      ...base,
      trend: null,
      trendUnavailableReason:
        usable.length === 0
          ? `窗口内没有一周达到 ${MIN_DELIVERIES_PER_BUCKET} 次交付，趋势无从谈起（不编 0%）`
          : `只有 ${usable.length} 周达到足够样本（需 ≥ ${MIN_BUCKETS_FOR_TREND} 周），现在给趋势结论会是噪声`,
    };
  }

  const first = usable[0];
  const last = usable[usable.length - 1];
  const firstPassRateDelta = (last.firstPassRate ?? 0) - (first.firstPassRate ?? 0);
  const lintEscapeRateDelta = (last.lintEscapeRate ?? 0) - (first.lintEscapeRate ?? 0);

  /**
   * 幅度：**要么每个可用桶都有，要么不给结论**。
   *
   * 只用后半段、或用「有什么算什么」的做法都会引入采样偏差——那条曲线看起来像
   * 「改得越来越少」，实际只是样本覆盖变了。宁可说「这项没有可比样本」。
   */
  const hasAllAmplitude = usable.every((b) => b.rewriteAmplitudeMedianChars !== null);
  const rewriteAmplitudeDeltaChars = hasAllAmplitude
    ? (last.rewriteAmplitudeMedianChars ?? 0) - (first.rewriteAmplitudeMedianChars ?? 0)
    : null;
  const amplitudeUnavailableReason = hasAllAmplitude
    ? null
    : `改稿幅度只有 ${usable.filter((b) => b.rewriteAmplitudeMedianChars !== null).length}/${usable.length} 个可用周有样本（口径：**律师直接改稿**，即 product-events 里 rewrite_amplitude 且 meta.source=lawyer_edit），不足以同口径比较（不切成两段分别算）`;

  return {
    ...base,
    trend: {
      usableBuckets: usable.length,
      firstPassRateDelta,
      lintEscapeRateDelta,
      rewriteAmplitudeDeltaChars,
      amplitudeUnavailableReason,
      direction: directionOf({
        firstPassDelta: firstPassRateDelta,
        escapeDelta: lintEscapeRateDelta,
        amplitudeDelta: rewriteAmplitudeDeltaChars,
      }),
    },
    trendUnavailableReason: null,
  };
}

export function readNorthStarTrend(workspaceDir: string): NorthStarTrend {
  try {
    const raw = fs.readFileSync(northStarTrendPath(workspaceDir), "utf8");
    const parsed = JSON.parse(raw) as NorthStarTrend | undefined;
    if (parsed?.schemaVersion === 1) {
      return parsed;
    }
  } catch {
    /* missing or corrupt — rebuild below */
  }
  return persistNorthStarTrend(workspaceDir);
}

export function persistNorthStarTrend(
  workspaceDir: string,
  opts?: { windowDays?: number; now?: Date },
): NorthStarTrend {
  const trend = buildNorthStarTrend(workspaceDir, opts);
  const target = northStarTrendPath(workspaceDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(trend, null, 2)}\n`, "utf8");
  return trend;
}
