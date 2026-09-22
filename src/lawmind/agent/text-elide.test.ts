import { describe, expect, it } from "vitest";
import { ELIDE_MIN_BUDGET, elideMiddle, formatElisionMarker } from "./text-elide.js";

describe("elideMiddle (Codex-style head+tail elision)", () => {
  it("returns text unchanged when it already fits", () => {
    const result = elideMiddle("短文书", 100);
    expect(result.elided).toBe(false);
    expect(result.elidedChars).toBe(0);
    expect(result.text).toBe("短文书");
  });

  it("keeps both the head and the tail, marking what was removed", () => {
    const head = "原告：某公司。案号（2026）冀0722民初123号。";
    const middle = "中".repeat(5_000);
    const tail = "具状人：某公司。日期：2026-09-19。";
    const full = `${head}${middle}${tail}`;
    const budget = 400;
    const result = elideMiddle(full, budget);
    expect(result.elided).toBe(true);
    // 尾部必须存活：法院/金额/日期/具状人常在文书末尾。
    expect(result.text).toContain("具状人：某公司");
    expect(result.text).toContain("2026-09-19");
    // 头部同样存活。
    expect(result.text).toContain("案号（2026）冀0722民初123号");
    // 省略量被显式标注，模型据此知道「这不是全文」。
    expect(result.text).toContain("中间省略");
    expect(result.text).toContain(String(result.elidedChars));
    // 省略量 = 全长 − 预算（头尾保留量正好等于预算）。
    expect(result.elidedChars).toBe(full.length - budget);
  });

  it("reports the elided count so callers can surface it", () => {
    const result = elideMiddle("a".repeat(10_000), 1_000);
    expect(result.elidedChars).toBe(9_000);
    expect(result.text.length).toBeGreaterThan(1_000); // 标记本身也占字符
    expect(result.text).toContain(formatElisionMarker(9_000));
  });

  it("degrades to a head cut when the budget cannot fit a marker", () => {
    const result = elideMiddle("x".repeat(5_000), ELIDE_MIN_BUDGET - 1);
    expect(result.elided).toBe(true);
    expect(result.text.length).toBe(ELIDE_MIN_BUDGET - 1);
    expect(result.text).not.toContain("中间省略");
  });

  it("does not split a surrogate pair", () => {
    const text = "🙂".repeat(500);
    const result = elideMiddle(text, 300);
    expect(result.elided).toBe(true);
    // 无孤立代理项（否则 JSON/模型侧会看到乱码）。
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result.text)).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result.text)).toBe(false);
  });
});
