/**
 * All-pass scoring for rule-level review (Harvey LAB style).
 *
 * A review passes a task only when every mustPass criterion is satisfied and
 * no mustNotAppear violation exists. Average/weighted coverage is reported for
 * diagnostics but never turns a failed task into a pass.
 */

import type { BaselineCriterion, BaselineRubric } from "./human-baseline.js";

export type AllPassCriterionResult = {
  id: string;
  label: string;
  mustPass: boolean;
  covered: boolean;
  violations: string[];
  passed: boolean;
};

export type AllPassResult = {
  pass: boolean;
  criteria: AllPassCriterionResult[];
  /** mustPass criteria that were not satisfied (or had violations). */
  failed: string[];
  /** Coverage over all criteria, diagnostics only. */
  coverage: number;
  violations: string[];
};

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function evaluateCriterion(text: string, c: BaselineCriterion): AllPassCriterionResult {
  const hay = norm(text);
  const allOk = (c.allOf ?? []).every((needle) => hay.includes(norm(needle)));
  const anyList = c.anyOf ?? [];
  const anyOk = anyList.length === 0 ? true : anyList.some((n) => hay.includes(norm(n)));
  const hasRequirement = (c.allOf?.length ?? 0) > 0 || anyList.length > 0;
  const covered = hasRequirement ? allOk && anyOk : true;
  const violations = (c.mustNotAppear ?? []).filter((n) => hay.includes(norm(n)));
  const mustPass = c.mustPass === true;
  return {
    id: c.id,
    label: c.label,
    mustPass,
    covered,
    violations,
    passed: mustPass ? covered && violations.length === 0 : violations.length === 0,
  };
}

export function scoreAllPass(text: string, rubric: BaselineRubric): AllPassResult {
  const criteria = rubric.criteria.map((c) => evaluateCriterion(text, c));
  const mustPass = criteria.filter((c) => c.mustPass);
  const failed = mustPass.filter((c) => !c.passed).map((c) => c.id);
  const violations = criteria.flatMap((c) => c.violations);
  const coveredCount = criteria.filter((c) => c.covered).length;
  return {
    pass: failed.length === 0 && violations.length === 0,
    criteria,
    failed,
    coverage: criteria.length === 0 ? 1 : coveredCount / criteria.length,
    violations,
  };
}

/**
 * A rubric authored before mustPass existed has no hard gate. Refuse to claim
 * all-pass for it rather than silently passing everything.
 */
export function rubricHasMustPass(rubric: BaselineRubric): boolean {
  return rubric.criteria.some((c) => c.mustPass === true);
}
