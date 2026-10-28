import { afterEach, describe, expect, it } from "vitest";
import type { EditOp } from "../drafts/branch.js";
import {
  assertWorkerToolsStayReadOnly,
  executeRuleReview,
  ruleBranchWriteEnabled,
  WorkerWriteToolViolation,
  type RuleWorkerOutput,
} from "./execute.js";
import { planRuleReview } from "./plan.js";
import { CN_SALES_RULES } from "./playbooks/cn-sales.js";
import { filterRulesForPaper, type RuleClassification } from "./rules.js";

const BASE = "v1";

const prev = process.env.LAWMIND_RULE_BRANCH_WRITE;
afterEach(() => {
  if (prev === undefined) {
    delete process.env.LAWMIND_RULE_BRANCH_WRITE;
  } else {
    process.env.LAWMIND_RULE_BRANCH_WRITE = prev;
  }
});

function planFor(paper: "own" | "counterparty") {
  return planRuleReview({
    playbookId: "cn-sales-v0",
    rules: CN_SALES_RULES,
    paper,
  });
}

function outputFor(
  ruleId: string,
  ops: EditOp[] = [],
  kind: RuleClassification["kind"] = "compliant",
): RuleWorkerOutput {
  return {
    ruleId,
    agentId: `agent:${ruleId}`,
    branchId: `branch:${ruleId}`,
    classification: { kind, ruleId },
    ops,
  };
}

function op(partial: Partial<EditOp> & Pick<EditOp, "opId" | "spanId" | "start" | "end">): EditOp {
  return {
    branchId: "unused",
    originRuleId: "unused",
    originAgentId: "unused",
    before: partial.before ?? "",
    after: partial.after ?? "",
    kind: partial.kind ?? "replace",
    ...partial,
  };
}

describe("flag default off", () => {
  it("is disabled unless LAWMIND_RULE_BRANCH_WRITE=1", () => {
    delete process.env.LAWMIND_RULE_BRANCH_WRITE;
    expect(ruleBranchWriteEnabled()).toBe(false);
    process.env.LAWMIND_RULE_BRANCH_WRITE = "0";
    expect(ruleBranchWriteEnabled()).toBe(false);
    process.env.LAWMIND_RULE_BRANCH_WRITE = "true";
    expect(ruleBranchWriteEnabled()).toBe(false);
    process.env.LAWMIND_RULE_BRANCH_WRITE = "1";
    expect(ruleBranchWriteEnabled()).toBe(true);
  });

  it("off: returns no merge at all (legacy path untouched)", () => {
    delete process.env.LAWMIND_RULE_BRANCH_WRITE;
    const plan = planFor("counterparty");
    const outputs = plan.assignments.map((a) => outputFor(a.ruleId));
    const result = executeRuleReview({ plan, rules: CN_SALES_RULES, outputs, baseVersion: BASE });
    expect(result.enabled).toBe(false);
    expect(result.merge).toBeUndefined();
    expect(result.coverage.complete).toBe(true);
  });

  it("off: does not throw on incomplete coverage (legacy path must not break)", () => {
    delete process.env.LAWMIND_RULE_BRANCH_WRITE;
    const plan = planFor("counterparty");
    const result = executeRuleReview({
      plan,
      rules: CN_SALES_RULES,
      outputs: [outputFor(plan.assignments[0].ruleId)],
      baseVersion: BASE,
    });
    expect(result.enabled).toBe(false);
    expect(result.coverage.complete).toBe(false);
  });
});

describe("flag on: coverage is enforced", () => {
  it("throws when any planned rule is unclassified", () => {
    process.env.LAWMIND_RULE_BRANCH_WRITE = "1";
    const plan = planFor("counterparty");
    expect(() =>
      executeRuleReview({
        plan,
        rules: CN_SALES_RULES,
        outputs: [outputFor(plan.assignments[0].ruleId)],
        baseVersion: BASE,
      }),
    ).toThrow(/rule review incomplete/);
  });

  it("throws on worker output for an unplanned rule", () => {
    process.env.LAWMIND_RULE_BRANCH_WRITE = "1";
    const plan = planFor("counterparty");
    const outputs = [
      ...plan.assignments.map((a) => outputFor(a.ruleId)),
      outputFor("not.in.playbook"),
    ];
    expect(() =>
      executeRuleReview({ plan, rules: CN_SALES_RULES, outputs, baseVersion: BASE }),
    ).toThrow(/unplanned ruleId/);
  });

  it("merges disjoint edits from two rules", () => {
    process.env.LAWMIND_RULE_BRANCH_WRITE = "1";
    const plan = planFor("counterparty");
    const [r1, r2, ...rest] = plan.assignments;
    const outputs = [
      outputFor(r1.ruleId, [
        op({ opId: "o1", spanId: "p1", start: 2, end: 4, before: "应在", after: "须在" }),
      ]),
      outputFor(r2.ruleId, [
        op({ opId: "o2", spanId: "p1", start: 20, end: 22, before: "约定", after: "商定" }),
      ]),
      ...rest.map((a) => outputFor(a.ruleId)),
    ];
    const result = executeRuleReview({
      plan,
      rules: CN_SALES_RULES,
      outputs,
      baseVersion: BASE,
    });
    expect(result.enabled).toBe(true);
    expect(result.merge?.conflicts).toHaveLength(0);
    expect(result.merge?.merged).toHaveLength(2);
    // Provenance tags survive the merge.
    const rules = result.merge!.merged.map((o) => o.originRuleId).toSorted();
    expect(rules).toEqual([r1.ruleId, r2.ruleId].toSorted());
  });

  it("surfaces conflict instead of silently picking a winner", () => {
    process.env.LAWMIND_RULE_BRANCH_WRITE = "1";
    const plan = planFor("counterparty");
    const [r1, r2, ...rest] = plan.assignments;
    const outputs = [
      outputFor(r1.ruleId, [
        op({ opId: "o1", spanId: "p1", start: 2, end: 6, before: "abcdef", after: "X" }),
      ]),
      outputFor(r2.ruleId, [
        op({ opId: "o2", spanId: "p1", start: 2, end: 6, before: "abcdef", after: "Y" }),
      ]),
      ...rest.map((a) => outputFor(a.ruleId)),
    ];
    const result = executeRuleReview({ plan, rules: CN_SALES_RULES, outputs, baseVersion: BASE });
    expect(result.merge?.conflicts).toHaveLength(1);
    expect(result.merge?.merged).toHaveLength(0);
  });
});

describe("worker tool boundary", () => {
  it("rejects forbidden write tools on a worker", () => {
    expect(() => assertWorkerToolsStayReadOnly(["list_dir", "apply_surgical_edits"])).toThrow(
      WorkerWriteToolViolation,
    );
  });

  it("allows read-only tools", () => {
    expect(() =>
      assertWorkerToolsStayReadOnly(["list_dir", "analyze_document", "search_statute"]),
    ).not.toThrow();
  });
});

describe("paper filtering reaches the plan", () => {
  it("own paper plans only own + either rules", () => {
    const plan = planFor("own");
    const own = filterRulesForPaper(CN_SALES_RULES, "own");
    expect(plan.assignments.map((a) => a.ruleId).toSorted()).toEqual(
      own.map((r) => r.ruleId).toSorted(),
    );
  });
});
