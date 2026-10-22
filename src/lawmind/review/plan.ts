/**
 * Engine-owned rule review planning: N rules → N assignments.
 * The model does not choose how many workers to spawn.
 */

import {
  filterRulesForPaper,
  normalizeReviewRules,
  type PaperSide,
  type ReviewRule,
  type RuleAssignment,
} from "./rules.js";

export type RuleReviewPlan = {
  playbookId: string;
  paper: PaperSide | "unknown";
  assignments: RuleAssignment[];
  /** Same as assignments.length; asserted in tests. */
  ruleCount: number;
};

export type PlanRuleReviewInput = {
  playbookId: string;
  rules: readonly ReviewRule[];
  /** Document paper; filters own vs counterparty thresholds. */
  paper?: PaperSide | "unknown";
};

export function planRuleReview(input: PlanRuleReviewInput): RuleReviewPlan {
  const paper = input.paper ?? "unknown";
  const normalized = normalizeReviewRules(input.rules);
  const applicable = filterRulesForPaper(normalized, paper);
  if (applicable.length === 0) {
    throw new Error(
      `planRuleReview: no rules apply for playbook=${input.playbookId} paper=${paper}`,
    );
  }
  const assignments: RuleAssignment[] = applicable.map((rule) => ({
    ruleId: rule.ruleId,
    rule,
    section: rule.ruleId,
  }));
  return {
    playbookId: input.playbookId,
    paper,
    assignments,
    ruleCount: assignments.length,
  };
}

/** Pure check used by lead / finalizer. */
export function assertPlanCoversRules(plan: RuleReviewPlan, rules: readonly ReviewRule[]): void {
  if (plan.ruleCount !== plan.assignments.length) {
    throw new Error("plan.ruleCount !== assignments.length");
  }
  const expected = new Set(rules.map((r) => r.ruleId));
  for (const a of plan.assignments) {
    if (!expected.has(a.ruleId)) {
      throw new Error(`assignment for unknown ruleId: ${a.ruleId}`);
    }
  }
  if (plan.assignments.length !== new Set(plan.assignments.map((a) => a.ruleId)).size) {
    throw new Error("duplicate assignments in plan");
  }
}
