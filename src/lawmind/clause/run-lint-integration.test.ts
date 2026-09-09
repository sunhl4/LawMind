import { describe, expect, it } from "vitest";
import { runLegalLint } from "../lint/run-lint.js";
import { defaultClausePatterns } from "./dsl.js";

describe("runLegalLint clause integration", () => {
  it("does not change the default report when no clausePatterns are provided", () => {
    const withoutClause = runLegalLint("第一条 交付。");
    const withClause = runLegalLint("第一条 交付。", undefined, undefined, [], {
      clausePatterns: defaultClausePatterns(),
    });

    expect(withoutClause.ruleCount).toBe(withClause.ruleCount);
    expect(withoutClause.findings.some((f) => f.ruleId.startsWith("clause."))).toBe(false);
    expect(withClause.findings.some((f) => f.ruleId === "clause.dispute_missing")).toBe(true);
  });

  it("merges clause findings into the lint report when clausePatterns are present", () => {
    const report = runLegalLint("第一条 交付。", undefined, undefined, [], {
      clausePatterns: defaultClausePatterns(),
    });
    const clauseFindings = report.findings.filter((f) => f.family === "clause");
    expect(clauseFindings.length).toBeGreaterThan(0);
    expect(clauseFindings.every((f) => f.ruleId.startsWith("clause."))).toBe(true);
  });
});
