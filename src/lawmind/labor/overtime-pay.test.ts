import { describe, expect, it } from "vitest";
import { computeOvertimePay } from "./overtime-pay.js";

describe("overtime-pay", () => {
  it("uses 150/200/300% on the same hourly wage", () => {
    const base = { hours: 8, monthlyWageYuan: 8700 };
    const hourly = 8700 / 21.75 / 8;
    expect(computeOvertimePay({ ...base, kind: "weekday" }).amountYuan).toBeCloseTo(
      hourly * 8 * 1.5,
      1,
    );
    expect(computeOvertimePay({ ...base, kind: "rest_day" }).multiplier).toBe(2);
    expect(computeOvertimePay({ ...base, kind: "statutory_holiday" }).multiplier).toBe(3);
  });
});
