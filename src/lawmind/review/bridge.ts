/**
 * Bridge from worker results to rule-level review (B4).
 *
 * Pure functions only: no model calls, no disk writes. The parent collects what
 * each worker returned, this module states whether the plan was covered, and
 * `executeRuleReview` decides the merge.
 */

import type { WorkerPatch } from "../agent/factor-state.js";
import type { RuleWorkerOutput } from "./execute.js";
import type { RuleReviewPlan } from "./plan.js";
import type { RuleClassification, RuleClassificationKind } from "./rules.js";

const CLASSIFICATION_KINDS: readonly RuleClassificationKind[] = new Set([
  "compliant",
  "acceptable_deviation",
  "unacceptable",
  "absent",
  "needs_human",
]);

/** Shape a worker hands back to the parent (subset of DraftWorkerOutput.data). */
export type RuleWorkerResult = {
  ruleId?: string;
  agentId?: string;
  section?: string;
  classification?: {
    kind?: string;
    rationale?: string;
    position?: string;
    risk?: string;
    evidence?: string[];
  };
  patches?: readonly WorkerPatch[];
};

export type CollectRuleOutputsResult = {
  outputs: RuleWorkerOutput[];
  /** Results that cannot be attributed to a planned rule. Never silently dropped. */
  invalid: Array<{ ruleId: string; reason: string }>;
};

/**
 * Validate worker results against the plan.
 *
 * A missing `ruleId`, an unplanned `ruleId`, a duplicate, or a missing/invalid
 * classification makes the result invalid. Invalid results are returned rather
 * than guessed at, so the caller reports `coverage: incomplete`.
 */
export function collectRuleOutputs(params: {
  plan: RuleReviewPlan;
  results: readonly RuleWorkerResult[];
  /** Patches dropped for any reason; surfaced so the caller can explain. */
}): CollectRuleOutputsResult {
  const planned = new Set(params.plan.assignments.map((a) => a.ruleId));
  const outputs: RuleWorkerOutput[] = [];
  const invalid: CollectRuleOutputsResult["invalid"] = [];
  const seen = new Set<string>();

  for (const result of params.results) {
    const ruleId = (result.ruleId ?? "").trim();
    if (!ruleId) {
      invalid.push({ ruleId: "", reason: "missing_rule_id" });
      continue;
    }
    if (!planned.has(ruleId)) {
      invalid.push({ ruleId, reason: "unplanned_rule_id" });
      continue;
    }
    if (seen.has(ruleId)) {
      invalid.push({ ruleId, reason: "duplicate_rule_id" });
      continue;
    }

    const classification = toClassification(ruleId, result.classification);
    if (!classification) {
      invalid.push({ ruleId, reason: "missing_classification" });
      continue;
    }

    seen.add(ruleId);
    outputs.push({
      ruleId,
      agentId: (result.agentId ?? `agent:${ruleId}`).trim(),
      branchId: `branch:${ruleId}`,
      classification,
      ops: [],
      ...(typeof result.section === "string" && result.section.trim()
        ? { memo: result.section.trim() }
        : {}),
    });
  }

  return { outputs, invalid };
}

function toClassification(
  ruleId: string,
  raw: RuleWorkerResult["classification"],
): RuleClassification | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const kind = typeof raw.kind === "string" ? raw.kind.trim() : "";
  if (!CLASSIFICATION_KINDS.has(kind as RuleClassificationKind)) {
    return undefined;
  }
  const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";
  const position = typeof raw.position === "string" ? raw.position.trim() : "";
  const riskRaw = typeof raw.risk === "string" ? raw.risk.trim() : "";
  const risk =
    riskRaw === "high" || riskRaw === "medium" || riskRaw === "low" ? riskRaw : undefined;
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
  return {
    ruleId,
    kind: kind as RuleClassificationKind,
    ...(rationale ? { rationale } : {}),
    ...(position ? { position } : {}),
    ...(risk ? { risk } : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
  };
}
