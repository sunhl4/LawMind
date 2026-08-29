import { describe, expect, it } from "vitest";
import { runLegalLint } from "../run-lint.js";
import { loanFamilyApplies } from "./loan.js";

describe("loan family", () => {
  it("fires extra rules on 借款/借贷/贷款 contracts", () => {
    const report = runLegalLint("借款合同。甲方出借，乙方收款。");
    expect(loanFamilyApplies("借款合同")).toBe(true);
    expect(report.findings.some((f) => f.family === "loan")).toBe(true);
    expect(report.findings.some((f) => f.ruleId === "loan.repayment")).toBe(true);
    expect(report.findings.some((f) => f.ruleId === "loan.interest")).toBe(true);
  });

  it("does not fire loan rules on a sale draft", () => {
    const report = runLegalLint("供货合同。甲方交付货物，乙方验收，规格型号见国家标准。");
    expect(report.findings.some((f) => f.family === "loan")).toBe(false);
  });
});
