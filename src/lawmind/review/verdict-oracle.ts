/**
 * Oracle answers: synthesize criterion answers that should produce a given
 * verdict, for the fixture expectation.
 *
 * Why this exists: the oracle arm used to feed the expected verdict straight
 * back into the scorer, which proved only that the scorer can compare two
 * strings. Now the oracle synthesizes *answers*, runs them through
 * `decideVerdict`, and compares the result to the fixture. A mapping bug makes
 * the oracle fail — which is what a self-test should do.
 *
 * This is not a model. It reads `rule.criteria` and picks the answers the
 * ladder needs; it never reads the contract.
 */

import type { ReviewRule, RuleClassificationKind } from "./rules.js";
import type { CriterionAnswer } from "./verdict.js";

export class OracleAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OracleAnswerError";
  }
}

/**
 * Build answers that SHOULD map to `kind`.
 *
 * - `absent`: `clausePresent: false` (only valid when the rule allows absence).
 * - `unacceptable`: trip the first unacceptable criterion.
 * - `acceptable_deviation`: trip the first acceptable criterion, keep defects
 *   clear, satisfy positives.
 * - `compliant`: satisfies every positive requirement, no defect tripped.
 * - `needs_human`: answer one criterion `unknown`; only available when the rule
 *   has at least one criterion (always true).
 *
 * Throws `OracleAnswerError` when the rule cannot express the requested kind
 * (e.g. asking for `unacceptable` on a rule with no unacceptable criterion).
 */
export function synthesizeAnswers(
  rule: ReviewRule,
  kind: RuleClassificationKind,
): { clausePresent: boolean; answers: CriterionAnswer[] } {
  if (kind === "absent") {
    if (!rule.absentAllowed) {
      throw new OracleAnswerError(`rule ${rule.ruleId}: 不允许缺失，无法合成 absent`);
    }
    return { clausePresent: false, answers: [] };
  }

  const unacceptable = rule.criteria.filter((c) => c.verdictIfMet === "unacceptable");
  const acceptable = rule.criteria.filter((c) => c.verdictIfMet === "acceptable_deviation");
  const compliant = rule.criteria.filter((c) => c.verdictIfMet === "compliant");

  const base: CriterionAnswer[] = [];
  for (const criterion of rule.criteria) {
    if (criterion.verdictIfMet === "compliant") {
      base.push({ criterionId: criterion.id, met: true, evidence: "oracle" });
    } else {
      base.push({ criterionId: criterion.id, met: false });
    }
  }
  const withMet = (id: string, met: CriterionAnswer["met"]): CriterionAnswer[] =>
    base.map((answer) => (answer.criterionId === id ? { ...answer, met } : answer));

  switch (kind) {
    case "compliant": {
      if (compliant.length === 0) {
        throw new OracleAnswerError(`rule ${rule.ruleId}: 无 compliant 要件，无法合成 compliant`);
      }
      return { clausePresent: true, answers: base };
    }
    case "unacceptable": {
      const hit = unacceptable[0];
      if (!hit) {
        throw new OracleAnswerError(`rule ${rule.ruleId}: 无 unacceptable 要件，无法合成`);
      }
      return { clausePresent: true, answers: withMet(hit.id, true) };
    }
    case "acceptable_deviation": {
      const hit = acceptable[0];
      if (hit) {
        return { clausePresent: true, answers: withMet(hit.id, true) };
      }
      // No acceptable criterion: falling short of a positive requirement is
      // itself mapped to acceptable_deviation by ladder step 6b.
      const miss = compliant[0];
      if (!miss) {
        throw new OracleAnswerError(`rule ${rule.ruleId}: 无法合成 acceptable_deviation`);
      }
      return { clausePresent: true, answers: withMet(miss.id, false) };
    }
    case "needs_human": {
      const target = unacceptable[0] ?? acceptable[0] ?? compliant[0];
      if (!target) {
        throw new OracleAnswerError(`rule ${rule.ruleId}: 无法合成 needs_human`);
      }
      return { clausePresent: true, answers: withMet(target.id, "unknown") };
    }
    default:
      throw new OracleAnswerError(`unknown verdict kind: ${String(kind)}`);
  }
}
