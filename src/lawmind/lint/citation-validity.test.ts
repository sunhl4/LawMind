import { describe, expect, it } from "vitest";
import { lintCitationValidity } from "./citation-validity.js";
import { runLegalLint } from "./run-lint.js";

describe("lintCitationValidity", () => {
  it("warns when 已废止 sits beside a 《》第N条 cite", () => {
    const findings = lintCitationValidity("依据《旧法》第2条（已废止）处理。");
    expect(findings.some((f) => f.ruleId === "citation.repealed_nearby")).toBe(true);
  });

  it("warns when optional hits mark the cited title as repealed", () => {
    const findings = lintCitationValidity("参见《示例法》第3条。", [
      { title: "示例法", status: "已废止" },
    ]);
    expect(findings.some((f) => f.ruleId === "citation.repealed_nearby")).toBe(true);
  });

  it("emits offline-validity only for opinion-like drafts without 现行有效", () => {
    const opinion = lintCitationValidity(
      "兹出具法律意见。依据《民法典》第586条，本所认为定金条款有效。",
    );
    expect(opinion.some((f) => f.ruleId === "citation.offline_validity")).toBe(true);
    expect(opinion.find((f) => f.ruleId === "citation.offline_validity")?.message).toContain(
      "无法在线核验条文效力",
    );

    const inForce = lintCitationValidity(
      "兹出具法律意见。依据《民法典》第586条（现行有效），本所认为定金条款有效。",
    );
    expect(inForce.some((f) => f.ruleId === "citation.offline_validity")).toBe(false);

    const contract = lintCitationValidity("买卖合同第一条 依据《民法典》第586条支付定金。");
    expect(contract.some((f) => f.ruleId === "citation.offline_validity")).toBe(false);
  });

  it("flags known repealed titles such as 《合同法》 but not 劳动合同法", () => {
    expect(
      lintCitationValidity("依据《合同法》第107条请求支付。").some(
        (f) => f.ruleId === "citation.known_repealed",
      ),
    ).toBe(true);
    expect(
      lintCitationValidity("依据《劳动合同法》第47条支付经济补偿。").some(
        (f) => f.ruleId === "citation.known_repealed",
      ),
    ).toBe(false);
  });

  it("accepts citation hits via runLegalLint second arg", () => {
    const report = runLegalLint("律师意见：引用《示例法》第1条。", [
      { title: "示例法", status: "已废止" },
    ]);
    expect(report.findings.some((f) => f.ruleId === "citation.repealed_nearby")).toBe(true);
    expect(report.coverageNote).toContain("通过 ≠ 法律正确");
  });
});
