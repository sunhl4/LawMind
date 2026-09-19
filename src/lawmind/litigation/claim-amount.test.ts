import { describe, expect, it } from "vitest";
import { parseChineseAmount, parseClaimAmount } from "./claim-amount.js";

describe("parseClaimAmount", () => {
  it("reads plain numbers, thousands separators, and 元 suffixes", () => {
    expect(parseClaimAmount("32100")).toMatchObject({ ok: true, yuan: 32_100 });
    expect(parseClaimAmount("32,100 元")).toMatchObject({ ok: true, yuan: 32_100 });
    expect(parseClaimAmount("人民币 32100 元")).toMatchObject({ ok: true, yuan: 32_100 });
    expect(parseClaimAmount("￥32,100.50")).toMatchObject({ ok: true, yuan: 32_100.5 });
  });

  it("applies the 万 multiplier", () => {
    expect(parseClaimAmount("3.21万元")).toMatchObject({ ok: true, yuan: 32_100 });
    expect(parseClaimAmount("15万")).toMatchObject({ ok: true, yuan: 150_000 });
    expect(parseClaimAmount("32.1万元")).toMatchObject({ ok: true, yuan: 321_000 });
  });

  it("reads Chinese numerals in both cases", () => {
    expect(parseClaimAmount("叁万贰仟壹佰元")).toMatchObject({ ok: true, yuan: 32_100 });
    expect(parseClaimAmount("三万二千一百元")).toMatchObject({ ok: true, yuan: 32_100 });
    expect(parseClaimAmount("十五万元")).toMatchObject({ ok: true, yuan: 150_000 });
    expect(parseChineseAmount("一百二十")).toBe(120);
    expect(parseChineseAmount("一万零五十")).toBe(10_050);
  });

  it("fails honestly instead of guessing when the text is ambiguous", () => {
    const result = parseClaimAmount("本金 32100 元，另案主张 50000 元");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("多个金额");
      expect(result.candidates?.toSorted((a, b) => a - b)).toEqual([32_100, 50_000]);
    }
  });

  it("fails honestly on empty or unreadable input", () => {
    expect(parseClaimAmount("").ok).toBe(false);
    expect(parseClaimAmount("   ").ok).toBe(false);
    expect(parseClaimAmount("以实际结算为准").ok).toBe(false);
  });

  it("ignores bare numbers without a unit inside longer prose (case numbers, years)", () => {
    // 裸数字（案号年份）不算金额；只有一个带单位金额时按它算。
    expect(parseClaimAmount("（2026）冀0722民初123号 诉请 32100 元")).toMatchObject({
      ok: true,
      yuan: 32_100,
    });
  });
});
