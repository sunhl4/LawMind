import { describe, expect, it } from "vitest";
import { loadRuleAllPassFixtures } from "../evaluation/rule-allpass.js";
import { CN_SALES_RULES } from "./playbooks/cn-sales.js";
import { filterRulesForPaper } from "./rules.js";
import { OracleAnswerError, synthesizeAnswers } from "./verdict-oracle.js";
import { decideVerdict } from "./verdict.js";

const loaded = loadRuleAllPassFixtures();

describe("oracle round-trip: every fixture verdict is reachable", () => {
  it("loads the in-repo fixtures", () => {
    expect(loaded.problems).toEqual([]);
    expect(loaded.cases.length).toBeGreaterThan(0);
  });

  it("synthesized answers map back to every expected verdict", () => {
    const mismatches: string[] = [];
    for (const testCase of loaded.cases) {
      const rules = filterRulesForPaper(CN_SALES_RULES, testCase.paper);
      for (const rule of rules) {
        const expected = testCase.expected[rule.ruleId];
        if (!expected) {
          mismatches.push(`${testCase.caseId}/${rule.ruleId}: 缺期望值`);
          continue;
        }
        let actual: string;
        try {
          const synthesized = synthesizeAnswers(rule, expected);
          actual = decideVerdict(rule, synthesized).kind;
        } catch (err) {
          const message = err instanceof OracleAnswerError ? err.message : String(err);
          mismatches.push(`${testCase.caseId}/${rule.ruleId}: ${message}`);
          continue;
        }
        if (actual !== expected) {
          mismatches.push(
            `${testCase.caseId}/${rule.ruleId}: 期望 ${expected}，映射器给出 ${actual}`,
          );
        }
      }
    }
    // A single line here means the rule's criteria cannot express the fixture
    // expectation — fix the criteria, never the map.
    expect(mismatches).toEqual([]);
  });

  it("every rule can express at least compliant and one defect tier", () => {
    for (const rule of CN_SALES_RULES) {
      expect(() => synthesizeAnswers(rule, "compliant")).not.toThrow();
      const reachable = ["compliant", "needs_human"] as const;
      for (const kind of reachable) {
        expect(() => synthesizeAnswers(rule, kind)).not.toThrow();
      }
      const hasDefect = rule.criteria.some((c) => c.verdictIfMet !== "compliant");
      expect(hasDefect, `${rule.ruleId} 没有可命中的偏离项`).toBe(true);
    }
  });
});
