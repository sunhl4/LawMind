/**
 * Rule-level review execution (A4).
 *
 * Off by default: `LAWMIND_RULE_BRANCH_WRITE=1` is required before any worker
 * is allowed to propose edits on a branch. When off, callers must keep using
 * the existing single-writer path (parent applies surgical edits, worker stays
 * read-only) — byte-for-byte today's behaviour.
 *
 * Workers never receive file-writing tools. They return structured EditOps;
 * the parent merges and is the only writer.
 */

import {
  mergeBranches,
  type DocumentBranch,
  type EditOp,
  type MergeResult,
} from "../drafts/branch.js";
import type { RuleReviewPlan } from "./plan.js";
import {
  coverageOf,
  type CoverageResult,
  type ReviewRule,
  type RuleClassification,
} from "./rules.js";

/** Tools a branch-writing worker must never receive. */
export const FORBIDDEN_WORKER_WRITE_TOOLS = [
  "apply_surgical_edits",
  "render_document",
  "render_tracked_draft",
  "draft_document",
  "update_draft",
  "write_document",
] as const;

export function ruleBranchWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LAWMIND_RULE_BRANCH_WRITE === "1";
}

export type RuleWorkerOutput = {
  ruleId: string;
  agentId: string;
  branchId: string;
  classification: RuleClassification;
  ops: EditOp[];
  /** Short memo: classification, chosen position, rationale. */
  memo?: string;
};

export type RuleReviewRunResult = {
  enabled: boolean;
  coverage: CoverageResult;
  merge?: MergeResult;
  /** Present when enabled and coverage is complete. */
  baseVersion?: string;
};

export class WorkerWriteToolViolation extends Error {
  constructor(toolNames: readonly string[]) {
    super(`rule branch worker received forbidden write tools: ${toolNames.join(", ")}`);
    this.name = "WorkerWriteToolViolation";
  }
}

export function assertWorkerToolsStayReadOnly(toolNames: readonly string[]): void {
  const bad = toolNames.filter((name) =>
    (FORBIDDEN_WORKER_WRITE_TOOLS as readonly string[]).includes(name),
  );
  if (bad.length > 0) {
    throw new WorkerWriteToolViolation(bad);
  }
}

/**
 * Validate worker outputs against the plan, then merge branches.
 * Throws on missing rule coverage: a review is never reported complete with
 * an unclassified rule (Harvey's "every rule gets classified" invariant).
 */
export function executeRuleReview(params: {
  plan: RuleReviewPlan;
  rules: readonly ReviewRule[];
  outputs: readonly RuleWorkerOutput[];
  baseVersion: string;
  env?: NodeJS.ProcessEnv;
}): RuleReviewRunResult {
  const expectedRules = params.plan.assignments.map((a) => a.rule);
  const classifications = params.outputs.map((o) => o.classification);
  const coverage = coverageOf(expectedRules, classifications);

  if (!ruleBranchWriteEnabled(params.env)) {
    return { enabled: false, coverage };
  }

  if (!coverage.complete) {
    throw new Error(
      `rule review incomplete: missing classifications for ${coverage.missingRuleIds.join(", ")}`,
    );
  }

  const planned = new Set(params.plan.assignments.map((a) => a.ruleId));
  const seen = new Set<string>();
  for (const out of params.outputs) {
    if (!planned.has(out.ruleId)) {
      throw new Error(`worker output for unplanned ruleId: ${out.ruleId}`);
    }
    if (seen.has(out.ruleId)) {
      throw new Error(`duplicate worker output for ruleId: ${out.ruleId}`);
    }
    seen.add(out.ruleId);
  }

  const branches: DocumentBranch[] = params.outputs.map((out) => ({
    branchId: out.branchId,
    baseVersion: params.baseVersion,
    ops: out.ops.map((op) => ({
      ...op,
      branchId: out.branchId,
      originRuleId: out.ruleId,
      originAgentId: out.agentId,
    })),
    status: "open" as const,
  }));

  const merge = mergeBranches(params.baseVersion, branches);
  return {
    enabled: true,
    coverage,
    merge,
    baseVersion: params.baseVersion,
  };
}
