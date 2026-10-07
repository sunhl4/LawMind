import { describe, expect, it } from "vitest";
import { packRailCardTops } from "./word-surface-rail.ts";

describe("packRailCardTops", () => {
  it("keeps each balloon beside its mark when they do not overlap", () => {
    const packed = packRailCardTops([
      { wanted: 420, height: 80 },
      { wanted: 510, height: 64 },
    ]);
    expect(packed.tops).toEqual([420, 510]);
    expect(packed.height).toBe(582);
  });

  it("pushes a later balloon down when the previous card would cover it", () => {
    const packed = packRailCardTops([
      { wanted: 100, height: 80 },
      { wanted: 120, height: 40 },
    ]);
    expect(packed.tops).toEqual([100, 188]);
  });

  it("orders by page position, not by array order", () => {
    const packed = packRailCardTops([
      { wanted: 800, height: 40 },
      { wanted: 120, height: 40 },
    ]);
    expect(packed.tops).toEqual([800, 120]);
  });

  it("keeps unanchored cards after the ones that still have a page mark", () => {
    const packed = packRailCardTops([
      { wanted: Number.POSITIVE_INFINITY, height: 24 },
      { wanted: 90, height: 24 },
    ]);
    expect(packed.tops).toEqual([122, 90]);
  });
});
