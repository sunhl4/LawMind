/**
 * Bridge from worker answers to rule-level review (B4).
 *
 * Pure functions only: no model calls, no disk writes. The parent collects what
 * each worker answered, this module says whether the plan was covered, and the
 * tier comes from `decideVerdict` — never from the worker.
 */

import type { WorkerPatch } from "../agent/factor-state.js";
import type { RuleWorkerOutput } from "./execute.js";
import type { RuleReviewPlan } from "./plan.js";
import { decideVerdict, missingCriterionIds, type CriterionAnswer } from "./verdict.js";

/** Shape a worker hands back to the parent (subset of DraftWorkerOutput.data). */
export type RuleWorkerResult = {
  ruleId?: string;
  agentId?: string;
  section?: string;
  verdictAnswers?: {
    clausePresent?: unknown;
    answers?: unknown;
  };
  patches?: readonly WorkerPatch[];
};

export type CollectRuleOutputsResult = {
  outputs: RuleWorkerOutput[];
  /** Results that cannot be attributed to a planned rule. Never silently dropped. */
  invalid: Array<{ ruleId: string; reason: string }>;
  /** Rules whose answers were unusable; these keep coverage incomplete. */
  unansweredRuleIds: string[];
};

function toAnswers(raw: RuleWorkerResult["verdictAnswers"]): CriterionAnswer[] {
  if (!raw || !Array.isArray(raw.answers)) {
    return [];
  }
  const answers: CriterionAnswer[] = [];
  for (const item of raw.answers) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const criterionId = typeof row.criterionId === "string" ? row.criterionId.trim() : "";
    if (!criterionId) {
      continue;
    }
    const metRaw = row.met;
    const met =
      typeof metRaw === "boolean" || metRaw === "unknown" || metRaw === "not_applicable"
        ? metRaw
        : undefined;
    if (met === undefined) {
      continue;
    }
    const evidence = typeof row.evidence === "string" ? row.evidence.trim() : "";
    answers.push({ criterionId, met, ...(evidence ? { evidence } : {}) });
  }
  return answers;
}

/**
 * Validate worker results against the plan and map answers to verdicts.
 *
 * A missing `ruleId`, an unplanned `ruleId`, or a duplicate makes the result
 * invalid. A result without a usable `clausePresent` is reported as unanswered:
 * the engine never invents `clausePresent` or a missing criterion answer.
 */
export function collectRuleOutputs(params: {
  plan: RuleReviewPlan;
  results: readonly RuleWorkerResult[];
}): CollectRuleOutputsResult {
  const planned = new Map(params.plan.assignments.map((a) => [a.ruleId, a.rule]));
  const outputs: RuleWorkerOutput[] = [];
  const invalid: CollectRuleOutputsResult["invalid"] = [];
  const unansweredRuleIds: string[] = [];
  const seen = new Set<string>();

  for (const result of params.results) {
    const ruleId = (result.ruleId ?? "").trim();
    if (!ruleId) {
      invalid.push({ ruleId: "", reason: "missing_rule_id" });
      continue;
    }
    const rule = planned.get(ruleId);
    if (!rule) {
      invalid.push({ ruleId, reason: "unplanned_rule_id" });
      continue;
    }
    if (seen.has(ruleId)) {
      invalid.push({ ruleId, reason: "duplicate_rule_id" });
      continue;
    }

    const raw = result.verdictAnswers;
    const clausePresent = typeof raw?.clausePresent === "boolean" ? raw.clausePresent : undefined;
    if (clausePresent === undefined) {
      invalid.push({ ruleId, reason: "missing_clause_present" });
      unansweredRuleIds.push(ruleId);
      continue;
    }

    const answers = toAnswers(raw);
    if (clausePresent) {
      const missing = missingCriterionIds(rule, answers);
      if (missing.length > 0) {
        // Retry is the caller's job; here we report rather than default to false.
        invalid.push({
          ruleId,
          reason: `missing_criteria:${missing.join(",")}`,
        });
        unansweredRuleIds.push(ruleId);
        continue;
      }
    }

    seen.add(ruleId);
    outputs.push({
      ruleId,
      agentId: (result.agentId ?? `agent:${ruleId}`).trim(),
      branchId: `branch:${ruleId}`,
      classification: decideVerdict(rule, { clausePresent, answers }),
      ops: [],
      ...(typeof result.section === "string" && result.section.trim()
        ? { memo: result.section.trim() }
        : {}),
    });
  }

  return { outputs, invalid, unansweredRuleIds };
}
