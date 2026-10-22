import { describe, expect, it } from "vitest";
import { collectRuleOutputs } from "./bridge.js";
import { planRuleReview } from "./plan.js";
import { CN_SALES_RULES } from "./playbooks/cn-sales.js";
import { synthesizeAnswers } from "./verdict-oracle.js";

const plan = planRuleReview({
  playbookId: "cn-sales-v0",
  rules: CN_SALES_RULES,
  paper: "counterparty",
});

function ruleOf(ruleId: string) {
  const rule = plan.assignments.find((a) => a.ruleId === ruleId)?.rule;
  if (!rule) {
    throw new Error(`rule not in plan: ${ruleId}`);
  }
  return rule;
}

function ok(ruleId: string) {
  return {
    ruleId,
    verdictAnswers: synthesizeAnswers(ruleOf(ruleId), "compliant"),
  };
}

describe("collectRuleOutputs", () => {
  it("accepts a full set of valid answers", () => {
    const results = plan.assignments.map((a) => ok(a.ruleId));
    const collected = collectRuleOutputs({ plan, results });
    expect(collected.outputs).toHaveLength(6);
    expect(collected.invalid).toEqual([]);
    expect(collected.unansweredRuleIds).toEqual([]);
    for (const output of collected.outputs) {
      expect(output.classification.kind).toBe("compliant");
    }
  });

  it("reports missing rule ids instead of assuming the parent kept them", () => {
    const collected = collectRuleOutputs({
      plan,
      results: [{ verdictAnswers: { clausePresent: true, answers: [] } }],
    });
    expect(collected.outputs).toEqual([]);
    expect(collected.invalid[0]).toEqual({ ruleId: "", reason: "missing_rule_id" });
  });

  it("rejects a rule id that is not in the plan", () => {
    const collected = collectRuleOutputs({
      plan,
      results: [
        {
          ruleId: "not.in.plan",
          verdictAnswers: { clausePresent: false, answers: [] },
        },
      ],
    });
    expect(collected.invalid[0]).toEqual({
      ruleId: "not.in.plan",
      reason: "unplanned_rule_id",
    });
  });

  it("rejects a duplicate answer for the same rule", () => {
    const ruleId = plan.assignments[0].ruleId;
    const collected = collectRuleOutputs({ plan, results: [ok(ruleId), ok(ruleId)] });
    expect(collected.outputs).toHaveLength(1);
    expect(collected.invalid[0]?.reason).toBe("duplicate_rule_id");
  });

  it("never invents an answer when the worker omitted verdictAnswers", () => {
    const ruleId = plan.assignments[0].ruleId;
    const collected = collectRuleOutputs({ plan, results: [{ ruleId }] });
    expect(collected.outputs).toEqual([]);
    expect(collected.invalid[0]?.reason).toBe("missing_clause_present");
    expect(collected.unansweredRuleIds).toEqual([ruleId]);
  });

  it("rejects a partial answer set instead of defaulting the rest to false", () => {
    const ruleId = plan.assignments[0].ruleId;
    const rule = ruleOf(ruleId);
    const full = synthesizeAnswers(rule, "compliant");
    const collected = collectRuleOutputs({
      plan,
      results: [
        {
          ruleId,
          verdictAnswers: { clausePresent: true, answers: full.answers.slice(0, 1) },
        },
      ],
    });
    expect(collected.outputs).toEqual([]);
    expect(collected.invalid[0]?.reason).toMatch(/^missing_criteria:/);
    expect(collected.unansweredRuleIds).toEqual([ruleId]);
  });

  it("lets a missing clause through when the rule allows absence", () => {
    const rule = plan.assignments.find((a) => a.rule.absentAllowed);
    expect(rule).toBeDefined();
    const collected = collectRuleOutputs({
      plan,
      results: [{ ruleId: rule!.ruleId, verdictAnswers: { clausePresent: false, answers: [] } }],
    });
    expect(collected.invalid).toEqual([]);
    expect(collected.outputs[0]?.classification.kind).toBe("absent");
  });

  it("maps an unacceptable answer to unacceptable, not to the worker's opinion", () => {
    const ruleId = "liability.cap.counterparty";
    const answers = synthesizeAnswers(ruleOf(ruleId), "unacceptable");
    const collected = collectRuleOutputs({
      plan,
      results: [{ ruleId, verdictAnswers: answers }],
    });
    expect(collected.outputs[0]?.classification.kind).toBe("unacceptable");
    expect(collected.outputs[0]?.classification.risk).toBe("high");
  });

  it("carries the step that produced the verdict", () => {
    const ruleId = plan.assignments[0].ruleId;
    const collected = collectRuleOutputs({ plan, results: [ok(ruleId)] });
    expect(collected.outputs[0]?.classification.step).toBe("all_compliant");
  });

  it("keeps the section as the memo", () => {
    const ruleId = plan.assignments[0].ruleId;
    const collected = collectRuleOutputs({
      plan,
      results: [{ ...ok(ruleId), section: "责任上限" }],
    });
    expect(collected.outputs[0]?.memo).toBe("责任上限");
  });
});
