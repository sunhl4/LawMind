import { describe, expect, it } from "vitest";
import { parseSectionToSlideContent } from "./pptx-slide-layouts.js";

describe("pptx-slide-layouts", () => {
  it("detects agenda layout", () => {
    const c = parseSectionToSlideContent("议程", "1. 背景\n2. 规则\n3. 行动");
    expect(c.layout).toBe("agenda");
    expect(c.bullets.length).toBe(3);
  });

  it("detects markdown matrix", () => {
    const c = parseSectionToSlideContent(
      "管辖矩阵",
      `| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |`,
    );
    expect(c.layout).toBe("matrix");
    expect(c.matrix?.length).toBeGreaterThanOrEqual(2);
  });

  it("uses two-column for long bullet lists", () => {
    const c = parseSectionToSlideContent(
      "规则要点",
      ["- a", "- b", "- c", "- d", "- e"].join("\n"),
    );
    expect(c.layout).toBe("twoColumn");
    expect(c.left?.length).toBeGreaterThan(0);
    expect(c.right?.length).toBeGreaterThan(0);
  });

  it("uses checklist for 红旗清单", () => {
    const c = parseSectionToSlideContent("红旗清单", "- 未评估\n- 无合同条款");
    expect(c.layout).toBe("checklist");
  });
});
