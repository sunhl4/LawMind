import { describe, expect, it } from "vitest";
import { LEGAL_LINT_RULES } from "./rules.js";
import { draftTextFromUnknown, runLegalLint } from "./run-lint.js";
import type { LegalLintRule } from "./types.js";

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

  it("flags a defined term that is never used again", () => {
    const report = runLegalLint(
      "第一条 「目标公司」（以下简称目标公司）由甲方设立。第二条 乙方按约付款。",
    );
    expect(report.findings.some((f) => f.ruleId === "consistency.defined_terms")).toBe(true);
  });

  it("flags limitation wording that exceeds three years", () => {
    const report = runLegalLint("双方确认诉讼时效期间超过三年。");
    expect(report.findings.some((f) => f.ruleId === "statutory.limitation_period")).toBe(true);
  });

  it("flags the pre-Civil-Code two-year limitation wording (两年/二年)", () => {
    const hit = runLegalLint("双方确认诉讼时效为两年。").findings.find(
      (f) => f.ruleId === "statutory.limitation_period",
    );
    expect(hit?.severity).toBe("warning");
    expect(hit?.statuteRef).toBe("民法典第188条");
    expect(
      runLegalLint("双方确认诉讼时效为二年。").findings.some(
        (f) => f.ruleId === "statutory.limitation_period",
      ),
    ).toBe(true);
  });

  it("stays silent on the statutory three-year limitation wording", () => {
    expect(
      runLegalLint("双方确认诉讼时效为三年。").findings.some(
        (f) => f.ruleId === "statutory.limitation_period",
      ),
    ).toBe(false);
  });
});

describe("statutory.lpr_legacy_rate", () => {
  const hit = (text: string) =>
    runLegalLint(text).findings.find((f) => f.ruleId === "statutory.lpr_legacy_rate");

  it("reminds when a lending draft hard-codes the retired 24%/36% benchmarks", () => {
    const h = hit("借款合同。年利率24%，按月付息。");
    expect(h?.severity).toBe("info");
    expect(h?.message).toContain("LPR 四倍");
    expect(h?.statuteRef).toContain("民间借贷");
    expect(hit("借款合同。利率不超过36%。")).toBeDefined();
  });

  it("stays silent on other rates, non-lending texts, or LPR-aware drafts", () => {
    expect(hit("借款合同。年利率13.8%，按月付息。")).toBeUndefined();
    expect(hit("借款合同。年利率124%，按月付息。")).toBeUndefined();
    expect(hit("买卖合同。年利率24%，按月结算。")).toBeUndefined();
    expect(hit("借款合同。年利率24%，且不超过合同成立时一年期 LPR 四倍。")).toBeUndefined();
  });
});

describe("consistency.cross_ref", () => {
  it("flags a reference to a clause that is never defined", () => {
    const report = runLegalLint("第1条 双方按约履行。根据第5条 乙方有权解除合同。");
    const hit = report.findings.find((f) => f.ruleId === "consistency.cross_ref");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("第 5 条");
  });

  it("does not flag references to defined clauses", () => {
    const report = runLegalLint("第1条 定义。第2条 付款：甲方根据第2条 约定付款。");
    expect(report.findings.some((f) => f.ruleId === "consistency.cross_ref")).toBe(false);
  });

  it("does not flag a clause referencing itself", () => {
    const report = runLegalLint("第3条 违约责任：一方违约的，根据第3条 第二款处理。");
    expect(report.findings.some((f) => f.ruleId === "consistency.cross_ref")).toBe(false);
  });

  it("treats 第X条 without a reference leader as a definition", () => {
    const report = runLegalLint("第1条 定义。第2条 本合同第1条 所称货物包括附件。");
    expect(report.findings.some((f) => f.ruleId === "consistency.cross_ref")).toBe(false);
  });

  it("flags a dangling reference written in Chinese numerals", () => {
    const report = runLegalLint("第一条 双方按约履行。根据第五条 乙方有权解除合同。");
    const hit = report.findings.find((f) => f.ruleId === "consistency.cross_ref");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("第 5 条");
  });

  it("does not flag a Chinese-numeral reference to a defined clause", () => {
    const report = runLegalLint("第一条 定义。第二条 付款：甲方根据第二条 约定付款。");
    expect(report.findings.some((f) => f.ruleId === "consistency.cross_ref")).toBe(false);
  });

  it("treats mixed numeral forms of the same clause number as one clause", () => {
    const report = runLegalLint("第三条 违约责任：一方违约的，根据第3条 第二款处理。");
    expect(report.findings.some((f) => f.ruleId === "consistency.cross_ref")).toBe(false);
  });

  it("flags a mixed-form reference to a clause that is never defined", () => {
    const report = runLegalLint("第三条 违约责任。根据第5条 乙方有权解除合同。");
    const hit = report.findings.find((f) => f.ruleId === "consistency.cross_ref");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("第 5 条");
  });
});

describe("consistency.article_numbering", () => {
  const hit = (text: string) =>
    runLegalLint(text).findings.find((f) => f.ruleId === "consistency.article_numbering");

  it("detects a numbering gap written in Chinese numerals", () => {
    const h = hit("第一条 定义。第二条 付款。第三条 交付。第五条 违约责任。");
    expect(h?.severity).toBe("info");
    expect(h?.message).toContain("第 3 条");
    expect(h?.message).toContain("第 5 条");
  });

  it("stays silent on a continuous Chinese-numeral sequence", () => {
    expect(hit("第一条 定义。第二条 付款。第三条 交付。第四条 违约责任。")).toBeUndefined();
  });

  it("dedupes mixed numeral forms before checking continuity", () => {
    expect(hit("第一条 定义。第2条 付款。第三条 交付。第四条 违约责任。")).toBeUndefined();
  });

  it("ignores statute citations when checking continuity", () => {
    expect(
      hit("第一条 定义。第二条 付款。第三条 交付。第四条 违约责任。依据民法典第五百八十六条处理。"),
    ).toBeUndefined();
    expect(
      hit("第1条 定义。第2条 付款。第3条 交付。第4条 违约责任。依据民法典第586条处理。"),
    ).toBeUndefined();
  });
});

describe("statutory.deposit_cap boundary matrix", () => {
  const depositHit = (text: string) =>
    runLegalLint(text).findings.find((f) => f.ruleId === "statutory.deposit_cap");

  it("does not trigger at or under the 20% cap", () => {
    expect(depositHit("第一条 定金为本合同标的额的 19%。")).toBeUndefined();
    expect(depositHit("第一条 定金为本合同标的额的 20%。")).toBeUndefined();
    expect(depositHit("第一条 定金为本合同标的额的百分之十五。")).toBeUndefined();
  });

  it("triggers above the cap and reports the full numeric value", () => {
    expect(depositHit("第一条 定金为本合同标的额的 20.1%。")?.message).toContain("20.1%");
    expect(depositHit("第一条 定金为本合同标的额的 120%。")?.message).toContain("120%");
    expect(depositHit("第一条 定金为本合同标的额的 25.5%。")?.message).toContain("25.5%");
    expect(depositHit("第一条 定金为本合同标的额的 100%。")?.message).toContain("100%");
  });

  it("parses Chinese-numeral percentages", () => {
    const hit = depositHit("第一条 定金为本合同标的额的百分之三十。");
    expect(hit?.severity).toBe("blocker");
    expect(hit?.message).toContain("30%");
  });

  it("keeps fixed-amount deposits (no percentage) out of scope", () => {
    expect(depositHit("第一条 定金为 5000 元，签约时支付。")).toBeUndefined();
  });
});

describe("form.or_arbitrate_or_sue variants", () => {
  const arbHit = (text: string) =>
    runLegalLint(text).findings.find((f) => f.ruleId === "form.or_arbitrate_or_sue");

  it("triggers on common or-arbitrate-or-sue wordings", () => {
    expect(arbHit("争议解决：双方可以选择仲裁或诉讼。")).toBeDefined();
    expect(arbHit("争议或仲裁或诉讼，由守约方选定。")).toBeDefined();
    expect(arbHit("争议提交仲裁或诉讼均可。")).toBeDefined();
    expect(arbHit("争议既可以申请仲裁也可以向人民法院起诉。")).toBeDefined();
  });

  it("cites the arbitration-law interpretation", () => {
    expect(arbHit("争议或仲裁或诉讼，由守约方选定。")?.statuteRef).toContain("仲裁法司法解释");
  });

  it("does not flag a single arbitration agreement", () => {
    expect(arbHit("因本合同引起的争议，提交北京仲裁委员会仲裁。")).toBeUndefined();
  });

  it("does not flag a single litigation agreement", () => {
    expect(arbHit("因本合同引起的争议，由甲方所在地人民法院管辖。")).toBeUndefined();
  });
});

describe("statutory.liquidated_damages_high wording", () => {
  it("frames the 30% benchmark relative to losses, not the contract amount", () => {
    const hit = runLegalLint("本协议违约金为标的额的 35%。").findings.find(
      (f) => f.ruleId === "statutory.liquidated_damages_high",
    );
    expect(hit?.message).toContain("造成的损失");
    expect(hit?.message).toContain("酌减");
    expect(hit?.message).not.toContain("明显高于标的额");
  });
});

describe("form.guarantee_form_default", () => {
  it("reminds when a guarantee clause does not specify the guarantee form", () => {
    const hit = runLegalLint("丙方作为保证人，为主债务承担保证责任。").findings.find(
      (f) => f.ruleId === "form.guarantee_form_default",
    );
    expect(hit?.severity).toBe("info");
    expect(hit?.statuteRef).toBe("民法典第686条");
  });

  it("stays silent when the form is explicit or the context is not a suretyship", () => {
    expect(
      runLegalLint("丙方作为保证人就主债务承担连带责任保证。").findings.some(
        (f) => f.ruleId === "form.guarantee_form_default",
      ),
    ).toBe(false);
    expect(
      runLegalLint("甲方收取保证金 5000 元，乙方保证质量合格。").findings.some(
        (f) => f.ruleId === "form.guarantee_form_default",
      ),
    ).toBe(false);
  });
});

describe("rule execution failures surface honestly", () => {
  const throwingRule: LegalLintRule = {
    id: "test.always_throws",
    family: "meta",
    run() {
      throw new Error("boom");
    },
  };

  it("records failed rules and emits a ruleError finding instead of silent absence", () => {
    const report = runLegalLint("第一条 双方按约履行，条款完整。", undefined, undefined, [
      throwingRule,
    ]);
    expect(report.failedRules).toContain("test.always_throws");
    const err = report.findings.find((f) => f.ruleId === "meta.rule_error");
    expect(err?.severity).toBe("warning");
    expect(err?.message).toContain("test.always_throws");
    expect(err?.message).not.toContain("boom");
    expect(report.summaryZh).toContain("执行失败");
  });

  it("reports an empty failedRules list when all rules run cleanly", () => {
    const report = runLegalLint("第一条 双方按约履行，条款完整。");
    expect(report.failedRules).toEqual([]);
    expect(report.findings.some((f) => f.ruleId === "meta.rule_error")).toBe(false);
  });

  it("states how many rules ran versus how many applied", () => {
    const report = runLegalLint("第一条 双方按约履行，条款完整。");
    expect(report.coverageNote).toMatch(/运行 \d+ 条规则，本次适用 \d+ 条/);
    expect(report.coverageNote).toContain("通过 ≠ 法律正确");
  });
});
