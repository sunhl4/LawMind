import { describe, expect, it } from "vitest";
import { runLegalLint } from "../run-lint.js";
import { saleFamilyApplies } from "./sale.js";

describe("sale family", () => {
  it("fires extra rules on 买卖/供货/采购 contracts", () => {
    const report = runLegalLint("买卖合同。甲方出售货物，乙方付款。价款一万元。");
    expect(saleFamilyApplies("买卖合同")).toBe(true);
    expect(report.findings.some((f) => f.family === "sale")).toBe(true);
    expect(report.findings.some((f) => f.ruleId === "sale.acceptance")).toBe(true);
    expect(report.findings.some((f) => f.ruleId === "sale.delivery")).toBe(true);
  });

  it("does not fire sale rules on unrelated drafts", () => {
    const report = runLegalLint("法律备忘：请核对签章栏是否齐全。");
    expect(report.findings.some((f) => f.family === "sale")).toBe(false);
  });
});
