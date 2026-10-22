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

import { runDraftWorker } from "../agent/draft-worker.js";
import type { AgentModelConfig } from "../agent/types.js";
import { CN_SALES_RULES } from "../review/playbooks/cn-sales.js";
import { filterRulesForPaper, type ReviewRule } from "../review/rules.js";
import type { RuleClassificationKind } from "../review/rules.js";
import type { RuleClassification } from "../review/rules.js";
import {
  decideVerdict,
  type CriterionAnswer,
  type CriterionMet,
  type VerdictInput,
} from "../review/verdict.js";
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
  /** True when the arm aborted on an auth/config error instead of scoring garbage. */
  stoppedEarly: boolean;
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

function toVerdictInput(raw: unknown): VerdictInput | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.clausePresent !== "boolean") {
    return undefined;
  }
  const rawAnswers = Array.isArray(o.answers) ? o.answers : [];
  const answers: CriterionAnswer[] = [];
  for (const item of rawAnswers) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const criterionId =
      typeof row.criterionId === "string"
        ? row.criterionId.trim()
        : typeof row.id === "string"
          ? row.id.trim()
          : "";
    if (!criterionId) {
      continue;
    }
    const metRaw = row.met;
    let met: CriterionMet | undefined;
    if (typeof metRaw === "boolean") {
      met = metRaw;
    } else if (metRaw === "unknown" || metRaw === "not_applicable") {
      met = metRaw;
    }
    if (met === undefined) {
      continue;
    }
    const evidence = typeof row.evidence === "string" ? row.evidence.trim() : "";
    answers.push({ criterionId, met, ...(evidence ? { evidence } : {}) });
  }
  return { clausePresent: o.clausePresent, answers };
}

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
 * One rule through the production review worker.
 *
 * Workers routinely answer only the criteria that look problematic and skip the
 * satisfied ones. That used to surface as `needs_human` on a perfectly fine
 * clause. One follow-up asking for the missing ids fixes it in practice, so the
 * arm retries once before reporting the rule as unanswered.
 */
async function classifyOneRule(params: {
  rule: ReviewRule;
  contract: string;
  chatModel: AgentModelConfig;
}): Promise<{ answers?: VerdictInput; error?: string }> {
  const collected = new Map<string, CriterionAnswer>();
  let clausePresent: boolean | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const stillMissing = params.rule.criteria.map((c) => c.id).filter((id) => !collected.has(id));
    if (attempt > 0 && stillMissing.length === 0) {
      break;
    }
    const result = await runDraftWorker(
      {
        // Only the second attempt may claim a previous round was incomplete.
        goal: buildRuleGoal(
          params.rule,
          attempt > 0 && stillMissing.length > 0
            ? { missingCriterionIds: stillMissing }
            : undefined,
        ),
        notGoal: "不要起草或改写条款，不要评价其他规则，不要导出文件",
        excerpt: params.contract,
        section: params.rule.ruleId,
        role: "review",
        ruleId: params.rule.ruleId,
      },
      { chatModel: params.chatModel, sidecarRole: "review" },
    );
    if (!result.ok) {
      if (attempt === 1) {
        return { error: result.error };
      }
      continue;
    }
    const data = result.data as { verdictAnswers?: unknown };
    const parsed = toVerdictInput(data.verdictAnswers);
    if (!parsed) {
      if (attempt === 1) {
        return { error: "worker returned no verdictAnswers" };
      }
      continue;
    }
    clausePresent = clausePresent ?? parsed.clausePresent;
    for (const answer of parsed.answers) {
      if (!collected.has(answer.criterionId)) {
        collected.set(answer.criterionId, answer);
      }
    }
    if (!clausePresent) {
      break;
    }
    if (params.rule.criteria.every((c) => collected.has(c.id))) {
      break;
    }
  }

  if (clausePresent === undefined) {
    return { error: "worker returned no verdictAnswers" };
  }
  return {
    answers: { clausePresent, answers: [...collected.values()] },
  };
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
      const firstRationale = samples.find((s) => s.rationale)?.rationale;
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
      // Auth / config errors would burn the whole budget scoring nothing.
      if (/401|403|unauthorized|api key|未配置|not configured/i.test(error)) {
        stoppedEarly = true;
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
  };
}
