/**
 * Rule-level contract review objects (Harvey-style playbook rules).
 *
 * Prose source of truth for lawyers: `skills/builtin/contract-playbook-review.md`.
 * Structured rules are extracted here so the engine can guarantee coverage
 * (one assignment per rule). Do not invent a sixth classification kind.
 */

export type PaperSide = "own" | "counterparty" | "either";

export type ReviewRule = {
  ruleId: string;
  title: string;
  /** Whose paper this rule's thresholds apply to. */
  paper: PaperSide;
  standard: string;
  /**
   * Sufficient conditions for `compliant`. When present, a clause that meets
   * every item is compliant and must not be downgraded for extra niceties the
   * rule does not ask for. Without it, `standard` alone is the yardstick and
   * verdicts drift toward acceptable_deviation.
   */
  compliantWhen?: string[];
  acceptable: string[];
  unacceptable: string[];
  guidance?: string;
  /** When false, absence must classify as `absent` (not silent skip). */
  absentAllowed: boolean;
  escalateWhen?: string;
  /** Back-pointer into the prose skill (required for dual-source discipline). */
  source: string;
};

export type RuleClassificationKind =
  | "compliant"
  | "acceptable_deviation"
  | "unacceptable"
  | "absent"
  | "needs_human";

export type RuleClassification = {
  kind: RuleClassificationKind;
  ruleId: string;
  /** Short rationale for the lawyer / lead agent. */
  rationale?: string;
  /** Chosen fallback text when kind is acceptable_deviation. */
  position?: string;
  risk?: "high" | "medium" | "low";
  evidence?: string[];
  spanIds?: string[];
};

export type RuleAssignment = {
  ruleId: string;
  rule: ReviewRule;
  section: string;
};

export type CoverageResult = {
  complete: boolean;
  expectedRuleIds: string[];
  classifiedRuleIds: string[];
  missingRuleIds: string[];
};

const RULE_ID_RE = /^[a-z][a-z0-9._-]{1,80}$/;

export function assertValidReviewRule(rule: ReviewRule): void {
  if (!RULE_ID_RE.test(rule.ruleId)) {
    throw new Error(`invalid ruleId: ${rule.ruleId}`);
  }
  if (!rule.title.trim()) {
    throw new Error(`rule ${rule.ruleId}: empty title`);
  }
  if (!rule.standard.trim()) {
    throw new Error(`rule ${rule.ruleId}: empty standard`);
  }
  if (!rule.source.trim()) {
    throw new Error(`rule ${rule.ruleId}: empty source`);
  }
  if (rule.paper !== "own" && rule.paper !== "counterparty" && rule.paper !== "either") {
    throw new Error(`rule ${rule.ruleId}: invalid paper`);
  }
}

export function normalizeReviewRules(rules: readonly ReviewRule[]): ReviewRule[] {
  const seen = new Set<string>();
  const out: ReviewRule[] = [];
  for (const rule of rules) {
    assertValidReviewRule(rule);
    if (seen.has(rule.ruleId)) {
      throw new Error(`duplicate ruleId: ${rule.ruleId}`);
    }
    seen.add(rule.ruleId);
    out.push({
      ...rule,
      title: rule.title.trim(),
      standard: rule.standard.trim(),
      ...(rule.compliantWhen && rule.compliantWhen.length > 0
        ? { compliantWhen: rule.compliantWhen.map((s) => s.trim()).filter(Boolean) }
        : {}),
      acceptable: rule.acceptable.map((s) => s.trim()).filter(Boolean),
      unacceptable: rule.unacceptable.map((s) => s.trim()).filter(Boolean),
      guidance: rule.guidance?.trim() || undefined,
      escalateWhen: rule.escalateWhen?.trim() || undefined,
      source: rule.source.trim(),
    });
  }
  return out;
}

/** Rules that apply when reviewing a document on this paper. */
export function filterRulesForPaper(
  rules: readonly ReviewRule[],
  paper: PaperSide | "unknown",
): ReviewRule[] {
  if (paper === "unknown" || paper === "either") {
    return [...rules];
  }
  return rules.filter((r) => r.paper === paper || r.paper === "either");
}

export function missingRuleIds(
  expected: readonly ReviewRule[],
  classifications: readonly RuleClassification[],
): string[] {
  const got = new Set(classifications.map((c) => c.ruleId));
  return expected.filter((r) => !got.has(r.ruleId)).map((r) => r.ruleId);
}

export function coverageOf(
  expected: readonly ReviewRule[],
  classifications: readonly RuleClassification[],
): CoverageResult {
  const expectedRuleIds = expected.map((r) => r.ruleId);
  const classifiedRuleIds = [...new Set(classifications.map((c) => c.ruleId))];
  const missing = missingRuleIds(expected, classifications);
  return {
    complete: missing.length === 0 && expectedRuleIds.length > 0,
    expectedRuleIds,
    classifiedRuleIds,
    missingRuleIds: missing,
  };
}

/**
 * Enforce absentAllowed: if a classification claims "absent" on a rule that
 * allows absence, it is fine; if the rule forbids absence, treat as incomplete
 * unless escalated to needs_human / unacceptable with rationale.
 */
export function classifyAbsence(rule: ReviewRule): RuleClassification {
  if (rule.absentAllowed) {
    return {
      kind: "absent",
      ruleId: rule.ruleId,
      rationale: "条款缺失且规则允许缺失",
    };
  }
  return {
    kind: "unacceptable",
    ruleId: rule.ruleId,
    risk: "high",
    rationale: "条款缺失且规则不允许缺失",
  };
}
