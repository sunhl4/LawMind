import type { ReviewLabel } from "./types.js";

/** 与 `ReviewLabel` 同步，供 API 校验 */
export const ALL_REVIEW_LABELS: readonly ReviewLabel[] = [
  "tone.too_strong",
  "tone.too_weak",
  "citation.incomplete",
  "citation.incorrect",
  "issue.missing",
  "issue.over_argued",
  "fact.ordering",
  "fact.inaccurate",
  "risk.calibration_high",
  "risk.calibration_low",
  "risk.missing_flag",
  "audience.wrong_framing",
  "structure.template_mismatch",
  "quality.good_example",
];

const LABEL_SET = new Set<string>(ALL_REVIEW_LABELS);

/** 从请求体解析审核标签；非法项丢弃 */
export function parseReviewLabels(raw: unknown): ReviewLabel[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: ReviewLabel[] = [];
  for (const x of raw) {
    if (typeof x === "string" && LABEL_SET.has(x)) {
      out.push(x as ReviewLabel);
    }
  }
  return out.length > 0 ? out : undefined;
}
