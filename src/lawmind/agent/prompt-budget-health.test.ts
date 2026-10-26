/**
 * P1-b / P1-c: prompt-budget health rollup over real product-metric rows.
 *
 * These are request-body facts only — token counts, keep/drop/truncate
 * decisions, and the alert threshold. No model scoring, no prompt sentences.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendProductMetric } from "../metrics/product-metrics.js";
import {
  PROMPT_BUDGET_ALERT_FILL_RATIO,
  formatPromptBudgetHealthLine,
  summarizePromptBudgetHealth,
} from "./prompt-budget-health.js";

function recordTurn(
  workspaceDir: string,
  opts: {
    keptTokens: number;
    budgetTokens?: number;
    droppedCount?: number;
    droppedKinds?: string;
    truncatedKinds?: string;
    outcome?: "complete" | "degraded";
  },
): void {
  appendProductMetric(workspaceDir, {
    kind: "prompt_budget",
    outcome: opts.outcome ?? "complete",
    meta: {
      budgetTokens: opts.budgetTokens ?? 12_000,
      windowScale: 1,
      fragmentCount: 13,
      keptCount: 13 - (opts.droppedCount ?? 0),
      droppedCount: opts.droppedCount ?? 0,
      collapsedCount: 0,
      totalTokens: opts.keptTokens,
      keptTokens: opts.keptTokens,
      droppedTokens: 0,
      collapsedTokens: 0,
      droppedKinds: opts.droppedKinds ?? "",
      droppedLabels: "",
      collapsedKinds: "",
      truncatedKinds: opts.truncatedKinds ?? "",
    },
  });
}

describe("prompt-budget health (P1-b/P1-c)", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-prompt-health-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("says there is no data instead of inventing a healthy score", () => {
    const health = summarizePromptBudgetHealth(workspaceDir);
    expect(health.status).toBe("empty");
    expect(health.turns).toBe(0);
    expect(formatPromptBudgetHealthLine(health)).toContain("还没有可统计的回合");
  });

  it("reports fill level for turns that lost nothing", () => {
    recordTurn(workspaceDir, { keptTokens: 4_500 });
    recordTurn(workspaceDir, { keptTokens: 6_000 });

    const health = summarizePromptBudgetHealth(workspaceDir);
    expect(health.status).toBe("ok");
    expect(health.turns).toBe(2);
    expect(health.degradedTurns).toBe(0);
    expect(health.peakFillRatio).toBeCloseTo(0.5, 5);
    expect(health.peakFillKeptTokens).toBe(6_000);
    expect(health.averageFillRatio).toBeCloseTo(0.4375, 5);
    expect(health.reasons).toEqual([]);
    const line = formatPromptBudgetHealthLine(health);
    expect(line).toContain("2 回合无技能/协议丢失");
    expect(line).toContain("峰值 50%");
  });

  it("warns on a real loss and names the dropped kinds", () => {
    recordTurn(workspaceDir, { keptTokens: 12_000 });
    recordTurn(workspaceDir, {
      keptTokens: 11_800,
      droppedCount: 2,
      droppedKinds: "protocol,skill_index",
      truncatedKinds: "skill_index",
      outcome: "degraded",
    });

    const health = summarizePromptBudgetHealth(workspaceDir);
    expect(health.status).toBe("warn");
    expect(health.degradedTurns).toBe(1);
    expect(health.droppedTurns).toBe(1);
    expect(health.droppedFragmentTotal).toBe(2);
    expect(health.droppedKindTurns).toEqual({ protocol: 1, skill_index: 1 });
    expect(health.skillTruncatedTurns).toBe(1);
    expect(health.protocolTruncatedTurns).toBe(0);
    expect(health.reasons.join("\n")).toContain("protocol×1");
    expect(health.reasons.join("\n")).toContain("技能正文被截断");
    const line = formatPromptBudgetHealthLine(health);
    expect(line).toContain("有告警");
    expect(line).toContain("pnpm lawmind:prompt-budget");
  });

  it("warns at the fill threshold even when nothing was dropped", () => {
    recordTurn(workspaceDir, { keptTokens: Math.ceil(12_000 * PROMPT_BUDGET_ALERT_FILL_RATIO) });
    const health = summarizePromptBudgetHealth(workspaceDir);
    expect(health.status).toBe("warn");
    expect(health.reasons.join("\n")).toContain("阈值 85%");
  });

  it("ignores other product-metric kinds", () => {
    appendProductMetric(workspaceDir, { kind: "first_pass", outcome: "ok" });
    appendProductMetric(workspaceDir, { kind: "prompt_budget", outcome: "complete", meta: {} });
    const health = summarizePromptBudgetHealth(workspaceDir);
    expect(health.turns).toBe(1);
    expect(health.peakFillRatio).toBe(0);
    // No budget sample → do not print a fake 0% watermark.
    expect(formatPromptBudgetHealthLine(health)).toContain("没有可用的水位样本");
  });
});
