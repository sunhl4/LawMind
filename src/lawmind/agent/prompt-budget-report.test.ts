import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { productMetricsPath } from "../metrics/product-metrics.js";
import {
  buildPromptBudgetReport,
  formatPromptBudgetReport,
  recordPromptBudgetEvent,
} from "./prompt-budget-report.js";
import type { PromptFragment } from "./prompt-fragments.js";

function fragment(
  overrides: Partial<PromptFragment> & Pick<PromptFragment, "kind" | "body">,
): PromptFragment {
  return {
    placement: "session_tail",
    priority: 55,
    capTokens: 2_000,
    overflow: null,
    ...overrides,
  };
}

describe("prompt-budget-report", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-budget-report-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("reports kept and dropped fragments with token totals", () => {
    const skill = fragment({
      kind: "skill_index",
      priority: 70,
      body: "# 本轮 LawMind 能力：合同审查\n\n合同分层审查。",
    });
    const protocol = fragment({
      kind: "protocol",
      priority: 55,
      body: "# 检索协议\n\n先查现行有效规范。",
    });
    const report = buildPromptBudgetReport({
      fragments: [skill, protocol],
      packed: [skill],
      budgetTokens: 12_000,
      windowScale: 1,
    });

    expect(report.keptCount).toBe(1);
    expect(report.droppedCount).toBe(1);
    expect(report.keptTokens).toBeGreaterThan(0);
    expect(report.totalTokens).toBe(report.keptTokens + report.droppedTokens);
    expect(report.droppedKinds).toEqual(["protocol"]);
    expect(report.droppedLabels[0]).toContain("检索协议");
    expect(report.fragments[0]).toMatchObject({
      kind: "skill_index",
      kept: true,
      truncated: false,
      label: "本轮 LawMind 能力：合同审查",
    });
    expect(report.fragments[1]).toMatchObject({ kind: "protocol", kept: false });
  });

  it("flags truncation pointers instead of hiding them", () => {
    const halfSkill = fragment({
      kind: "skill_index",
      body: "# 本轮 LawMind 能力：合同审查\n\n前半句…[截断，完整内容请用 read_skill 读取 skills]",
    });
    const report = buildPromptBudgetReport({
      fragments: [halfSkill],
      packed: [halfSkill],
      budgetTokens: 12_000,
    });
    expect(report.fragments[0]?.truncated).toBe(true);
    expect(report.truncatedKinds).toEqual(["skill_index"]);
    expect(formatPromptBudgetReport(report)).toContain("truncated: skill_index");
  });

  it("writes a metric row with names and numbers, never fragment bodies", () => {
    const secret = "律师秘密：甲方同意在 2026-11-01 前支付 300 万元。";
    const report = buildPromptBudgetReport({
      fragments: [
        fragment({ kind: "skill_index", body: "# 能力\n\n规则" }),
        fragment({ kind: "protocol", body: `# 检索协议\n\n${secret}` }),
      ],
      packed: [],
      budgetTokens: 100,
    });
    recordPromptBudgetEvent(workspaceDir, report, { matterId: "m1" });

    const lines = fs.readFileSync(productMetricsPath(workspaceDir), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("300 万元");
    const event = JSON.parse(lines[0]) as {
      kind: string;
      outcome: string;
      matterId?: string;
      meta: Record<string, string | number>;
    };
    expect(event.kind).toBe("prompt_budget");
    expect(event.outcome).toBe("degraded");
    expect(event.matterId).toBe("m1");
    expect(event.meta.droppedKinds).toBe("skill_index,protocol");
    expect(event.meta.keptTokens).toBe(0);
    expect(event.meta.budgetTokens).toBe(100);
  });
});
