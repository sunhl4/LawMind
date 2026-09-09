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
});
