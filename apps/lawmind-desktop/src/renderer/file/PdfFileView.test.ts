import { describe, expect, it } from "vitest";
import { fitViewerScale } from "./pdf-preview-scale";

describe("fitViewerScale", () => {
  it("fits a letter-width page into the scroller with padding", () => {
    // 612pt page → 816 CSS px at 100% (96/72)
    const scale = fitViewerScale(848, 612);
    expect(scale).toBeCloseTo(1, 2);
  });

  it("returns a stable stepped scale for small width jitter", () => {
    const a = fitViewerScale(700, 612);
    const b = fitViewerScale(704, 612);
    expect(a).toBe(b);
  });
});
