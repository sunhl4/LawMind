import { describe, expect, it } from "vitest";
import { parseChartSpec } from "./chart-spec.js";
import { renderChartSvg } from "./chart-svg.js";

const base = {
  title: "金额",
  categories: ["一", "二"],
  series: [{ name: "A", values: [1, 2] }],
};

describe("chart spec", () => {
  it("rejects series length mismatch", () => {
    const parsed = parseChartSpec({
      ...base,
      type: "bar",
      series: [{ name: "A", values: [1] }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/不一致/);
    }
  });

  it.each(["bar", "line", "pie", "stacked_bar"] as const)("renders %s svg", (type) => {
    const parsed = parseChartSpec({ ...base, type });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const svg = renderChartSvg(parsed.spec);
    expect(svg).toContain("<svg");
    expect(svg).toContain("lm-chart-svg");
  });

  it("rejects too many categories", () => {
    const parsed = parseChartSpec({
      title: "多",
      type: "bar",
      categories: Array.from({ length: 30 }, (_, i) => String(i)),
      series: [{ name: "A", values: Array.from({ length: 30 }, () => 1) }],
    });
    expect(parsed.ok).toBe(false);
  });

  it("escapes pie labels in svg", () => {
    const parsed = parseChartSpec({
      title: "饼",
      type: "pie",
      categories: ["<script>x</script>"],
      series: [{ name: "A", values: [1] }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const svg = renderChartSvg(parsed.spec);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("renders empty-state copy", () => {
    const parsed = parseChartSpec({
      title: "空",
      type: "bar",
      categories: ["x"],
      series: [{ name: "A", values: [0] }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(renderChartSvg(parsed.spec)).toContain("暂无数据");
  });
});
