/**
 * Versioned mechanical parameters for legal lint.
 * Wrong params are worse than no lint — keep source + effectiveFrom on every row.
 */

export const STATUTE_PARAMS_VERSION = 3;

export type StatuteParamRow = {
  id: string;
  value: number;
  unit: "ratio" | "years" | "months" | "rate" | "periods";
  effectiveFrom: string;
  source: string;
  noteZh: string;
};

/** 非数值型法定默认规则（只有出处与说明，不参与数值比较）。 */
export type StatuteDefaultRow = {
  id: string;
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

/**
 * 租赁期限不得超过二十年（民法典第 705 条），超过部分无效。
 * 参数与措辞待执业法律顾问复核。
 */
export const LEASE_TERM_MAX_YEARS: StatuteParamRow = {
  id: "lease.term_max_years",
  value: 20,
  unit: "years",
  effectiveFrom: "2021-01-01",
  source: "民法典第705条",
  noteZh: "租赁期限不得超过二十年，超过部分无效；续订亦同",
};

/**
 * 试用期阶梯上限（劳动合同法第 19 条）：合同期 3 月–1 年→≤1 月；
 * 1–3 年→≤2 月；≥3 年或无固定期限→≤6 月；合同期 <3 月或以完成一定工作
 * 任务为期限→不得约定试用期。本行只锁最严上限 6 个月，阶梯由规则侧实现。
 * 参数与措辞待执业法律顾问复核。
 */
export const PROBATION_MAX_MONTHS: StatuteParamRow = {
  id: "employment.probation_max_months",
  value: 6,
  unit: "months",
  effectiveFrom: "2008-01-01",
  source: "劳动合同法第19条",
  noteZh: "试用期上限随合同期限阶梯递增，最长不超过六个月",
};

/**
 * 竞业限制期限不得超过二年（劳动合同法第 24 条）。
 * 参数与措辞待执业法律顾问复核。
 */
export const NONCOMPETE_MAX_YEARS: StatuteParamRow = {
  id: "employment.noncompete_max_years",
  value: 2,
  unit: "years",
  effectiveFrom: "2008-01-01",
  source: "劳动合同法第24条",
  noteZh: "竞业限制的人员、范围、期限由约定，但期限不得超过二年",
};

/**
 * 保证方式没有约定或约定不明时按一般保证处理（民法典第 686 条）。
 * 注意与旧担保法的连带默认相反——提示性质，非缺陷。
 * 参数与措辞待执业法律顾问复核。
 */
export const GUARANTEE_DEFAULT_GENERAL: StatuteDefaultRow = {
  id: "guarantee.default_form",
  effectiveFrom: "2021-01-01",
  source: "民法典第686条",
  noteZh: "保证方式没有约定或约定不明的，按照一般保证承担保证责任",
};

/**
 * 建设工程最低保修期（建设工程质量管理条例第 40 条）：屋面防水工程、有防水要求的
 * 卫生间、房间和外墙面的防渗漏为 5 年。适用除外：保修期自竣工验收合格之日起算；
 * 未列举项目的保修期限由发包方与承包方约定。参数与措辞待执业法律顾问复核。
 */
export const CONSTRUCTION_WARRANTY_ROOF_YEARS: StatuteParamRow = {
  id: "construction.warranty_roof_years",
  value: 5,
  unit: "years",
  effectiveFrom: "2000-01-30",
  source: "建设工程质量管理条例第40条",
  noteZh: "屋面防水工程、有防水要求的卫生间、房间和外墙面的防渗漏，最低保修期为5年",
};

/**
 * 建设工程最低保修期（同条）：电气管线、给排水管道、设备安装和装修工程为 2 年。
 * 适用除外同上行。参数与措辞待执业法律顾问复核。
 */
export const CONSTRUCTION_WARRANTY_MEP_YEARS: StatuteParamRow = {
  id: "construction.warranty_mep_years",
  value: 2,
  unit: "years",
  effectiveFrom: "2000-01-30",
  source: "建设工程质量管理条例第40条",
  noteZh: "电气管线、给排水管道、设备安装和装修工程，最低保修期为2年",
};

/**
 * 建设工程最低保修期（同条）：供热与供冷系统为 2 个采暖期、供冷期。
 * 单位为「期」而非年——规则侧按个数比较。参数与措辞待执业法律顾问复核。
 */
export const CONSTRUCTION_WARRANTY_HEATING_PERIODS: StatuteParamRow = {
  id: "construction.warranty_heating_periods",
  value: 2,
  unit: "periods",
  effectiveFrom: "2000-01-30",
  source: "建设工程质量管理条例第40条",
  noteZh: "供热与供冷系统，最低保修期为2个采暖期、供冷期",
};

export function listStatuteParams(): StatuteParamRow[] {
  return [
    DEPOSIT_CAP,
    DEFAULT_LIMITATION,
    PRIVATE_LENDING_LPR_MULTIPLE,
    LEASE_TERM_MAX_YEARS,
    PROBATION_MAX_MONTHS,
    NONCOMPETE_MAX_YEARS,
    CONSTRUCTION_WARRANTY_ROOF_YEARS,
    CONSTRUCTION_WARRANTY_MEP_YEARS,
    CONSTRUCTION_WARRANTY_HEATING_PERIODS,
  ];
}

export function listStatuteDefaults(): StatuteDefaultRow[] {
  return [GUARANTEE_DEFAULT_GENERAL];
}
