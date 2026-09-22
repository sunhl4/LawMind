import { describe, expect, it } from "vitest";
import {
  extractLaborCalcFill,
  formatLaborArbitrationBody,
  formatLaborCalcBody,
} from "./labor-calc-fill.js";

describe("labor-calc-fill", () => {
  it("runs 2N through the engine when years and wage are in the instruction", () => {
    const fill = extractLaborCalcFill("工作3年月薪10000，计算违法解除的经济补偿");
    expect(fill.kind).toBe("2N");
    expect(fill.yearsOfService).toBe(3);
    expect(fill.monthlyWageYuan).toBe(10_000);
    expect(fill.compensation?.amountYuan).toBe(60_000);
    expect(formatLaborCalcBody(fill)).toContain("10000 × 3 × 2");
    expect(formatLaborCalcBody(fill)).toContain("禁止口算");
  });

  it("does not invent a wage when the instruction has none", () => {
    const fill = extractLaborCalcFill("计算违法解除的经济补偿");
    expect(fill.compensation).toBeUndefined();
    expect(fill.gaps).toContain("月工资");
    expect(formatLaborCalcBody(fill)).toContain("缺槽未代算");
  });

  it("computes rest-day overtime when hours and wage are present", () => {
    const fill = extractLaborCalcFill("月薪10000，周末加班8小时");
    expect(fill.overtime?.kind).toBe("rest_day");
    expect(fill.overtime?.amountYuan).toBeGreaterThan(0);
  });

  it("runs arbitration limitation from a 解除 date, not from 入职", () => {
    const fill = extractLaborCalcFill("2020年1月1日入职，2024年1月1日被违法解除，工作3年月薪10000");
    expect(fill.arbitration?.start).toBe("2024-01-01");
    expect(fill.arbitration?.expires).toBe("2025-01-01");
    expect(formatLaborArbitrationBody(fill)).toContain("2025-01-01");
    expect(formatLaborArbitrationBody(fill)).not.toContain("calculate");

    const noDate = extractLaborCalcFill("计算违法解除的经济补偿");
    expect(noDate.arbitration).toBeUndefined();
    expect(formatLaborArbitrationBody(noDate)).toContain("【待补充】");
  });
});
