import { describe, expect, it } from "vitest";
import { assertPlanCoversRules, planRuleReview } from "./plan.js";
import { CN_SALES_PLAYBOOK_ID, CN_SALES_RULES, loadCnSalesRules } from "./playbooks/cn-sales.js";
import {
  assertValidReviewRule,
  classifyAbsence,
  coverageOf,
  filterRulesForPaper,
  missingRuleIds,
  normalizeReviewRules,
  type RuleClassification,
} from "./rules.js";

describe("cn-sales v0 playbook", () => {
  it("has exactly 12 rules (6 baselines × 2 papers)", () => {
    expect(CN_SALES_RULES).toHaveLength(12);
    expect(CN_SALES_PLAYBOOK_ID).toBe("cn-sales-v0");
  });

  it("normalizes without duplicate ruleIds and every rule has source", () => {
    const rules = normalizeReviewRules(loadCnSalesRules());
    const ids = new Set(rules.map((r) => r.ruleId));
    expect(ids.size).toBe(12);
    for (const r of rules) {
      expect(r.source).toContain("contract-playbook-review.md");
      expect(r.standard.length).toBeGreaterThan(0);
    }
  });

  it("filters to 6 rules per paper side", () => {
    const own = filterRulesForPaper(CN_SALES_RULES, "own");
    const counter = filterRulesForPaper(CN_SALES_RULES, "counterparty");
    expect(own).toHaveLength(6);
    expect(counter).toHaveLength(6);
    expect(own.every((r) => r.paper === "own" || r.paper === "either")).toBe(true);
    expect(counter.every((r) => r.paper === "counterparty" || r.paper === "either")).toBe(true);
  });
});

describe("planRuleReview", () => {
  it("engine owns fan-out: ruleCount === assignments.length", () => {
    const plan = planRuleReview({
      playbookId: CN_SALES_PLAYBOOK_ID,
      rules: CN_SALES_RULES,
      paper: "counterparty",
    });
    expect(plan.ruleCount).toBe(6);
    expect(plan.assignments).toHaveLength(6);
    expect(plan.assignments.map((a) => a.ruleId).toSorted()).toEqual(
      plan.assignments.map((a) => a.section).toSorted(),
    );
    assertPlanCoversRules(plan, filterRulesForPaper(CN_SALES_RULES, "counterparty"));
  });

  it("unknown paper plans all 12", () => {
    const plan = planRuleReview({
      playbookId: CN_SALES_PLAYBOOK_ID,
      rules: CN_SALES_RULES,
      paper: "unknown",
    });
    expect(plan.ruleCount).toBe(12);
  });
});

describe("coverage and absence", () => {
  it("missingRuleIds reports every unclassified rule", () => {
    const expected = filterRulesForPaper(CN_SALES_RULES, "counterparty");
    const partial: RuleClassification[] = [{ kind: "compliant", ruleId: expected[0].ruleId }];
    const missing = missingRuleIds(expected, partial);
    expect(missing).toHaveLength(5);
    expect(coverageOf(expected, partial).complete).toBe(false);
  });

  it("coverage is complete only when every rule is classified", () => {
    const expected = filterRulesForPaper(CN_SALES_RULES, "own");
    const all: RuleClassification[] = expected.map((r) => ({
      kind: "compliant" as const,
      ruleId: r.ruleId,
    }));
    expect(coverageOf(expected, all).complete).toBe(true);
    expect(coverageOf(expected, all).missingRuleIds).toEqual([]);
  });

  it("absentAllowed=false → absence becomes unacceptable", () => {
    const rule = CN_SALES_RULES.find((r) => r.ruleId === "liability.cap.counterparty")!;
    expect(rule.absentAllowed).toBe(false);
    const c = classifyAbsence(rule);
    expect(c.kind).toBe("unacceptable");
    expect(c.risk).toBe("high");
  });

  it("absentAllowed=true → absence stays absent", () => {
    const rule = CN_SALES_RULES.find((r) => r.ruleId === "termination.symmetry.counterparty")!;
    expect(rule.absentAllowed).toBe(true);
    expect(classifyAbsence(rule).kind).toBe("absent");
  });
});

describe("advisory criteria are validated differently", () => {
  const base = {
    title: "演示",
    paper: "counterparty" as const,
    standard: "演示标准",
    source: "skills/builtin/contract-playbook-review.md#底线项-demo",
    absentAllowed: true,
  };

  it("accepts a positively-phrased advisory criterion", () => {
    // A suggestion asks "is this nice-to-have present?", so it must NOT be
    // forced into defect phrasing. That is why advisory is exempt.
    const rule = {
      ...base,
      ruleId: "demo.tip",
      criteria: [
        { id: "good", question: "是否约定了保护条款？", verdictIfMet: "compliant" as const },
        {
          id: "tip",
          question: "是否写明了测试方法与判定值？",
          verdictIfMet: "compliant" as const,
          advisory: true,
        },
      ],
    };
    expect(() => assertValidReviewRule(rule)).not.toThrow();
  });

  it("still rejects a positively-phrased defect criterion", () => {
    const rule = {
      ...base,
      ruleId: "demo.bad",
      criteria: [
        { id: "good", question: "是否约定了保护条款？", verdictIfMet: "compliant" as const },
        {
          id: "warn",
          question: "验收期是否附有三十日通知？",
          verdictIfMet: "acceptable_deviation" as const,
        },
      ],
    };
    expect(() => assertValidReviewRule(rule)).toThrow(/缺陷是否存在/);
  });

  it("does not let advisory criteria satisfy the compliant requirement", () => {
    const rule = {
      ...base,
      ruleId: "demo.only-tips",
      criteria: [
        {
          id: "tip",
          question: "是否写明测试方法？",
          verdictIfMet: "compliant" as const,
          advisory: true,
        },
      ],
    };
    expect(() => assertValidReviewRule(rule)).toThrow(/缺少非建议类的 compliant/);
  });
});
