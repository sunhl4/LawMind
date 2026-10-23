/**
 * Rule-level contract review objects (Harvey-style playbook rules).
 *
 * Prose source of truth for lawyers: `skills/builtin/contract-playbook-review.md`.
 * Structured rules are extracted here so the engine can guarantee coverage
 * (one assignment per rule). Do not invent a sixth classification kind.
 *
 * Verdicts are NOT chosen by the model. Each rule carries atomic criteria; the
 * model answers yes/no/unknown per criterion and `decideVerdict` maps those
 * answers to one of the five verdicts deterministically. See `verdict.ts` for
 * why: the same model on the same prompt flipped verdicts 12% of the time when
 * asked to pick a tier directly.
 */

export type PaperSide = "own" | "counterparty" | "either";

/** What a criterion means for the verdict when its question is answered "yes". */
export type CriterionKind = "compliant" | "acceptable_deviation" | "unacceptable";

export type RuleCriterion = {
  id: string;
  /**
   * A factual yes/no question about the contract text. "yes" means the thing
   * the question asks about IS present.
   *
   * Must not contain conditional prose ("如果…则…") or words that delegate the
   * judgement back to the model ("是否适当", "是否合理"). `validateCriterion`
   * rejects those: a criterion that needs a judgement call is not atomic.
   */
  question: string;
  /**
   * `compliant`: the positive requirement this rule wants. All compliant
   * criteria must hold (or be not_applicable) for a compliant verdict.
   *
   * `acceptable_deviation` / `unacceptable`: a defect question — "yes" means
   * the defect is present, so the verdict is that tier.
   */
  verdictIfMet: CriterionKind;
};

export type ReviewRule = {
  ruleId: string;
  title: string;
  /** Whose paper this rule's thresholds apply to. */
  paper: PaperSide;
  /** Prose for the lawyer. No longer used to decide the verdict. */
  standard: string;
  /** Atomic questions the model answers. At least one is required. */
  criteria: RuleCriterion[];
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

/**
 * A criterion must be answerable by reading the contract, not by weighing it.
 * These patterns are the ones that produced 12% unstable verdicts in testing:
 * conditional prose and words that hand the judgement back to the reader.
 */
const NON_ATOMIC_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /如果|若[^，。]{0,20}则|假如/u, why: "条件分支" },
  { re: /是否(适当|合理|充分|妥当|适宜)/u, why: "把判断交回模型" },
  { re: /视为满足|视为符合|可视为/u, why: "含例外/推定，非单一事实" },
  { re: /另行协商|视情况|按法律规定|依法确定/u, why: "无确定标准" },
  { re: /原则上|一般应|尽可能/u, why: "程度限定，无法二值化" },
  // Two requirements joined by 「并/且/同时」 cannot be answered with one word:
  // the answer is undefined when exactly one of them holds. This is the failure
  // that made a "scope is limited to trade secrets, and explicitly excludes
  // public information" question unfalsifiable — the contract can satisfy one
  // half and not the other.
  { re: /[，,][^，,。？?]*[并且].*(?:是否|明确)/u, why: "一句话里塞了两个条件" },
];

/**
 * Defect criteria (`unacceptable` / `acceptable_deviation`) must be phrased as
 * "the defect is present", because the answer is read as "this tier applies".
 * A positively phrased defect question ("是否附有三十日通知？") inverts the whole
 * ladder: answering the truthfully-observed "yes" marks a clean clause as
 * defective.
 */
const DEFECT_MARKER_RE =
  /(不|无|未|没有|超出|超|不足|缺|少|单方|永久|免除|免于|放弃|排除|丧失|同时|并存|两种|不一致|不对等|转让|改变)/u;

/** Returns a list of reasons the criterion is not atomic; empty means OK. */
export function criterionProblems(criterion: RuleCriterion): string[] {
  const problems: string[] = [];
  const id = criterion.id?.trim() ?? "";
  if (!RULE_ID_RE.test(id)) {
    problems.push(`criterion id 非法：${criterion.id}`);
  }
  const question = criterion.question?.trim() ?? "";
  if (!question) {
    problems.push(`criterion ${id}：question 为空`);
  }
  if (question && !/[？?]$/u.test(question)) {
    problems.push(`criterion ${id}：question 必须以问号结尾`);
  }
  for (const { re, why } of NON_ATOMIC_PATTERNS) {
    if (re.test(question)) {
      problems.push(`criterion ${id}：含${why}，无法二值化 → ${question}`);
    }
  }
  if (
    criterion.verdictIfMet !== "compliant" &&
    criterion.verdictIfMet !== "acceptable_deviation" &&
    criterion.verdictIfMet !== "unacceptable"
  ) {
    problems.push(`criterion ${id}：verdictIfMet 非法`);
  }
  // Defect tier must read as "the defect is present"; otherwise a truthful
  // "yes" marks a clean clause as defective.
  if (
    (criterion.verdictIfMet === "unacceptable" ||
      criterion.verdictIfMet === "acceptable_deviation") &&
    question &&
    !DEFECT_MARKER_RE.test(question)
  ) {
    problems.push(
      `criterion ${id}：${criterion.verdictIfMet} 类题必须问「缺陷是否存在」，` +
        `当前问法读起来像「保护是否具备」→ ${question}`,
    );
  }
  return problems;
}

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
  if (!Array.isArray(rule.criteria) || rule.criteria.length === 0) {
    throw new Error(`rule ${rule.ruleId}: 至少需要一条 criterion（判定不能只看散文）`);
  }
  const seen = new Set<string>();
  for (const criterion of rule.criteria) {
    const problems = criterionProblems(criterion);
    if (problems.length > 0) {
      throw new Error(`rule ${rule.ruleId}: ${problems.join("；")}`);
    }
    if (seen.has(criterion.id)) {
      throw new Error(`rule ${rule.ruleId}: criterion id 重复：${criterion.id}`);
    }
    seen.add(criterion.id);
  }
  // A rule with no positive requirement can never reach compliant.
  if (!rule.criteria.some((c) => c.verdictIfMet === "compliant")) {
    throw new Error(`rule ${rule.ruleId}: 缺少 compliant 类 criterion，永远无法判合规`);
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
      criteria: rule.criteria.map((c) => ({
        id: c.id.trim(),
        question: c.question.trim(),
        verdictIfMet: c.verdictIfMet,
      })),
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
