import { afterEach, describe, expect, it } from "vitest";
import { CN_SALES_RULES } from "../../../review/playbooks/cn-sales.js";
import { filterRulesForPaper } from "../../../review/rules.js";
import { synthesizeAnswers } from "../../../review/verdict-oracle.js";
import { emptyFactorState, ingestToolResult } from "../../factor-state.js";
import type { AgentTool } from "../../types.js";
import {
  collectRulePatchConflicts,
  FINALIZE_RULE_REVIEW_TOOL_NAME,
  finalizeRuleReviewTool,
} from "./finalize-rule-review-tool.js";

type Ctx = Parameters<AgentTool["execute"]>[1];

function ruleOf(ruleId: string) {
  const rule = CN_SALES_RULES.find((r) => r.ruleId === ruleId);
  if (!rule) {
    throw new Error(`rule not found: ${ruleId}`);
  }
  return rule;
}

function ctxWith(
  records: Array<{ ruleId: string; kind: string }>,
  patches: Array<{ find: string; replace: string; span?: string; ruleId?: string }> = [],
  workspaceDir = "/tmp/lm-final",
) {
  const factorState = emptyFactorState();
  for (const record of records) {
    ingestToolResult(factorState, "draft_worker", {
      ruleId: record.ruleId,
      verdictAnswers: synthesizeAnswers(
        ruleOf(record.ruleId),
        record.kind as Parameters<typeof synthesizeAnswers>[1],
      ),
    });
  }
  if (patches.length > 0) {
    ingestToolResult(factorState, "draft_worker", { patches });
  }
  return { factorState, workspaceDir } as unknown as Ctx;
}

const counterpartyRules = filterRulesForPaper(CN_SALES_RULES, "counterparty");
const SPAN = "甲方应在三十日内支付违约金。";

afterEach(() => {
  delete process.env.LAWMIND_RULE_BRANCH_WRITE;
});

describe("finalize_rule_review", () => {
  it("is named as advertised", () => {
    expect(FINALIZE_RULE_REVIEW_TOOL_NAME).toBe("finalize_rule_review");
    expect(finalizeRuleReviewTool.definition.name).toBe(FINALIZE_RULE_REVIEW_TOOL_NAME);
  });

  it("reports incomplete instead of claiming success when rules are missing", async () => {
    const ruleId = counterpartyRules[0].ruleId;
    const result = await finalizeRuleReviewTool.execute(
      { playbook_id: "cn-sales-v0", paper: "counterparty" },
      ctxWith([{ ruleId, kind: "compliant" }]),
    );
    expect(result.ok).toBe(false);
    const data = result.data as { code: string; missingRuleIds: string[] };
    expect(data.code).toBe("rule_review_incomplete");
    expect(data.missingRuleIds).toHaveLength(counterpartyRules.length - 1);
    expect(data.missingRuleIds).not.toContain(ruleId);
  });

  it("passes when every planned rule has a verdict", async () => {
    const result = await finalizeRuleReviewTool.execute(
      { playbook_id: "cn-sales-v0", paper: "counterparty" },
      ctxWith(counterpartyRules.map((r) => ({ ruleId: r.ruleId, kind: "compliant" }))),
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      coverageComplete: boolean;
      ruleCount: number;
      conflictCount: number;
      ruleConflicts: unknown[];
    };
    expect(data.coverageComplete).toBe(true);
    expect(data.ruleCount).toBe(counterpartyRules.length);
    expect(data.conflictCount).toBe(0);
    expect(data.ruleConflicts).toEqual([]);
  });

  it("surfaces same-sentence disagreement between two rules before any write", async () => {
    const result = await finalizeRuleReviewTool.execute(
      { playbook_id: "cn-sales-v0", paper: "counterparty" },
      ctxWith(
        counterpartyRules.map((r) => ({ ruleId: r.ruleId, kind: "acceptable_deviation" })),
        [
          {
            find: "三十日",
            replace: "六十日",
            span: SPAN,
            ruleId: "payment.acceptance.counterparty",
          },
          {
            find: "三十日",
            replace: "十五日",
            span: SPAN,
            ruleId: "termination.symmetry.counterparty",
          },
        ],
      ),
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      conflictCount: number;
      ruleConflicts: Array<{
        find: string;
        reason: string;
        candidates: Array<{ ruleId?: string; replace: string }>;
      }>;
      message: string;
    };
    expect(data.conflictCount).toBe(1);
    expect(data.ruleConflicts[0]?.find).toBe("三十日");
    expect(data.ruleConflicts[0]?.reason).toBe("same_anchor_different_text");
    const byLocale = (a: string, b: string) => a.localeCompare(b);
    expect(data.ruleConflicts[0]?.candidates.map((c) => c.ruleId ?? "").toSorted(byLocale)).toEqual(
      ["payment.acceptance.counterparty", "termination.symmetry.counterparty"].toSorted(byLocale),
    );
    expect(data.message).toContain("请先定夺");
  });

  it("does not flag a conflict when two rules agree on the same text", async () => {
    const result = await finalizeRuleReviewTool.execute(
      { playbook_id: "cn-sales-v0", paper: "counterparty" },
      ctxWith(
        counterpartyRules.map((r) => ({ ruleId: r.ruleId, kind: "compliant" })),
        [
          {
            find: "三十日",
            replace: "六十日",
            span: SPAN,
            ruleId: "payment.acceptance.counterparty",
          },
          {
            find: "三十日",
            replace: "六十日",
            span: SPAN,
            ruleId: "termination.symmetry.counterparty",
          },
        ],
      ),
    );
    expect(result.ok).toBe(true);
    expect((result.data as { conflictCount: number }).conflictCount).toBe(0);
  });

  it("echoes base_version for traceability without claiming a merge", async () => {
    const result = await finalizeRuleReviewTool.execute(
      { playbook_id: "cn-sales-v0", paper: "counterparty", base_version: "sha256:abc" },
      ctxWith(counterpartyRules.map((r) => ({ ruleId: r.ruleId, kind: "compliant" }))),
    );
    expect(result.ok).toBe(true);
    expect((result.data as { baseVersion: string }).baseVersion).toBe("sha256:abc");
  });

  it("rejects an unknown playbook instead of falling back to a default", async () => {
    const result = await finalizeRuleReviewTool.execute(
      { playbook_id: "no-such-playbook" },
      ctxWith([]),
    );
    expect(result.ok).toBe(false);
    expect((result.data as { code: string }).code).toBe("unknown_playbook");
  });

  it("does not count a worker verdict for a rule outside the paper", async () => {
    const ownOnly = filterRulesForPaper(CN_SALES_RULES, "own");
    const counterpartyOnly = counterpartyRules[0].ruleId;
    const ownRule = ownOnly.find((r) => r.ruleId.endsWith(".own"))!;
    // A verdict for an own-paper rule must not satisfy a counterparty-paper plan.
    const result = await finalizeRuleReviewTool.execute(
      { playbook_id: "cn-sales-v0", paper: "counterparty" },
      ctxWith([
        { ruleId: ownRule.ruleId, kind: "compliant" },
        { ruleId: counterpartyOnly, kind: "compliant" },
      ]),
    );
    expect(result.ok).toBe(false);
    const data = result.data as { invalid: Array<{ reason: string }>; missingRuleIds: string[] };
    expect(data.invalid.some((i) => i.reason === "unplanned_rule_id")).toBe(true);
    expect(data.missingRuleIds).toHaveLength(counterpartyRules.length - 1);
  });

  it("is not a write tool (no file writes, no approval gate)", () => {
    expect(finalizeRuleReviewTool.definition.category).toBe("draft");
    expect(finalizeRuleReviewTool.definition.riskLevel).toBe("low");
  });
});

describe("collectRulePatchConflicts", () => {
  it("returns nothing for disjoint finds", () => {
    expect(
      collectRulePatchConflicts([
        { find: "三十日", replace: "六十日", ruleId: "a" },
        { find: "乙方", replace: "卖方", ruleId: "b" },
      ]),
    ).toEqual([]);
  });

  it("deduplicates identical replacements from different rules", () => {
    expect(
      collectRulePatchConflicts([
        { find: "三十日", replace: "六十日", ruleId: "a" },
        { find: "三十日", replace: "六十日", ruleId: "b" },
      ]),
    ).toEqual([]);
  });

  it("reports every distinct replacement, preserving rule ids", () => {
    const conflicts = collectRulePatchConflicts([
      { find: "三十日", replace: "六十日", ruleId: "a" },
      { find: "三十日", replace: "十五日", ruleId: "b" },
      { find: "三十日", replace: "九十日", ruleId: "c" },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.candidates).toHaveLength(3);
    expect(
      conflicts[0]?.candidates.map((c) => c.ruleId).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["a", "b", "c"]);
  });

  it("ignores blank find values", () => {
    expect(
      collectRulePatchConflicts([
        { find: "  ", replace: "六十日", ruleId: "a" },
        { find: "", replace: "十五日", ruleId: "b" },
      ]),
    ).toEqual([]);
  });
});
