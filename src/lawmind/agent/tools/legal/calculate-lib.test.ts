import { describe, expect, it } from "vitest";
import { addCalendarYears, calculateLegal, daysBetweenYmd } from "./calculate-lib.js";

describe("calculate-lib", () => {
  it("computes simple interest with a fixed formula", () => {
    const r = calculateLegal("interest", {
      principal: 100000,
      annualRate: 0.035,
      start: "2024-01-01",
      end: "2024-07-01",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    const days = daysBetweenYmd("2024-01-01", "2024-07-01");
    expect(r.result.formula).toBe(`100000 × 0.035 × ${days} / 365`);
    expect(r.result.inputs.days).toBe(days);
    expect(r.result.value).toBeCloseTo((100000 * 0.035 * (days ?? 0)) / 365, 1);
  });

  it("sums LPR segments supplied by the lawyer", () => {
    const r = calculateLegal("interest_lpr", {
      principal: 10000,
      segments: [
        { start: "2024-01-01", end: "2024-02-01", annualRate: 0.036 },
        { start: "2024-02-01", end: "2024-03-01", annualRate: 0.0345 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.result.formula).toContain("10000 × 0.036 × 31 / 365");
    expect(String(r.result.notes)).toMatch(/不查询/);
  });

  it("rejects oversized column_sum", () => {
    const r = calculateLegal("column_sum", { values: Array.from({ length: 2001 }, () => 1) });
    expect(r.ok).toBe(false);
  });

  it("computes limitation expiry on a calendar year", () => {
    expect(addCalendarYears("2021-02-28", 3)).toBe("2024-02-28");
    const r = calculateLegal("limitation", { start: "2021-03-01" });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.result.value).toBe("2024-03-01");
    expect(r.result.formula).toContain("3 年");
  });

  it("date_span and column math", () => {
    expect(daysBetweenYmd("2024-01-01", "2024-01-31")).toBe(30);
    const sum = calculateLegal("column_sum", { values: [1, 2, 3] });
    expect(sum.ok && sum.result.value).toBe(6);
    const w = calculateLegal("weighted_average", { values: [10, 20], weights: [1, 3] });
    expect(w.ok && w.result.value).toBe(17.5);
    const d = calculateLegal("liquidated_damages", { base: 100, ratio: 0.3 });
    expect(d.ok && d.result.value).toBe(30);
    expect(d.ok && String(d.result.notes)).toMatch(/调减/);
  });

  it("computes economic compensation, overtime and legal period via the same tool", () => {
    const n = calculateLegal("economic_compensation", {
      yearsOfService: 3,
      monthlyWageYuan: 10_000,
      kind: "2N",
    });
    expect(n.ok && n.result.value).toBe(60_000);
    const ot = calculateLegal("overtime_pay", {
      hours: 8,
      monthlyWageYuan: 8700,
      kind: "weekday",
    });
    expect(ot.ok && typeof ot.result.value).toBe("number");
    const dw = calculateLegal("double_wage", {
      unsignedMonthsAfterFirst: 3,
      monthlyWageYuan: 8000,
    });
    expect(dw.ok && dw.result.value).toBe(24_000);
    const p = calculateLegal("legal_period", { kind: "civil_appeal", start: "2024-01-01" });
    expect(p.ok && p.result.value).toBe("2024-01-16");
  });

  it("computes 诉讼费 from a numeric amount or from free-text 标的金额", () => {
    const byNumber = calculateLegal("litigation_fee", {
      caseKind: "property",
      amountYuan: 150_000,
    });
    expect(byNumber.ok).toBe(true);
    if (!byNumber.ok) {
      return;
    }
    expect(byNumber.result.value).toBe(3_300);

    // 卷宗里的自由文本同样可算（3.21 万 → 602.5）。
    const byText = calculateLegal("litigation_fee", {
      caseKind: "property",
      amountText: "3.21万元",
    });
    expect(byText.ok && byText.result.value).toBeCloseTo(602.5, 2);
  });

  it("reports 保全/执行申请费 and 减半 alongside the acceptance fee", () => {
    const r = calculateLegal("litigation_fee", {
      caseKind: "property",
      amountYuan: 150_000,
      preservedAmountYuan: 1_000_000,
      executionAmountYuan: 110_000,
      simplified: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    // 3300 + 保全 5000（封顶）+ 执行 1550
    expect(r.result.value).toBe(3_300 + 5_000 + 1_550);
    expect(r.result.notes).toContain("保全申请费");
    expect(r.result.notes).toContain("已达 5000 元上限");
    expect(r.result.notes).toContain("简易程序");
    expect(r.result.notes).toContain("诉讼费用交纳办法");
  });

  it("refuses to pick a number for 幅度类收费 and for ambiguous amounts", () => {
    const divorce = calculateLegal("litigation_fee", { caseKind: "divorce" });
    expect(divorce.ok).toBe(true);
    if (divorce.ok) {
      expect(divorce.result.formula).toContain("幅度");
      expect(divorce.result.notes).toContain("省级政府");
    }
    const ambiguous = calculateLegal("litigation_fee", {
      caseKind: "property",
      amountText: "本金 32100 元，另案 50000 元",
    });
    expect(ambiguous.ok).toBe(false);
  });

  it("rejects unknown case kinds instead of defaulting silently", () => {
    const bad = calculateLegal("litigation_fee", { caseKind: "divorce_bogus", amountYuan: 1 });
    expect(bad.ok).toBe(false);
  });
});
