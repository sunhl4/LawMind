import { describe, expect, it } from "vitest";
import { collectRuleOutputs } from "./bridge.js";
import { planRuleReview } from "./plan.js";
import { CN_SALES_RULES } from "./playbooks/cn-sales.js";

const plan = planRuleReview({
  playbookId: "cn-sales-v0",
  rules: CN_SALES_RULES,
  paper: "counterparty",
});

function ok(ruleId: string) {
  return { ruleId, classification: { kind: "compliant" } };
}

describe("collectRuleOutputs", () => {
  it("accepts a full set of valid verdicts", () => {
    const results = plan.assignments.map((a) => ok(a.ruleId));
    const collected = collectRuleOutputs({ plan, results });
    expect(collected.outputs).toHaveLength(6);
    expect(collected.invalid).toEqual([]);
  });

  it("reports missing rule ids instead of assuming the parent kept them", () => {
    const collected = collectRuleOutputs({
      plan,
      results: [{ classification: { kind: "compliant" } }],
    });
    expect(collected.outputs).toEqual([]);
    expect(collected.invalid[0]).toEqual({ ruleId: "", reason: "missing_rule_id" });
  });

  it("rejects a rule id that is not in the plan", () => {
    const collected = collectRuleOutputs({
      plan,
      results: [{ ruleId: "not.in.plan", classification: { kind: "compliant" } }],
    });
    expect(collected.invalid[0]).toEqual({
      ruleId: "not.in.plan",
      reason: "unplanned_rule_id",
    });
  });

  it("rejects a duplicate verdict for the same rule", () => {
    const ruleId = plan.assignments[0].ruleId;
    const collected = collectRuleOutputs({ plan, results: [ok(ruleId), ok(ruleId)] });
    expect(collected.outputs).toHaveLength(1);
    expect(collected.invalid[0]?.reason).toBe("duplicate_rule_id");
  });

  it("never invents a verdict when the worker omitted classification", () => {
    const ruleId = plan.assignments[0].ruleId;
    const collected = collectRuleOutputs({ plan, results: [{ ruleId }] });
    expect(collected.outputs).toEqual([]);
    expect(collected.invalid[0]?.reason).toBe("missing_classification");
  });

  it("rejects an unknown classification kind", () => {
    const ruleId = plan.assignments[0].ruleId;
    const collected = collectRuleOutputs({
      plan,
      results: [{ ruleId, classification: { kind: "looks_fine" } }],
    });
    expect(collected.invalid[0]?.reason).toBe("missing_classification");
  });

  it("carries rationale, position, risk and evidence through", () => {
    const ruleId = plan.assignments[0].ruleId;
    const collected = collectRuleOutputs({
      plan,
      results: [
        {
          ruleId,
          agentId: "agent:custom",
          classification: {
            kind: "acceptable_deviation",
            rationale: "偏离但可承受",
            position: "回退到提前 30 日通知",
            risk: "medium",
            evidence: ["第 8 条"],
          },
        },
      ],
    });
    const out = collected.outputs[0];
    expect(out.agentId).toBe("agent:custom");
    expect(out.branchId).toBe(`branch:${ruleId}`);
    expect(out.classification.kind).toBe("acceptable_deviation");
    expect(out.classification.position).toBe("回退到提前 30 日通知");
    expect(out.classification.risk).toBe("medium");
    expect(out.classification.evidence).toEqual(["第 8 条"]);
  });

  it("ignores an invalid risk value instead of passing it through", () => {
    const ruleId = plan.assignments[0].ruleId;
    const collected = collectRuleOutputs({
      plan,
      results: [{ ruleId, classification: { kind: "compliant", risk: "catastrophic" } }],
    });
    expect(collected.outputs[0]?.classification.risk).toBeUndefined();
  });
});
