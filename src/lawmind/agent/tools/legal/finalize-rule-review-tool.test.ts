import { afterEach, describe, expect, it } from "vitest";
import { CN_SALES_RULES } from "../../../review/playbooks/cn-sales.js";
import { filterRulesForPaper } from "../../../review/rules.js";
import { emptyFactorState, ingestToolResult } from "../../factor-state.js";
import type { AgentTool } from "../../types.js";
import {
  FINALIZE_RULE_REVIEW_TOOL_NAME,
  finalizeRuleReviewTool,
} from "./finalize-rule-review-tool.js";

type Ctx = Parameters<AgentTool["execute"]>[1];

function ctxWith(records: Array<{ ruleId: string; kind: string }>, workspaceDir = "/tmp/lm-final") {
  const factorState = emptyFactorState();
  for (const record of records) {
    ingestToolResult(factorState, "draft_worker", {
      ruleId: record.ruleId,
      classification: { kind: record.kind, rationale: "测试" },
    });
  }
  return { factorState, workspaceDir } as unknown as Ctx;
}

const counterpartyRules = filterRulesForPaper(CN_SALES_RULES, "counterparty");

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
    const data = result.data as { coverageComplete: boolean; ruleCount: number };
    expect(data.coverageComplete).toBe(true);
    expect(data.ruleCount).toBe(counterpartyRules.length);
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
