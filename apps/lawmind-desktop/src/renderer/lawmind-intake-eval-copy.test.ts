import { describe, expect, it } from "vitest";
import { matchingEvalLine } from "./lawmind-intake-eval-copy";

describe("matchingEvalLine", () => {
  it("renders one sentence when lawyer labels exist", () => {
    expect(
      matchingEvalLine({
        falseAttach: 0,
        recallAt1: 1,
        source: { labeled: 3, scanMayBeTruncated: false },
      }),
    ).toBe("判案评测：最近 3 条律师归案，误归 0，第一名命中 100%。");
  });

  it("marks a truncated scan and a null recall", () => {
    expect(
      matchingEvalLine({
        falseAttach: 1,
        recallAt1: null,
        source: { labeled: 500, scanMayBeTruncated: true },
      }),
    ).toContain("（只看最近 500 条）");
    expect(
      matchingEvalLine({
        falseAttach: 1,
        recallAt1: null,
        source: { labeled: 500, scanMayBeTruncated: true },
      }),
    ).toContain("命中 —");
  });

  it("stays quiet without lawyer labels", () => {
    expect(
      matchingEvalLine({
        falseAttach: 0,
        recallAt1: null,
        source: { labeled: 0, scanMayBeTruncated: false },
      }),
    ).toBeNull();
    expect(matchingEvalLine(null)).toBeNull();
  });
});
