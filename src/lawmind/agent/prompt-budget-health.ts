/**
 * Prompt-budget health rollup (P1-b / P1-c, 2026-10-26).
 *
 * `recordPromptBudgetEvent` writes one `kind=prompt_budget` row per turn: what
 * the session-tail packer kept, dropped, or truncated. This module answers the
 * question a maintainer actually asks afterwards — **"over the last N turns,
 * is the packer silently costing us skills or protocols?"** — with numbers and
 * a fixed alert line, instead of asking someone to read JSONL by hand.
 *
 * Threshold (P1-c, deliberately observational — it changes no packing rule):
 *   - any fragment dropped for budget is a warning;
 *   - a truncated `skill_index` / `protocol` body is a warning;
 *   - a peak fill ratio at or above 85% of the soft budget is a warning.
 *
 * P0 measured 12 baseline scenarios at 38%–53% fill with zero drops, so a
 * healthy workspace should stay quiet. The alert exists to catch the turn
 * shape the baseline did not cover, not to justify a required/budgeted split.
 */

import { readProductMetricEvents, type ProductMetricEvent } from "../metrics/product-metrics.js";

/** P1-c: warn when the packer runs this close to its soft budget. */
export const PROMPT_BUDGET_ALERT_FILL_RATIO = 0.85;

/**
 * Default scan window for surfaces that are polled (`/api/health`). Recent
 * turns are all the alert needs; reading the whole event history on every poll
 * would grow without bound.
 */
export const PROMPT_BUDGET_HEALTH_SCAN_LIMIT = 800;

export type PromptBudgetHealth = {
  /** Turns with a `prompt_budget` row in the scan window. */
  turns: number;
  /** Turns whose outcome was `degraded` (real loss). */
  degradedTurns: number;
  /** Turns where at least one fragment was dropped for budget. */
  droppedTurns: number;
  droppedFragmentTotal: number;
  /** Turns where a kind was dropped for budget → how many turns per kind. */
  droppedKindTurns: Record<string, number>;
  skillTruncatedTurns: number;
  protocolTruncatedTurns: number;
  /** Highest keptTokens / budgetTokens seen in the window. */
  peakFillRatio: number;
  peakFillKeptTokens: number;
  peakFillBudgetTokens: number;
  /** Mean fill ratio over turns with a usable budget. */
  averageFillRatio: number;
  windowFrom: string | null;
  windowTo: string | null;
  /** True when the event file is longer than the scan window. */
  truncatedWindow: boolean;
  status: "empty" | "ok" | "warn";
  /** Human-readable warning reasons; empty when the status is ok/empty. */
  reasons: string[];
};

function metaNumber(event: ProductMetricEvent, key: string): number | undefined {
  const value = event.meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metaList(event: ProductMetricEvent, key: string): string[] {
  const value = event.meta?.[key];
  return typeof value === "string" ? value.split(",").filter(Boolean) : [];
}

function ratio(kept: number, budget: number): number {
  return budget > 0 ? kept / budget : 0;
}

/**
 * Read the last `limit` product-metric events and summarize `prompt_budget`
 * rows. Pure read: never writes, never throws on a missing workspace.
 */
export function summarizePromptBudgetHealth(
  workspaceDir: string,
  opts?: { limit?: number },
): PromptBudgetHealth {
  const page = readProductMetricEvents(workspaceDir, opts?.limit ?? 5_000);
  const events = page.events.filter((event) => event.kind === "prompt_budget");
  const windowFrom = events[0]?.ts ?? null;
  const windowTo = events[events.length - 1]?.ts ?? null;

  let degradedTurns = 0;
  let droppedTurns = 0;
  let droppedFragmentTotal = 0;
  const droppedKindTurns: Record<string, number> = {};
  let skillTruncatedTurns = 0;
  let protocolTruncatedTurns = 0;
  let peakFillRatio = 0;
  let peakFillKeptTokens = 0;
  let peakFillBudgetTokens = 0;
  let fillSum = 0;
  let fillSamples = 0;

  for (const event of events) {
    if (event.outcome === "degraded") {
      degradedTurns += 1;
    }
    const dropped = metaNumber(event, "droppedCount") ?? 0;
    const droppedKinds = metaList(event, "droppedKinds");
    if (dropped > 0 || droppedKinds.length > 0) {
      droppedTurns += 1;
      droppedFragmentTotal += dropped;
      for (const kind of droppedKinds) {
        droppedKindTurns[kind] = (droppedKindTurns[kind] ?? 0) + 1;
      }
    }
    const truncatedKinds = metaList(event, "truncatedKinds");
    if (truncatedKinds.includes("skill_index")) {
      skillTruncatedTurns += 1;
    }
    if (truncatedKinds.includes("protocol")) {
      protocolTruncatedTurns += 1;
    }
    const budget = metaNumber(event, "budgetTokens") ?? 0;
    const kept = metaNumber(event, "keptTokens") ?? 0;
    if (budget > 0) {
      const fill = ratio(kept, budget);
      fillSum += fill;
      fillSamples += 1;
      if (fill > peakFillRatio) {
        peakFillRatio = fill;
        peakFillKeptTokens = kept;
        peakFillBudgetTokens = budget;
      }
    }
  }

  const turns = events.length;
  if (turns === 0) {
    return {
      turns: 0,
      degradedTurns: 0,
      droppedTurns: 0,
      droppedFragmentTotal: 0,
      droppedKindTurns: {},
      skillTruncatedTurns: 0,
      protocolTruncatedTurns: 0,
      peakFillRatio: 0,
      peakFillKeptTokens: 0,
      peakFillBudgetTokens: 0,
      averageFillRatio: 0,
      windowFrom,
      windowTo,
      truncatedWindow: page.truncated,
      status: "empty",
      reasons: [],
    };
  }

  const reasons: string[] = [];
  if (droppedTurns > 0) {
    const kinds = Object.entries(droppedKindTurns)
      .map(([kind, count]) => `${kind}×${count}`)
      .join("、");
    reasons.push(
      `${droppedTurns} 回合有片段被预算丢弃（共 ${droppedFragmentTotal} 个${kinds ? `：${kinds}` : ""}）`,
    );
  }
  if (skillTruncatedTurns > 0) {
    reasons.push(`技能正文被截断 ${skillTruncatedTurns} 回合`);
  }
  if (protocolTruncatedTurns > 0) {
    reasons.push(`协议被截断 ${protocolTruncatedTurns} 回合`);
  }
  if (peakFillRatio >= PROMPT_BUDGET_ALERT_FILL_RATIO) {
    reasons.push(
      `打包水位峰值 ${Math.round(peakFillRatio * 100)}%（${peakFillKeptTokens}/${peakFillBudgetTokens}，阈值 ${Math.round(
        PROMPT_BUDGET_ALERT_FILL_RATIO * 100,
      )}%）`,
    );
  }

  return {
    turns,
    degradedTurns,
    droppedTurns,
    droppedFragmentTotal,
    droppedKindTurns,
    skillTruncatedTurns,
    protocolTruncatedTurns,
    peakFillRatio,
    peakFillKeptTokens,
    peakFillBudgetTokens,
    averageFillRatio: fillSamples > 0 ? fillSum / fillSamples : 0,
    windowFrom,
    windowTo,
    truncatedWindow: page.truncated,
    status: reasons.length > 0 ? "warn" : "ok",
    reasons,
  };
}

/** One doctor line. Chinese, lawyer-facing, and honest when there is no data. */
export function formatPromptBudgetHealthLine(health: PromptBudgetHealth): string {
  if (health.status === "empty") {
    return "提示词预算：还没有可统计的回合；对话几轮后这里会显示水位与丢失统计。";
  }
  const fill = `${Math.round(health.averageFillRatio * 100)}%（峰值 ${Math.round(
    health.peakFillRatio * 100,
  )}%）`;
  const windowBit = health.truncatedWindow ? "最近窗口" : "全部";
  if (health.status === "ok") {
    const fillBit =
      health.peakFillBudgetTokens > 0 ? `水位均值 ${fill}` : "这一窗口没有可用的水位样本";
    return `提示词预算：${windowBit} ${health.turns} 回合无技能/协议丢失，${fillBit}。`;
  }
  return (
    `提示词预算：${windowBit} ${health.turns} 回合有告警 — ` +
    `${health.reasons.join("；")}。逐片段明细运行 pnpm lawmind:prompt-budget。`
  );
}
