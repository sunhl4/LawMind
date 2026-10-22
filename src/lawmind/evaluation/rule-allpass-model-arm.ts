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
import type { RuleClassification, RuleClassificationKind } from "../review/rules.js";
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
   * Test seam: classify one rule. Production omits it and uses the real review
   * worker. Exposed so the arm's bookkeeping can be tested without a provider.
   */
  classifyRule?: (input: {
    rule: ReviewRule;
    contract: string;
    chatModel: AgentModelConfig;
  }) => Promise<{ classification?: RuleClassification; error?: string }>;
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
 * Goal text for one rule: the worker must judge this rule, nothing else.
 *
 * The verdict ladder is explicit and ordered. Without it, models treat
 * "does not satisfy every compliant condition" as unacceptable and skip the
 * acceptable-deviation rung entirely.
 */
export function buildRuleGoal(rule: ReviewRule): string {
  const ladder = [
    "判定顺序（必须按此顺序，命中即停）：",
    rule.absentAllowed
      ? "  1. 合同完全没有涉及本规则事项 → 判 absent（absent 是最终结论，不是缺陷，不要再往下判）。"
      : "  1. 合同完全没有涉及本规则事项 → 判 unacceptable（本规则不允许缺失）。",
    rule.unacceptable.length > 0
      ? `  2. 命中「永不接受」任一项 → 判 unacceptable。永不接受：${rule.unacceptable.join("；")}`
      : "  2. 无「永不接受」项。",
    rule.acceptable.length > 0
      ? `  3. 命中「可接受回退」任一项 → 判 acceptable_deviation（不要再因为不满足 compliant 全部条件而升到 unacceptable）。可接受回退：${rule.acceptable.join("；")}`
      : "  3. 无「可接受回退」项。",
    rule.compliantWhen && rule.compliantWhen.length > 0
      ? [
          "  4. 以下条件全部满足 → 判 compliant（规则没有要求的额外保护，不得作为降档理由）：",
          ...rule.compliantWhen.map((item) => `     - ${item}`),
        ].join("\n")
      : "  4. 与标准立场一致 → 判 compliant。",
    "  5. 以上都不成立且材料确实不足以判定 → 判 needs_human，并在理由里写明缺哪一份材料。",
  ];

  return [
    `审查这条规则并给出一个判定：${rule.ruleId}（${rule.title}）。`,
    `标准立场：${rule.standard}`,
    ...ladder,
    rule.guidance ? `判定指引：${rule.guidance}` : "",
    "只交回这一条规则的分类与依据，不要评价其他规则，不要改原文。",
  ]
    .filter(Boolean)
    .join("\n");
}

const KINDS: ReadonlySet<string> = new Set<RuleClassificationKind>([
  "compliant",
  "acceptable_deviation",
  "unacceptable",
  "absent",
  "needs_human",
]);

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

function toClassification(ruleId: string, raw: unknown): RuleClassification | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const kind = typeof o.kind === "string" ? o.kind.trim() : "";
  if (!KINDS.has(kind)) {
    return undefined;
  }
  const rationale = typeof o.rationale === "string" ? o.rationale.trim() : "";
  const position = typeof o.position === "string" ? o.position.trim() : "";
  return {
    ruleId,
    kind: kind as RuleClassificationKind,
    ...(rationale ? { rationale } : {}),
    ...(position ? { position } : {}),
  };
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

/** One rule through the production review worker. */
async function classifyOneRule(params: {
  rule: ReviewRule;
  contract: string;
  chatModel: AgentModelConfig;
}): Promise<{ classification?: RuleClassification; error?: string }> {
  const result = await runDraftWorker(
    {
      goal: buildRuleGoal(params.rule),
      notGoal: "不要起草或改写条款，不要评价其他规则，不要导出文件",
      excerpt: params.contract,
      section: params.rule.ruleId,
      role: "review",
      ruleId: params.rule.ruleId,
    },
    { chatModel: params.chatModel, sidecarRole: "review" },
  );
  if (!result.ok) {
    return { error: result.error };
  }
  const data = result.data as { classification?: unknown };
  const classification = toClassification(params.rule.ruleId, data.classification);
  if (!classification) {
    return { error: "worker returned no valid classification" };
  }
  return { classification };
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
          samples.push({
            ...(got.classification ? { kind: got.classification.kind } : {}),
            ...(got.classification?.rationale ? { rationale: got.classification.rationale } : {}),
            ...(got.error ? { error: got.error } : {}),
          });
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
