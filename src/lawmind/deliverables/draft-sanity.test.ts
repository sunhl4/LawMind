import { describe, expect, it } from "vitest";
import { countPlaceholderLikeMarkers, heuristicPlaceholderRatio } from "./draft-sanity.js";

describe("draft-sanity", () => {
  it("counts common placeholder markers", () => {
    const s = "租金 __RENT__ 与押金 __DEPOSIT__ 及【待补充】与 ???";
    expect(countPlaceholderLikeMarkers(s)).toBeGreaterThanOrEqual(4);
  });

  it("heuristicPlaceholderRatio is high for empty", () => {
    expect(heuristicPlaceholderRatio("   ")).toBe(1);
  });

  it("heuristicPlaceholderRatio is low for dense finished prose", () => {
    const prose = "双方确认本合同自签署之日起生效，共十条，适用中华人民共和国法律。".repeat(8);
    expect(heuristicPlaceholderRatio(prose)).toBeLessThan(0.1);
  });

  it("heuristicPlaceholderRatio rises with many markers in short text", () => {
    const bad = "甲：___ 乙：___ 第__条 __PRICE__ ???";
    expect(heuristicPlaceholderRatio(bad)).toBeGreaterThan(0.3);
  });
});
