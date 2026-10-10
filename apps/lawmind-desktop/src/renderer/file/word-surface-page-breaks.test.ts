/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { computePageBreaks, usablePageContentHeight } from "./word-surface-page-breaks";

describe("computePageBreaks", () => {
  it("places a break when content exceeds one page", () => {
    const usable = 200;
    const paras = [
      { offsetTop: 0, offsetHeight: 80 },
      { offsetTop: 80, offsetHeight: 80 },
      { offsetTop: 160, offsetHeight: 80 },
      { offsetTop: 240, offsetHeight: 80 },
    ];
    const breaks = computePageBreaks(paras, usable);
    expect(breaks.length).toBeGreaterThanOrEqual(1);
    expect(breaks[0]?.page).toBe(2);
    expect(breaks[0]?.top).toBe(200);
  });

  it("returns no breaks for a short document", () => {
    expect(
      computePageBreaks(
        [
          { offsetTop: 0, offsetHeight: 40 },
          { offsetTop: 40, offsetHeight: 40 },
        ],
        500,
      ),
    ).toEqual([]);
  });

  it("computes usable height from page margins", () => {
    expect(usablePageContentHeight({ widthPx: 794, marginTopPx: 96, marginRightPx: 96, marginBottomPx: 96, marginLeftPx: 96 })).toBeCloseTo(
      1122.52 - 192,
      0,
    );
  });
});
