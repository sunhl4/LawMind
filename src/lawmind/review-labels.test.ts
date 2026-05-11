import { describe, expect, it } from "vitest";
import {
  ALL_REVIEW_LABELS,
  parseReviewLabels,
  REVIEW_LABEL_LEGACY_ENGLISH,
} from "./review-labels.js";

describe("parseReviewLabels", () => {
  it("accepts current Chinese identifiers", () => {
    expect(parseReviewLabels(["语气过强", "引用不完整"])).toEqual(["语气过强", "引用不完整"]);
  });

  it("maps legacy English slugs to Chinese ReviewLabel", () => {
    expect(parseReviewLabels(["tone.too_strong", "citation.incomplete"])).toEqual([
      "语气过强",
      "引用不完整",
    ]);
  });

  it("drops unknown strings", () => {
    expect(parseReviewLabels(["语气过强", "not-a-label", ""])).toEqual(["语气过强"]);
  });

  it("returns undefined for non-array", () => {
    expect(parseReviewLabels(null)).toBeUndefined();
    expect(parseReviewLabels({})).toBeUndefined();
  });

  it("returns undefined when no valid labels remain", () => {
    expect(parseReviewLabels(["x"])).toBeUndefined();
  });
});

describe("REVIEW_LABEL_LEGACY_ENGLISH", () => {
  it("covers every canonical label", () => {
    const mapped = new Set(Object.values(REVIEW_LABEL_LEGACY_ENGLISH));
    for (const lb of ALL_REVIEW_LABELS) {
      expect(mapped.has(lb)).toBe(true);
    }
  });
});
