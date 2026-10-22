/**
 * `finalize_rule_review` — close a rule-level review.
 *
 * Three jobs, none of which write files:
 *   1. coverage — every planned rule must have a verdict;
 *   2. rule conflicts — two rules proposing different text at the same spot
 *      are surfaced here, before any apply, so the lead can resolve them;
 *   3. traceability — echo the playbook, paper and (when given) base version.
 *
 * Patch application stays in `apply_surgical_edits`, which runs its own
 * same-`find` conflict check (`patchConflicts`). This tool reports earlier so
 * the parent does not have to discover the conflict mid-write.
 *
 * Registered only when `LAWMIND_RULE_BRANCH_WRITE=1`, so the advertised tool
 * table is unchanged for every existing path.
 */

import { collectRuleOutputs, type RuleWorkerResult } from "../../../review/bridge.js";
import { planRuleReview } from "../../../review/plan.js";
import { CN_SALES_PLAYBOOK_ID, CN_SALES_RULES } from "../../../review/playbooks/cn-sales.js";
import type { PaperSide, ReviewRule } from "../../../review/rules.js";
import {
  readRuleClassifications,
  type RuleClassificationRecord,
  type WorkerPatch,
} from "../../factor-state.js";
import type { AgentTool } from "../../types.js";

export const FINALIZE_RULE_REVIEW_TOOL_NAME = "finalize_rule_review";

/** One spot where two rules ask for different text. Never auto-resolved. */
export type RulePatchConflict = {
  find: string;
  candidates: Array<{ ruleId?: string; replace: string }>;
  /** Why this is reported rather than applied: the engine does not pick wording. */
  reason: "same_anchor_different_text";
};

const PLAYBOOKS: Record<string, ReviewRule[]> = {
  [CN_SALES_PLAYBOOK_ID]: CN_SALES_RULES,
};

function resolveRules(playbookId: string): ReviewRule[] | undefined {
  return PLAYBOOKS[playbookId];
}

function asWorkerResults(records: readonly RuleClassificationRecord[]): RuleWorkerResult[] {
  return records.map((record) => ({
    ruleId: record.ruleId,
    ...(record.agentId ? { agentId: record.agentId } : {}),
    ...(record.section ? { section: record.section } : {}),
    classification: record.classification,
  }));
}

/**
 * Group verified worker patches by their `find` anchor. A group with more than
 * one distinct replacement is a rule conflict: two rules looked at the same
 * sentence and want different wording.
 */
export function collectRulePatchConflicts(patches: readonly WorkerPatch[]): RulePatchConflict[] {
  const byFind = new Map<string, WorkerPatch[]>();
  for (const patch of patches) {
    const find = patch.find.trim();
    if (!find) {
      continue;
    }
    const list = byFind.get(find) ?? [];
    list.push(patch);
    byFind.set(find, list);
  }

  const conflicts: RulePatchConflict[] = [];
  for (const [find, list] of byFind) {
    const candidates: RulePatchConflict["candidates"] = [];
    const seen = new Set<string>();
    for (const patch of list) {
      if (seen.has(patch.replace)) {
        continue;
      }
      seen.add(patch.replace);
      candidates.push({
        ...(patch.ruleId ? { ruleId: patch.ruleId } : {}),
        replace: patch.replace,
      });
    }
    if (candidates.length > 1) {
      conflicts.push({ find, candidates, reason: "same_anchor_different_text" });
    }
  }
  return conflicts.toSorted((a, b) => a.find.localeCompare(b.find));
}

export const finalizeRuleReviewTool: AgentTool = {
  definition: {
    name: FINALIZE_RULE_REVIEW_TOOL_NAME,
    description:
      "规则级审查收口：检查每条 playbook 规则是否都拿到了分类；同一句收到多个不同改法时并列报出，不替你择一。不写文件——改动仍走 apply_surgical_edits。任一规则未分类即返回 ok:false 与 missingRuleIds，不得声称已完成。",
    category: "draft",
    parameters: {
      playbook_id: {
        type: "string",
        description: `审查用的规则集，目前支持：${CN_SALES_PLAYBOOK_ID}`,
        required: true,
      },
      paper: {
        type: "string",
        description: "合同纸别：own（己方模板）/ counterparty（对方模板）。不传按全部规则核对。",
        enum: ["own", "counterparty"],
      },
      base_version: {
        type: "string",
        description:
          "基线版本标识（可选）。只做留痕回显，用于把结论对回某次草稿快照；本工具不做分支合并。",
      },
    },
    isConcurrencySafe: false,
    riskLevel: "low",
  },

  async execute(params, ctx) {
    const playbookId = typeof params.playbook_id === "string" ? params.playbook_id.trim() : "";
    const rules = playbookId ? resolveRules(playbookId) : undefined;
    if (!rules) {
      return {
        ok: false,
        error: `未知规则集：${playbookId || "(空)"}。可用：${Object.keys(PLAYBOOKS).join(" / ")}`,
        data: { code: "unknown_playbook" },
      };
    }

    const paperRaw = typeof params.paper === "string" ? params.paper.trim() : "";
    const paper: PaperSide | "unknown" =
      paperRaw === "own" || paperRaw === "counterparty" ? paperRaw : "unknown";

    let plan;
    try {
      plan = planRuleReview({ playbookId, rules, paper });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        data: { code: "plan_failed" },
      };
    }

    const records = readRuleClassifications(ctx.factorState);
    const collected = collectRuleOutputs({ plan, results: asWorkerResults(records) });
    const patches = ctx.factorState?.pendingPatches ?? [];
    const ruleConflicts = collectRulePatchConflicts(patches);
    const baseVersionRaw =
      typeof params.base_version === "string" ? params.base_version.trim() : "";

    const classified = new Set(collected.outputs.map((o) => o.ruleId));
    const missing = plan.assignments
      .map((a) => a.ruleId)
      .filter((ruleId) => !classified.has(ruleId));

    if (missing.length > 0) {
      return {
        ok: false,
        error: `规则审查未完成：${missing.length} 条规则还没有分类（${missing.join("、")}）。请补齐后再收口。`,
        data: {
          code: "rule_review_incomplete",
          coverageComplete: false,
          ruleCount: plan.ruleCount,
          conflictCount: ruleConflicts.length,
          ruleConflicts,
          ...(baseVersionRaw ? { baseVersion: baseVersionRaw } : {}),
          missingRuleIds: missing,
          invalid: collected.invalid,
        },
      };
    }

    return {
      ok: true,
      data: {
        code: "rule_review_complete",
        coverageComplete: true,
        ruleCount: plan.ruleCount,
        paper: plan.paper,
        conflictCount: ruleConflicts.length,
        ruleConflicts,
        ...(baseVersionRaw ? { baseVersion: baseVersionRaw } : {}),
        ...(collected.invalid.length > 0 ? { invalid: collected.invalid } : {}),
        classifications: collected.outputs.map((o) => ({
          ruleId: o.ruleId,
          kind: o.classification.kind,
          ...(o.classification.risk ? { risk: o.classification.risk } : {}),
        })),
        message:
          ruleConflicts.length > 0
            ? `${plan.ruleCount} 条规则全部有分类；有 ${ruleConflicts.length} 处同一句收到不同改法，请先定夺再落笔。`
            : `${plan.ruleCount} 条规则全部有分类。改动请在 apply_surgical_edits 落笔。`,
      },
    };
  },
};
