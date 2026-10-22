/**
 * `finalize_rule_review` — close a rule-level review.
 *
 * Reads the verdicts review workers left in `factorState`, checks that every
 * planned rule was classified, and reports conflicts. It does not write files:
 * patch application still goes through `apply_surgical_edits`.
 *
 * Registered only when `LAWMIND_RULE_BRANCH_WRITE=1`, so the advertised tool
 * table is unchanged for every existing path.
 */

import { collectRuleOutputs, type RuleWorkerResult } from "../../../review/bridge.js";
import { planRuleReview } from "../../../review/plan.js";
import { CN_SALES_PLAYBOOK_ID, CN_SALES_RULES } from "../../../review/playbooks/cn-sales.js";
import type { PaperSide, ReviewRule } from "../../../review/rules.js";
import { readRuleClassifications, type RuleClassificationRecord } from "../../factor-state.js";
import type { AgentTool } from "../../types.js";

export const FINALIZE_RULE_REVIEW_TOOL_NAME = "finalize_rule_review";

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

export const finalizeRuleReviewTool: AgentTool = {
  definition: {
    name: FINALIZE_RULE_REVIEW_TOOL_NAME,
    description:
      "规则级审查收口：检查每条 playbook 规则是否都拿到了分类，并报告同句冲突。不写文件——改动仍走 apply_surgical_edits。任一规则未分类即返回 ok:false 与 missingRuleIds，不得声称已完成。",
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
        description: "基线版本标识，用于分支合并校验；不传用当前草稿快照。",
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
        ...(collected.invalid.length > 0 ? { invalid: collected.invalid } : {}),
        classifications: collected.outputs.map((o) => ({
          ruleId: o.ruleId,
          kind: o.classification.kind,
          ...(o.classification.risk ? { risk: o.classification.risk } : {}),
        })),
        message: `${plan.ruleCount} 条规则全部有分类。改动请在 apply_surgical_edits 落笔。`,
      },
    };
  },
};
