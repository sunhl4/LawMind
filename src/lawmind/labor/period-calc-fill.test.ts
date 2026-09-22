import { describe, expect, it } from "vitest";
import { extractPeriodCalcFill, formatPeriodCalcBody } from "./period-calc-fill.js";

describe("period-calc-fill", () => {
  it("computes 上诉期 from a Chinese start date", () => {
    const fill = extractPeriodCalcFill("2024年1月1日送达判决，计算上诉期届满日");
    expect(fill.kind).toBe("civil_appeal");
    expect(fill.start).toBe("2024-01-01");
    expect(fill.result?.expires).toBe("2024-01-16");
    expect(formatPeriodCalcBody(fill)).toContain("2024-01-16");
  });

  it("leaves 届满日 empty when the date is missing", () => {
    const fill = extractPeriodCalcFill("计算上诉期届满日");
    expect(fill.result).toBeUndefined();
    expect(fill.gaps).toContain("起算日（须到日）");
    expect(formatPeriodCalcBody(fill)).toContain("未代算");
  });
});
