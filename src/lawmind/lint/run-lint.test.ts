import { describe, expect, it } from "vitest";
import { LEGAL_LINT_RULES } from "./rules.js";
import { draftTextFromUnknown, runLegalLint } from "./run-lint.js";

describe("runLegalLint", () => {
  it("blocks deposit over 20% and or-arbitrate-or-sue", () => {
    const report = runLegalLint(
      ["第一条 定金为本合同标的额的 30%。", "第二条 争议既可以申请仲裁也可以向人民法院起诉。"].join(
        "\n",
      ),
    );
    expect(LEGAL_LINT_RULES.length).toBeGreaterThanOrEqual(20);
    expect(report.ruleCount).toBeGreaterThanOrEqual(20);
    expect(report.blockerCount).toBeGreaterThanOrEqual(2);
    expect(report.findings.some((f) => f.ruleId === "statutory.deposit_cap")).toBe(true);
    expect(report.findings.some((f) => f.ruleId === "form.or_arbitrate_or_sue")).toBe(true);
    expect(report.coverageNote).toContain("通过 ≠ 法律正确");
  });

  it("warns on open placeholders", () => {
    const report = runLegalLint("本合同甲方为【待补充】，标的额 10000 元。");
    expect(report.findings.some((f) => f.ruleId === "placeholder.open")).toBe(true);
  });

  it("extracts draft section text", () => {
    expect(
      draftTextFromUnknown({
        draft: { title: "供货合同", sections: [{ heading: "第一条", body: "定金 10%。" }] },
      }),
    ).toContain("定金 10%");
  });

  it("warns on high liquidated damages but does not block", () => {
    const report = runLegalLint("本协议违约金为标的额的 35%。");
    const hit = report.findings.find((f) => f.ruleId === "statutory.liquidated_damages_high");
    expect(hit?.severity).toBe("warning");
    expect(report.findings.some((f) => f.ruleId === "statutory.deposit_cap")).toBe(false);
  });

  it("warns when guarantee exists without a period", () => {
    const report = runLegalLint("丙方作为保证人就主债务承担连带责任保证。");
    expect(report.findings.some((f) => f.ruleId === "form.guarantee_period")).toBe(true);
  });

  it("warns when 见附件 has no annex list", () => {
    const report = runLegalLint("质量标准见附件，双方按该标准验收。");
    expect(report.findings.some((f) => f.ruleId === "consistency.annex_list")).toBe(true);
  });

  it("warns when a contract names only one party", () => {
    const report = runLegalLint("本合同甲方负责供货，价款按月结算。");
    expect(report.findings.some((f) => f.ruleId === "consistency.party_pair")).toBe(true);
  });

  it("asks for manual LPR check only when a rate number and LPR both appear", () => {
    const withBoth = runLegalLint("借款年利率 24%，且不超过合同成立时一年期 LPR 四倍。");
    expect(withBoth.findings.some((f) => f.ruleId === "statutory.lpr_multiple")).toBe(true);
    expect(withBoth.findings.find((f) => f.ruleId === "statutory.lpr_multiple")?.message).toContain(
      "需人工核 LPR",
    );
    const rateOnly = runLegalLint("借款年利率 24%，按月付息。");
    expect(rateOnly.findings.some((f) => f.ruleId === "statutory.lpr_multiple")).toBe(false);
  });

  it("flags limitation wording that exceeds three years", () => {
    const report = runLegalLint("双方确认诉讼时效期间超过三年。");
    expect(report.findings.some((f) => f.ruleId === "statutory.limitation_period")).toBe(true);
  });
});
