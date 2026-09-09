import { describe, expect, it } from "vitest";
import {
  compensationMonthsFromYears,
  computeEconomicCompensation,
} from "./economic-compensation.js";

describe("economic-compensation", () => {
  it("maps six-month fractions to half or full months", () => {
    expect(compensationMonthsFromYears(0.4)).toBe(0.5);
    expect(compensationMonthsFromYears(0.6)).toBe(1);
    expect(compensationMonthsFromYears(3)).toBe(3);
    expect(compensationMonthsFromYears(3.7)).toBe(4);
  });

  it("computes N, N+1 and 2N from the same slots", () => {
    const base = { yearsOfService: 3, monthlyWageYuan: 10_000 };
    expect(computeEconomicCompensation({ ...base, kind: "N" }).amountYuan).toBe(30_000);
    expect(computeEconomicCompensation({ ...base, kind: "N+1" }).amountYuan).toBe(40_000);
    expect(computeEconomicCompensation({ ...base, kind: "2N" }).amountYuan).toBe(60_000);
  });

  it("caps high wage at 3x local average and 12 years", () => {
    const out = computeEconomicCompensation({
      yearsOfService: 20,
      monthlyWageYuan: 40_000,
      localAverageWageYuan: 10_000,
      kind: "N",
    });
    expect(out.cappedWageYuan).toBe(30_000);
    expect(out.nMonths).toBe(12);
    expect(out.amountYuan).toBe(360_000);
  });
});
