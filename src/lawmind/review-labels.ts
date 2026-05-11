import type { ReviewLabel } from "./types.js";

/** 与 `ReviewLabel` 同步，供 API 校验与 UI 展示顺序 */
export const ALL_REVIEW_LABELS: readonly ReviewLabel[] = [
  "语气过强",
  "语气过弱",
  "引用不完整",
  "引用有误",
  "争点遗漏",
  "争点过度论证",
  "事实顺序不当",
  "事实不准确",
  "风险偏高",
  "风险偏低",
  "风险未标注",
  "受众定位不当",
  "模板不匹配",
  "质量范例",
];

const LABEL_SET = new Set<string>(ALL_REVIEW_LABELS);

/** 旧版英文标识 → 当前中文枚举（解析请求体时兼容历史数据与脚本） */
export const REVIEW_LABEL_LEGACY_ENGLISH: Readonly<Record<string, ReviewLabel>> = {
  "tone.too_strong": "语气过强",
  "tone.too_weak": "语气过弱",
  "citation.incomplete": "引用不完整",
  "citation.incorrect": "引用有误",
  "issue.missing": "争点遗漏",
  "issue.over_argued": "争点过度论证",
  "fact.ordering": "事实顺序不当",
  "fact.inaccurate": "事实不准确",
  "risk.calibration_high": "风险偏高",
  "risk.calibration_low": "风险偏低",
  "risk.missing_flag": "风险未标注",
  "audience.wrong_framing": "受众定位不当",
  "structure.template_mismatch": "模板不匹配",
  "quality.good_example": "质量范例",
};

/** 从请求体解析审核标签；非法项丢弃；兼容旧版英文 slug */
export function parseReviewLabels(raw: unknown): ReviewLabel[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: ReviewLabel[] = [];
  for (const x of raw) {
    if (typeof x !== "string") {
      continue;
    }
    if (LABEL_SET.has(x)) {
      out.push(x as ReviewLabel);
      continue;
    }
    const mapped = REVIEW_LABEL_LEGACY_ENGLISH[x];
    if (mapped) {
      out.push(mapped);
    }
  }
  return out.length > 0 ? out : undefined;
}
