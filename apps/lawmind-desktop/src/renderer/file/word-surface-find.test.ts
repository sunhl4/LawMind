/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { findInParagraphTexts, stepFindIndex } from "./word-surface-find";

describe("word-surface-find", () => {
  it("finds all occurrences across paragraphs", () => {
    const hits = findInParagraphTexts(["甲方应于十日内付款。", "违约金十日。"], "十日");
    expect(hits).toEqual([
      { paragraphIndex: 0, start: 4, end: 6 },
      { paragraphIndex: 1, start: 3, end: 5 },
    ]);
  });

  it("returns empty for blank query", () => {
    expect(findInParagraphTexts(["甲"], "  ")).toEqual([]);
  });

  it("steps find index circularly", () => {
    expect(stepFindIndex(-1, 3, 1)).toBe(0);
    expect(stepFindIndex(2, 3, 1)).toBe(0);
    expect(stepFindIndex(0, 3, -1)).toBe(2);
  });
});
