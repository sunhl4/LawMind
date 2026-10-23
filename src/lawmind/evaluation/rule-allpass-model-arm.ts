/**
 * Real-model arm for the rule-level all-pass benchmark.
 *
 * Runs the **production review worker** (`runDraftWorker` with `role: "review"`
 * and a `ruleId`) once per rule per case, then scores with
 * `scoreRuleAllPassCase`. Fixtures are not special-cased: the worker only sees
 * the contract text and the rule text, exactly like a real dispatch.
 *
 * Honest scope: the fixtures are synthetic, so a score here measures "can the
 * harness drive a model through the rule structure", not legal quality on real
 * contracts. Never quote this number as accuracy evidence.
 */

import { callModelWithRetry } from "../agent/runtime-model-call.js";
import type { AgentModelConfig } from "../agent/types.js";
import { CN_SALES_RULES } from "../review/playbooks/cn-sales.js";
import { filterRulesForPaper, type ReviewRule, type RuleCriterion } from "../review/rules.js";
import type { RuleClassificationKind } from "../review/rules.js";
import type { RuleClassification } from "../review/rules.js";
import { decideVerdict, type CriterionAnswer, type VerdictInput } from "../review/verdict.js";
import { scoreRuleAllPassCase, type RuleAllPassCase, type RuleCaseScore } from "./rule-allpass.js";

export type ModelArmOptions = {
  cases: readonly RuleAllPassCase[];
  chatModel: AgentModelConfig;
  /** Defaults to the built-in cn-sales-v0 rule set. */
  rules?: readonly ReviewRule[];
  /** Rules evaluated in parallel. Defaults to 3 to stay inside provider limits. */
  concurrency?: number;
  /** Per-rule timeout. Defaults to 120s. */
  timeoutMs?: number;
  /** Cap the number of cases (budget guard). */
  maxCases?: number;
  /**
   * Independent samples per rule. A single sample is not reproducible: the same
   * prompt on the same model can flip between acceptable_deviation and
   * compliant. With trials > 1 the verdict is the majority and `stable` records
   * whether every sample agreed.
   */
  trials?: number;
  /**
   * Test seam: answer one rule's criteria. Production omits it and uses the
   * real review worker. Returns answers, not a tier — the tier is mapped by
   * `decideVerdict` so this seam cannot accidentally test model tier-picking.
   */
  classifyRule?: (input: {
    rule: ReviewRule;
    contract: string;
    chatModel: AgentModelConfig;
  }) => Promise<{ answers?: VerdictInput; error?: string }>;
  onProgress?: (event: { caseId: string; ruleId: string; done: number; total: number }) => void;
};

export type ModelArmRuleResult = {
  ruleId: string;
  kind?: RuleClassificationKind;
  /** Why the model chose this verdict. Kept for diagnosis, not scoring. */
  rationale?: string;
  /** Every sample's verdict, in order. Length equals `trials`. */
  samples?: Array<RuleClassificationKind | "error">;
  /** True when all samples agreed. Absent for a single-trial run. */
  stable?: boolean;
  error?: string;
};

export type ModelArmCaseResult = {
  caseId: string;
  perRule: ModelArmRuleResult[];
  score: RuleCaseScore;
};

export type ModelArmResult = {
  arm: string;
  model: string;
  cases: ModelArmCaseResult[];
  /** Rules that produced no verdict or errored; these make coverage incomplete. */
  failures: Array<{ caseId: string; ruleId: string; error: string }>;
  totalCalls: number;
  /** True when the arm aborted instead of scoring garbage. */
  stoppedEarly: boolean;
  /**
   * The error that aborted the run, when it was infrastructure rather than the
   * model's judgement (auth, balance, quota, connectivity). Present means the
   * accuracy numbers are meaningless and must not be quoted.
   */
  infraError?: string;
};

/**
 * Prompt for one rule: the worker answers the rule's criteria, nothing else.
 *
 * The prompt deliberately does NOT ask for a tier. Asking for a tier is what
 * produced 12% unstable verdicts; yes/no answers are stable. Mapping to a tier
 * is `decideVerdict`'s job.
 */
export function buildRuleGoal(
  rule: ReviewRule,
  opts?: { missingCriterionIds?: readonly string[] },
): string {
  const missing = new Set(opts?.missingCriterionIds ?? []);
  const relevant =
    missing.size > 0 ? rule.criteria.filter((c) => missing.has(c.id)) : rule.criteria;
  // Every question carries its polarity. Without this the model reads
  // "是否附有三十日通知" as a defect when it is actually a protection.
  const polarityLabel: Record<string, string> = {
    unacceptable: "不可接受项：答 true 表示存在该缺陷",
    acceptable_deviation: "偏离项：答 true 表示存在该偏离",
    compliant: "合规要件：答 true 表示该保护已具备",
  };
  const questions = relevant.map(
    (criterion, index) =>
      `  ${index + 1}. [${criterion.id}]（${polarityLabel[criterion.verdictIfMet] ?? ""}）${criterion.question}`,
  );
  const retryNote =
    missing.size > 0
      ? ["", `上次漏答了这些题：${[...missing].join("、")}。本次只需补答下列题目，其余不用重复。`]
      : [];
  return [
    `审查这条规则并逐题作答：${rule.ruleId}（${rule.title}）。`,
    `标准立场（供理解，不作为判定依据）：${rule.standard}`,
    ...retryNote,
    "",
    "对下列每一题回答 true / false / unknown / not_applicable，并给出合同原文证据：",
    ...questions,
    "",
    "每一题都必须回答，不能因为「看起来没问题」就省略；漏答的题会导致整条规则需要人工复核。",
    rule.absentAllowed
      ? "如果合同完全没有涉及本规则事项，clausePresent 填 false（不要逐题作答）。"
      : "如果合同完全没有涉及本规则事项，clausePresent 填 false；本规则不允许缺失。",
    "unknown 仅用于「合同写了但读不出结论」，并在理由里写明缺什么；不要为了保守而滥答 unknown。",
    "只交回本规则的逐题答案，不要给档位结论——档位由引擎按固定规则判定，不要评价其他规则，不要改原文。",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/**
 * Tie-break order for a split vote: lower wins. A rule whose samples disagree
 * is reported at its most conservative reading, never its most flattering one.
 */
const CONSERVATIVE_ORDER: Record<RuleClassificationKind, number> = {
  unacceptable: 0,
  needs_human: 1,
  absent: 2,
  acceptable_deviation: 3,
  compliant: 4,
};

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

/**
 * Parse a one-word answer. Tolerates the forms models actually emit (Chinese
 * 是/否, trailing punctuation, a leading "答案："), because a parsing miss used
 * to turn into `unknown` and then into a silent `needs_human`.
 */
export function parsePolarityAnswer(raw: unknown): boolean | "unknown" {
  const text = (typeof raw === "string" ? raw : "")
    .trim()
    .toLowerCase()
    .replace(/^[\s"'`「『]+|[\s"'`」』。.!！?？]+$/gu, "");
  if (!text) {
    return "unknown";
  }
  const head = text.replace(/^答案[:：\s]*/u, "");
  if (/^(true|yes|y)\b/u.test(head) || /^(是|对|正确|有|存在|具备|已具备)/u.test(head)) {
    return true;
  }
  if (/^(false|no|n)\b/u.test(head) || /^(否|不|没有|不存在|不具备|未)/u.test(head)) {
    return false;
  }
  return "unknown";
}

/** Answer-only system prompt. Deliberately not the review-worker role. */
const ONE_QUESTION_SYSTEM = [
  "你只做一件事：根据合同原文回答一个是非题。",
  "只输出 true 或 false，不要解释，不要加引号或其他字符。true 表示「是」，false 表示「否」。",
].join("");

/**
 * Ask one criterion in isolation.
 *
 * Measured 2026-10-23: asking the same production criteria one per call put
 * 12/12 fixture verdicts back in agreement (s01 and s02, clean and defective),
 * while the same criteria asked as a batch of 4-5 in one JSON payload collapsed
 * to "yes" on every defect question (0% all-pass). The batch payload was the
 * defect, not the criteria and not the model's reading of polarity.
 *
 * Hence: one criterion, one call, one word.
 */
async function askCriterion(params: {
  contract: string;
  criterion: RuleCriterion;
  chatModel: AgentModelConfig;
}): Promise<boolean | "unknown"> {
  const polarity =
    params.criterion.verdictIfMet === "compliant"
      ? "本题问的是「某项保护是否已经具备」：具备答 true，不具备答 false。"
      : "本题问的是「某个缺陷是否存在」：存在答 true，不存在答 false。";
  const response = await callModelWithRetry(
    params.chatModel,
    [
      { role: "system", content: ONE_QUESTION_SYSTEM },
      {
        role: "user",
        content: [
          "【合同】",
          params.contract,
          "",
          "【问题】",
          params.criterion.question,
          "",
          polarity,
          "如果合同里根本没有涉及这件事，按「不存在/不具备」回答 false。",
          "只输出 true 或 false。",
        ].join("\n"),
      },
    ],
    [],
  );
  const content = (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
    ?.message?.content;
  return parsePolarityAnswer(content);
}

/**
 * Ask whether the contract addresses this rule's topic at all.
 *
 * `clausePresent` was previously hardcoded `true`, which made `absent`
 * unreachable and silently mislabeled genuine absence as a deviation. One
 * extra question per rule is cheaper than that class of error.
 */
async function askClausePresent(params: {
  contract: string;
  rule: ReviewRule;
  chatModel: AgentModelConfig;
}): Promise<boolean | "unknown"> {
  const response = await callModelWithRetry(
    params.chatModel,
    [
      { role: "system", content: ONE_QUESTION_SYSTEM },
      {
        role: "user",
        content: [
          "【合同】",
          params.contract,
          "",
          "【问题】",
          [
            `本合同是否就下列任一项作出了约定？（规则：${params.rule.title}）`,
            ...params.rule.criteria.map((c) => `- ${c.question}`),
            "只要合同中有一句涉及上述任一项，答 true；整份合同完全没有提到，答 false。",
          ].join("\n"),
          "只输出 true 或 false。",
        ].join("\n"),
      },
    ],
    [],
  );
  const content = (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
    ?.message?.content;
  return parsePolarityAnswer(content);
}

/** Answer every criterion of one rule, one call each. */
async function classifyOneRule(params: {
  rule: ReviewRule;
  contract: string;
  chatModel: AgentModelConfig;
}): Promise<{ answers?: VerdictInput; error?: string }> {
  let clausePresent: boolean | "unknown" = "unknown";
  try {
    clausePresent = await askClausePresent({
      contract: params.contract,
      rule: params.rule,
      chatModel: params.chatModel,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  // Absence short-circuits: asking the criteria would only invite the model to
  // invent readings of a clause that is not there.
  if (clausePresent === false) {
    return { answers: { clausePresent: false, answers: [] } };
  }
  const answers: CriterionAnswer[] = [];
  for (const criterion of params.rule.criteria) {
    try {
      const met = await askCriterion({
        contract: params.contract,
        criterion,
        chatModel: params.chatModel,
      });
      answers.push({ criterionId: criterion.id, met });
    } catch (err) {
      answers.push({
        criterionId: criterion.id,
        met: "unknown",
        evidence: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (answers.length === 0) {
    return { error: "rule has no criteria" };
  }
  return { answers: { clausePresent: true, answers } };
}

/**
 * Errors that mean "the run cannot measure anything", not "the model answered
 * wrong". A 402 Insufficient Balance used to be classified as an ordinary
 * failure, so the arm kept calling the API for the rest of the cases and the
 * report printed an accuracy number computed almost entirely from errors.
 */
export function isInfrastructureError(message: string): boolean {
  return /\b(401|402|403|429)\b|unauthorized|insufficient[ _]?balance|quota|rate.?limit|api key|未配置|not configured|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up/i.test(
    message,
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

export async function runRuleAllPassModelArm(opts: ModelArmOptions): Promise<ModelArmResult> {
  const rules = opts.rules ?? CN_SALES_RULES;
  const concurrency = opts.concurrency ?? 3;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const plannedCases = opts.maxCases ? opts.cases.slice(0, opts.maxCases) : opts.cases;
  const totalCalls = plannedCases.reduce(
    (n, c) => n + filterRulesForPaper(rules, c.paper).length,
    0,
  );

  const cases: ModelArmCaseResult[] = [];
  const failures: ModelArmResult["failures"] = [];
  const classify = opts.classifyRule ?? classifyOneRule;
  const trials = Math.max(1, opts.trials ?? 1);
  let done = 0;
  let stoppedEarly = false;
  let infraError: string | undefined;
  const totalSamples = totalCalls * trials;

  for (const c of plannedCases) {
    const applicable = filterRulesForPaper(rules, c.paper);
    const outcomes = await mapWithConcurrency(applicable, concurrency, async (rule) => {
      const samples: Array<{ kind?: RuleClassificationKind; rationale?: string; error?: string }> =
        [];
      for (let t = 0; t < trials; t += 1) {
        try {
          const got = await withTimeout(
            classify({ rule, contract: c.contract, chatModel: opts.chatModel }),
            timeoutMs,
            `${rule.ruleId}#${t + 1}`,
          );
          if (got.answers) {
            // Tier comes from the deterministic mapper, never from the model.
            const decision = decideVerdict(rule, got.answers);
            samples.push({
              kind: decision.kind,
              ...(decision.rationale ? { rationale: decision.rationale } : {}),
            });
          } else {
            samples.push({ error: got.error ?? "no verdictAnswers" });
          }
        } catch (err) {
          samples.push({ error: err instanceof Error ? err.message : String(err) });
        }
        done += 1;
        opts.onProgress?.({
          caseId: c.caseId,
          ruleId: rule.ruleId,
          done,
          total: totalSamples,
        });
      }

      // Majority over successful samples. Ties break toward the more
      // conservative verdict so an unstable rule is never reported better
      // than its weakest sample.
      const kinds = samples
        .map((s) => s.kind)
        .filter((k): k is RuleClassificationKind => Boolean(k));
      const counts = new Map<RuleClassificationKind, number>();
      for (const kind of kinds) {
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
      let winner: RuleClassificationKind | undefined;
      let best = 0;
      for (const [kind, n] of counts) {
        if (
          n > best ||
          (n === best && winner && CONSERVATIVE_ORDER[kind] < CONSERVATIVE_ORDER[winner])
        ) {
          winner = kind;
          best = n;
        }
      }
      const stable = kinds.length === samples.length && new Set(kinds).size === 1;
      // Report the rationale of a sample that actually produced the winning
      // verdict. Taking "the first sample that has one" attributed a
      // needs_human explanation to a compliant verdict and sent diagnosis down
      // the wrong path.
      const winnerRationale =
        samples.find((s) => s.kind === winner && s.rationale)?.rationale ??
        samples.find((s) => s.rationale)?.rationale;
      const firstRationale = winnerRationale;
      const error = samples.find((s) => s.error)?.error;
      return { rule, winner, stable, firstRationale, error, samples };
    });

    const perRule: ModelArmRuleResult[] = [];
    const classifications: RuleClassification[] = [];
    for (const outcome of outcomes) {
      const samples = outcome.samples.map((s) => s.kind ?? ("error" as const));
      if (outcome.winner) {
        perRule.push({
          ruleId: outcome.rule.ruleId,
          kind: outcome.winner,
          ...(outcome.firstRationale ? { rationale: outcome.firstRationale } : {}),
          ...(trials > 1 ? { samples, stable: outcome.stable } : {}),
        });
        classifications.push({ ruleId: outcome.rule.ruleId, kind: outcome.winner });
        continue;
      }
      const error = outcome.error ?? "no verdict";
      perRule.push({
        ruleId: outcome.rule.ruleId,
        error,
        ...(trials > 1 ? { samples } : {}),
      });
      failures.push({ caseId: c.caseId, ruleId: outcome.rule.ruleId, error });
      if (isInfrastructureError(error)) {
        stoppedEarly = true;
        infraError = infraError ?? error;
      }
    }

    cases.push({
      caseId: c.caseId,
      perRule,
      score: scoreRuleAllPassCase(c, classifications),
    });
    if (stoppedEarly) {
      break;
    }
  }

  return {
    arm: `model:${opts.chatModel.model}`,
    model: opts.chatModel.model,
    cases,
    failures,
    totalCalls: done,
    stoppedEarly,
    ...(infraError ? { infraError } : {}),
  };
}
