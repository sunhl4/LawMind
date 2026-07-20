/**
 * Local model token usage ledger (agentsview-style, workspace-local only).
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { classifyModelWorkTier, modelWorkTierLabel, type ModelWorkTier } from "./model-tier.js";

export type ModelUsageSnapshot = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

const entrySchema = z.object({
  id: z.string(),
  recordedAt: z.string(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  matterId: z.string().optional(),
  model: z.string().optional(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export type ModelUsageLedgerEntry = z.infer<typeof entrySchema>;

export type ModelUsageSummary = {
  entries: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** ISO date of oldest included row */
  since?: string;
  /** ISO date of newest included row */
  until?: string;
  byModel?: Array<{ model: string; entries: number; totalTokens: number }>;
  /** Heuristic Worker / Advisor / 通用 buckets (not billing). */
  byTier?: Array<{
    tier: ModelWorkTier;
    label: string;
    entries: number;
    totalTokens: number;
  }>;
};

function ledgerPath(workspaceDir: string): string {
  return path.join(workspaceDir, "model-usage", "ledger.jsonl");
}

function readLedger(workspaceDir: string): ModelUsageLedgerEntry[] {
  const file = ledgerPath(workspaceDir);
  if (!existsSync(file)) {
    return [];
  }
  const raw = readFileSync(file, "utf8");
  const out: ModelUsageLedgerEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = entrySchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) {
        out.push(parsed.data);
      }
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

export function recordModelUsage(
  workspaceDir: string,
  row: Omit<ModelUsageLedgerEntry, "id" | "recordedAt"> & { id?: string; recordedAt?: string },
): ModelUsageLedgerEntry {
  const file = ledgerPath(workspaceDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const entry: ModelUsageLedgerEntry = {
    id: row.id ?? `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    recordedAt: row.recordedAt ?? new Date().toISOString(),
    sessionId: row.sessionId,
    turnId: row.turnId,
    matterId: row.matterId,
    model: row.model,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
  };
  appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export function summarizeModelUsage(
  workspaceDir: string,
  opts?: { sinceDays?: number; matterId?: string },
): ModelUsageSummary {
  const sinceDays = opts?.sinceDays ?? 30;
  const cutoff =
    sinceDays > 0
      ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
  const matterFilter = opts?.matterId?.trim();

  let entries = readLedger(workspaceDir);
  if (cutoff) {
    entries = entries.filter((e) => e.recordedAt >= cutoff);
  }
  if (matterFilter) {
    entries = entries.filter((e) => e.matterId === matterFilter);
  }

  const summary: ModelUsageSummary = {
    entries: entries.length,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  const byModelMap = new Map<string, { entries: number; totalTokens: number }>();
  const byTierMap = new Map<ModelWorkTier, { entries: number; totalTokens: number }>();
  for (const e of entries) {
    summary.promptTokens += e.promptTokens;
    summary.completionTokens += e.completionTokens;
    summary.totalTokens += e.totalTokens;
    const model = e.model?.trim() || "unknown";
    const row = byModelMap.get(model) ?? { entries: 0, totalTokens: 0 };
    row.entries += 1;
    row.totalTokens += e.totalTokens;
    byModelMap.set(model, row);
    const tier = classifyModelWorkTier(model);
    const tierRow = byTierMap.get(tier) ?? { entries: 0, totalTokens: 0 };
    tierRow.entries += 1;
    tierRow.totalTokens += e.totalTokens;
    byTierMap.set(tier, tierRow);
  }
  if (entries.length > 0) {
    const sorted = [...entries].toSorted((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    summary.since = sorted[0]?.recordedAt;
    summary.until = sorted[sorted.length - 1]?.recordedAt;
    summary.byModel = [...byModelMap.entries()]
      .map(([model, row]) => ({ model, entries: row.entries, totalTokens: row.totalTokens }))
      .toSorted((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 8);
    const tierOrder: ModelWorkTier[] = ["advisor", "worker", "general"];
    summary.byTier = tierOrder
      .filter((tier) => byTierMap.has(tier))
      .map((tier) => {
        const row = byTierMap.get(tier)!;
        return {
          tier,
          label: modelWorkTierLabel(tier),
          entries: row.entries,
          totalTokens: row.totalTokens,
        };
      });
  }
  return summary;
}

export function mergeUsageSnapshots(
  a: ModelUsageSnapshot | undefined,
  b: ModelUsageSnapshot | undefined,
): ModelUsageSnapshot | undefined {
  if (!a && !b) {
    return undefined;
  }
  const promptTokens = (a?.promptTokens ?? 0) + (b?.promptTokens ?? 0);
  const completionTokens = (a?.completionTokens ?? 0) + (b?.completionTokens ?? 0);
  const totalTokens = (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0);
  return { promptTokens, completionTokens, totalTokens };
}

export function usageFromProvider(
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null,
): ModelUsageSnapshot | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
  if (totalTokens <= 0 && promptTokens <= 0 && completionTokens <= 0) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}
