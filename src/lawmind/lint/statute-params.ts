/**
 * Versioned mechanical parameters for legal lint.
 * Wrong params are worse than no lint — keep source + effectiveFrom on every row.
 */

export const STATUTE_PARAMS_VERSION = 1;

export type StatuteParamRow = {
  id: string;
  value: number;
  unit: "ratio" | "years" | "rate";
  effectiveFrom: string;
  source: string;
  noteZh: string;
};

/** 定金不得超过主合同标的额的 20%（民法典第 586 条）。 */
export const DEPOSIT_CAP: StatuteParamRow = {
  id: "deposit.cap",
  value: 0.2,
  unit: "ratio",
  effectiveFrom: "2021-01-01",
  source: "民法典第586条",
  noteZh: "定金不得超过主合同标的额的百分之二十",
};

/** 普通诉讼时效三年（民法典第 188 条）。 */
export const DEFAULT_LIMITATION: StatuteParamRow = {
  id: "limitation.ordinary",
  value: 3,
  unit: "years",
  effectiveFrom: "2017-10-01",
  source: "民法典第188条",
  noteZh: "向人民法院请求保护民事权利的诉讼时效期间为三年",
};

/**
 * 民间借贷利率司法保护上限：合同成立时一年期 LPR × 4。
 * LPR 历史序列尚未入库——本行只锁倍数与出处，不算已实现利率核对。
 */
export const PRIVATE_LENDING_LPR_MULTIPLE: StatuteParamRow = {
  id: "private_lending.lpr_multiple",
  value: 4,
  unit: "rate",
  effectiveFrom: "2020-08-20",
  source: "最高人民法院关于审理民间借贷案件适用法律若干问题的规定第25条",
  noteZh: "利率上限为合同成立时一年期贷款市场报价利率的四倍（LPR 序列待补）",
};

export function listStatuteParams(): StatuteParamRow[] {
  return [DEPOSIT_CAP, DEFAULT_LIMITATION, PRIVATE_LENDING_LPR_MULTIPLE];
}
