/**
 * Deterministic verdict mapping.
 *
 * The model does not choose a tier. It answers atomic yes/no/unknown questions
 * per criterion, and this module maps those answers to one of five verdicts
 * with fixed rules. Same answers always produce the same verdict — that is the
 * whole point: asking the model to pick a tier directly produced 12% unstable
 * verdicts on identical input, while yes/no answers are stable.
 *
 * Ladder order is intentional and must not be reordered:
 *   1. clause absent        -> absent / unacceptable
 *   2. any unacceptable     -> unacceptable
 *   3. any acceptable       -> acceptable_deviation
 *   4. any defect unknown   -> needs_human   (cannot rule out a dealbreaker)
 *   5. all compliant        -> compliant
 *   6. otherwise            -> needs_human if a requirement is unknown,
 *                              acceptable_deviation if all answers were definite
 *
 * Step 4 sits before step 5 deliberately. An unknown on a defect question
 * ("is there an uncapped liability?") must never be read as "no defect": that
 * would turn missing evidence into a clean bill of health.
 */

import type {
  ReviewRule,
  RuleClassification,
  RuleClassificationKind,
  RuleCriterion,
} from "./rules.js";

/** One criterion's answer. `unknown` means the material does not settle it. */
export type CriterionMet = true | false | "unknown" | "not_applicable";

export type CriterionAnswer = {
  criterionId: string;
  met: CriterionMet;
  /** Quote from the contract supporting the answer. Required for true/false. */
  evidence?: string;
};

export type VerdictInput = {
  /** False when the contract has no clause on this topic at all. */
  clausePresent: boolean;
  answers: readonly CriterionAnswer[];
};

export type VerdictStep =
  | "absent_allowed"
  | "absent_forbidden"
  | "unacceptable_criterion"
  | "acceptable_criterion"
  | "all_compliant"
  | "unknown_answer"
  | "no_compliant_requirement_met";

export type VerdictSuggestion = {
  criterionId: string;
  question: string;
};

export type VerdictDecision = RuleClassification & {
  /** Which rule step produced the verdict, for debugging and reports. */
  step: VerdictStep;
  /** Criteria that were unanswered, unparsable, or answered unknown. */
  unresolvedCriterionIds: string[];
  /**
   * Unmet advisory criteria. These never change `kind`; they are the "提示项"
   * a lawyer may choose to take up.
   */
  suggestions?: VerdictSuggestion[];
};

const MET_VALUES = new Set<CriterionMet>([true, false, "unknown", "not_applicable"]);

/** Index answers by criterion id, keeping the first answer for a repeated id. */
export function indexAnswers(answers: readonly CriterionAnswer[]): Map<string, CriterionAnswer> {
  const map = new Map<string, CriterionAnswer>();
  for (const answer of answers) {
    const id = typeof answer.criterionId === "string" ? answer.criterionId.trim() : "";
    if (!id || map.has(id)) {
      continue;
    }
    map.set(id, { ...answer, criterionId: id });
  }
  return map;
}

function metOf(answer: CriterionAnswer | undefined): CriterionMet | "missing" {
  if (!answer) {
    return "missing";
  }
  return MET_VALUES.has(answer.met) ? answer.met : "missing";
}

/**
 * Criteria that decide the verdict. Advisory criteria are excluded on purpose:
 * a suggestion must never move a clause up or down a tier, otherwise "we
 * recommend X" silently becomes "this clause is defective".
 */
function criteriaOf(rule: ReviewRule, kind: RuleCriterion["verdictIfMet"]): RuleCriterion[] {
  return rule.criteria.filter((c) => c.advisory !== true && c.verdictIfMet === kind);
}

function advisoryCriteriaOf(rule: ReviewRule): RuleCriterion[] {
  return rule.criteria.filter((c) => c.advisory === true);
}

/**
 * Map answers to a verdict. Pure: no model call, no I/O, no clock.
 *
 * Unanswered or invalid criteria count as unresolved. They never become an
 * implicit "false": a missing answer must not flatter the clause.
 */
function decideCore(rule: ReviewRule, input: VerdictInput): VerdictDecision {
  if (!input.clausePresent) {
    if (rule.absentAllowed) {
      return {
        kind: "absent",
        ruleId: rule.ruleId,
        rationale: "条款缺失且规则允许缺失",
        step: "absent_allowed",
        unresolvedCriterionIds: [],
      };
    }
    return {
      kind: "unacceptable",
      ruleId: rule.ruleId,
      risk: "high",
      rationale: "条款缺失且规则不允许缺失",
      step: "absent_forbidden",
      unresolvedCriterionIds: [],
    };
  }

  const byId = indexAnswers(input.answers);
  const unresolved: string[] = [];
  const evidence: string[] = [];

  const read = (criterion: RuleCriterion): CriterionMet | "missing" => {
    const answer = byId.get(criterion.id);
    const met = metOf(answer);
    if (met === "missing" || met === "unknown") {
      unresolved.push(criterion.id);
    }
    if (answer?.evidence?.trim()) {
      evidence.push(answer.evidence.trim());
    }
    return met;
  };

  // 2. Any unacceptable defect present.
  for (const criterion of criteriaOf(rule, "unacceptable")) {
    if (read(criterion) === true) {
      return {
        kind: "unacceptable",
        ruleId: rule.ruleId,
        risk: "high",
        rationale: `命中不可接受：${criterion.question}`,
        evidence: [...new Set(evidence)],
        step: "unacceptable_criterion",
        unresolvedCriterionIds: [],
      };
    }
  }

  // 3. Any acceptable deviation present.
  const acceptableHit = criteriaOf(rule, "acceptable_deviation").find(
    (criterion) => read(criterion) === true,
  );
  if (acceptableHit) {
    return {
      kind: "acceptable_deviation",
      ruleId: rule.ruleId,
      rationale: `落在可接受回退：${acceptableHit.question}`,
      evidence: [...new Set(evidence)],
      step: "acceptable_criterion",
      unresolvedCriterionIds: [],
    };
  }

  // Read the positive requirements before evaluating: their `unknown` values
  // must reach the unresolved list below.
  const compliant = criteriaOf(rule, "compliant");
  const compliantStates = compliant.map((criterion) => ({
    criterion,
    met: read(criterion),
  }));
  const allCompliant =
    compliant.length > 0 &&
    compliantStates.every(({ met }) => met === true || met === "not_applicable");

  // 4. A defect question that could not be answered must not be read as "no
  // defect". Escalate instead of declaring compliance on missing evidence.
  const uniqueUnresolved = [...new Set(unresolved)];
  const defectCriteria = new Set(
    rule.criteria.filter((c) => c.verdictIfMet !== "compliant").map((c) => c.id),
  );
  const unresolvedDefects = uniqueUnresolved.filter((id) => defectCriteria.has(id));
  if (unresolvedDefects.length > 0) {
    return {
      kind: "needs_human",
      ruleId: rule.ruleId,
      rationale: `以下偏离项无法从材料判定，需人工确认：${unresolvedDefects.join("、")}`,
      evidence: [...new Set(evidence)],
      step: "unknown_answer",
      unresolvedCriterionIds: unresolvedDefects,
    };
  }

  // 5. Every positive requirement satisfied (not_applicable counts as satisfied).
  if (allCompliant) {
    return {
      kind: "compliant",
      ruleId: rule.ruleId,
      rationale: "全部合规要件成立，且未命中任何偏离项",
      evidence: [...new Set(evidence)],
      step: "all_compliant",
      unresolvedCriterionIds: [],
    };
  }

  // 6a. Short of compliant because a positive requirement could not be read.
  if (uniqueUnresolved.length > 0) {
    return {
      kind: "needs_human",
      ruleId: rule.ruleId,
      rationale: `以下合规要件无法从材料判定，需人工确认：${uniqueUnresolved.join("、")}`,
      evidence: [...new Set(evidence)],
      step: "unknown_answer",
      unresolvedCriterionIds: uniqueUnresolved,
    };
  }

  // 6b. Answers were all definite, yet a positive requirement is unmet.
  return {
    kind: "acceptable_deviation",
    ruleId: rule.ruleId,
    rationale: "未满足全部合规要件，但未命中不可接受项",
    evidence: [...new Set(evidence)],
    step: "no_compliant_requirement_met",
    unresolvedCriterionIds: [],
  };
}

/**
 * Unmet advisory criteria, as suggestions. `clausePresent: false` yields none:
 * there is nothing to suggest about a clause that is not there.
 */
export function collectSuggestions(rule: ReviewRule, input: VerdictInput): VerdictSuggestion[] {
  if (!input.clausePresent) {
    return [];
  }
  const byId = indexAnswers(input.answers);
  const out: VerdictSuggestion[] = [];
  for (const criterion of advisoryCriteriaOf(rule)) {
    const met = metOf(byId.get(criterion.id));
    if (met === false) {
      out.push({ criterionId: criterion.id, question: criterion.question });
    }
  }
  return out;
}

/**
 * Map answers to a verdict.
 *
 * Advisory criteria are attached afterwards rather than woven into the ladder,
 * so no early return can accidentally skip them and no suggestion can ever move
 * the tier.
 */
export function decideVerdict(rule: ReviewRule, input: VerdictInput): VerdictDecision {
  const core = decideCore(rule, input);
  const suggestions = collectSuggestions(rule, input);
  return suggestions.length > 0 ? { ...core, suggestions } : core;
}

/** Every criterion id the model is expected to answer for this rule. */
export function criterionIdsOf(rule: ReviewRule): string[] {
  return rule.criteria.map((c) => c.id);
}

/**
 * Answers that are incomplete (missing a criterion) are rejected rather than
 * filled in. Callers use this to decide between retry and `needs_human`.
 */
export function missingCriterionIds(
  rule: ReviewRule,
  answers: readonly CriterionAnswer[],
): string[] {
  const byId = indexAnswers(answers);
  return criterionIdsOf(rule).filter((id) => metOf(byId.get(id)) === "missing");
}

export const VERDICT_STEPS: readonly VerdictStep[] = [
  "absent_allowed",
  "absent_forbidden",
  "unacceptable_criterion",
  "acceptable_criterion",
  "all_compliant",
  "unknown_answer",
  "no_compliant_requirement_met",
];

export const VERDICT_KINDS: readonly RuleClassificationKind[] = [
  "compliant",
  "acceptable_deviation",
  "unacceptable",
  "absent",
  "needs_human",
];
