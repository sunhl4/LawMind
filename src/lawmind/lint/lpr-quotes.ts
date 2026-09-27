/**
 * 一年期贷款市场报价利率的阶梯表：只记变动日，不记每月原样重报。
 * 出处：中国人民银行授权全国银行间同业拆借中心公布。
 * 最后一档在下一次公布前有效；超过 LPR_SERIES_VALID_THROUGH 必须写缺口，不得外推。
 * 民间借贷司法保护上限自 2020-08-20 起按合同成立时一年期 LPR 的四倍。本表不填利息，只供核对。
 */

export const LPR_QUOTES_VERSION = 1;
export const LPR_QUOTES_SOURCE =
  "中国人民银行授权全国银行间同业拆借中心公布的一年期贷款市场报价利率";
/** 四倍上限的施行日（民间借贷司法解释第 25 条，2020 年修正）。 */
export const LPR_CAP_EFFECTIVE_FROM = "2020-08-20";
/** 已核对到的最后一次公布日。此后至有效期末仍用最后一档，不外推新数字。 */
export const LPR_SERIES_LAST_PUBLICATION = "2026-09-21";
/** 含本日。下一次常规公布约在 2026-10-20，此前未入库的新报价不得沿用旧档。 */
export const LPR_SERIES_VALID_THROUGH = "2026-10-19";

export type OneYearLprQuote = {
  effectiveFrom: string;
  /** 百分数，如 3.1 表示 3.10%。 */
  oneYearPercent: number;
};

/** 只保留利率变动日，按生效日升序。 */
export const ONE_YEAR_LPR_QUOTES: readonly OneYearLprQuote[] = [
  { effectiveFrom: "2019-08-20", oneYearPercent: 4.25 },
  { effectiveFrom: "2019-09-20", oneYearPercent: 4.2 },
  { effectiveFrom: "2019-11-20", oneYearPercent: 4.15 },
  { effectiveFrom: "2020-02-20", oneYearPercent: 4.05 },
  { effectiveFrom: "2020-04-20", oneYearPercent: 3.85 },
  { effectiveFrom: "2021-12-20", oneYearPercent: 3.8 },
  { effectiveFrom: "2022-01-20", oneYearPercent: 3.7 },
  { effectiveFrom: "2022-08-22", oneYearPercent: 3.65 },
  { effectiveFrom: "2023-06-20", oneYearPercent: 3.55 },
  { effectiveFrom: "2023-08-21", oneYearPercent: 3.45 },
  { effectiveFrom: "2024-07-22", oneYearPercent: 3.35 },
  { effectiveFrom: "2024-10-21", oneYearPercent: 3.1 },
  { effectiveFrom: "2025-05-20", oneYearPercent: 3 },
];

export type OneYearLprLookup =
  | { ok: true; quote: OneYearLprQuote; capPercent: number }
  | { ok: false; gap: string };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function ymdFromParts(y: number, m: number, d: number): string | undefined {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return undefined;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return undefined;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return undefined;
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 合同成立日的一年期 LPR。日期落在表外时只返回缺口，不沿用最近一档。 */
export function lookupOneYearLpr(contractYmd: string): OneYearLprLookup {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contractYmd)) {
    return { ok: false, gap: "合同成立日不是完整日期，不能查一年期 LPR。" };
  }
  const first = ONE_YEAR_LPR_QUOTES[0];
  if (!first || contractYmd < first.effectiveFrom) {
    return {
      ok: false,
      gap: `合同成立日早于 ${first?.effectiveFrom ?? "报价改革"}，一年期 LPR 序列不适用。`,
    };
  }
  if (contractYmd < LPR_CAP_EFFECTIVE_FROM) {
    return {
      ok: false,
      gap: `合同成立日早于 ${LPR_CAP_EFFECTIVE_FROM}，四倍 LPR 上限尚未施行，不按本表核算。`,
    };
  }
  if (contractYmd > LPR_SERIES_VALID_THROUGH) {
    return {
      ok: false,
      gap: `一年期 LPR 序列只核对到 ${LPR_SERIES_LAST_PUBLICATION} 的公布（有效至 ${LPR_SERIES_VALID_THROUGH}）。此后须律师提供当期报价，不得外推。`,
    };
  }
  let hit = first;
  for (const row of ONE_YEAR_LPR_QUOTES) {
    if (row.effectiveFrom <= contractYmd) {
      hit = row;
    } else {
      break;
    }
  }
  return { ok: true, quote: hit, capPercent: Number((hit.oneYearPercent * 4).toFixed(4)) };
}
