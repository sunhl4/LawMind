/**
 * Per-assistant growth metrics (lifetime specialization + windowed product events).
 */

import fs from "node:fs";
import { listPendingMemorySuggestions } from "../memory/adoption-service.js";
import { productMetricsPath, type ProductMetricEvent } from "../metrics/product-metrics.js";
import {
  firstPassRate,
  loadAgentSpecializationStore,
  type AgentSpecializationStats,
} from "./agent-specialization.js";
import {
  avgAbsCharDelta,
  avgAbsParagraphDelta,
  loadRewriteAmplitudeStore,
} from "./rewrite-amplitude.js";

export type AssistantGrowthRates = {
  tasksReviewed: number;
  firstPassApprovals: number;
  materialRewrites: number;
  firstPassRate: number;
  rewriteRate: number;
};

export type AssistantRewriteAmplitudeView = {
  samples: number;
  avgAbsCharDelta: number;
  avgAbsParagraphDelta: number;
  lastAbsCharDelta: number;
};

export type AssistantGrowthRow = {
  assistantId: string;
  roleId?: string;
  lifetime: AssistantGrowthRates;
  window: AssistantGrowthRates;
  pendingAdoptions: number;
  lastUpdatedAt?: string;
  /** T1.4 改写幅度（累计样本均值；辅助指标） */
  rewriteAmplitude?: AssistantRewriteAmplitudeView;
};

export type AssistantGrowthReport = {
  windowDays: number;
  assistants: AssistantGrowthRow[];
};

function emptyRates(): AssistantGrowthRates {
  return {
    tasksReviewed: 0,
    firstPassApprovals: 0,
    materialRewrites: 0,
    firstPassRate: 0,
    rewriteRate: 0,
  };
}

function ratesFromCounts(firstPass: number, rewrite: number): AssistantGrowthRates {
  const tasksReviewed = firstPass + rewrite;
  return {
    tasksReviewed,
    firstPassApprovals: firstPass,
    materialRewrites: rewrite,
    firstPassRate: tasksReviewed > 0 ? firstPass / tasksReviewed : 0,
    rewriteRate: tasksReviewed > 0 ? rewrite / tasksReviewed : 0,
  };
}

function lifetimeFromStats(stats: AgentSpecializationStats): AssistantGrowthRates {
  const tasksReviewed = stats.tasksReviewed;
  return {
    tasksReviewed,
    firstPassApprovals: stats.firstPassApprovals,
    materialRewrites: stats.materialRewrites,
    firstPassRate: firstPassRate(stats),
    rewriteRate: tasksReviewed > 0 ? stats.materialRewrites / tasksReviewed : 0,
  };
}

function assistantIdFromEvent(ev: ProductMetricEvent): string | undefined {
  const meta = ev.meta;
  if (!meta) {
    return undefined;
  }
  const raw = meta.assistantId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function readProductMetricEvents(
  workspaceDir: string,
  opts?: { limit?: number; sinceMs?: number },
): ProductMetricEvent[] {
  const file = productMetricsPath(workspaceDir);
  if (!fs.existsSync(file)) {
    return [];
  }
  const limit = opts?.limit ?? 8000;
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-limit);
  const sinceMs = opts?.sinceMs;
  const out: ProductMetricEvent[] = [];
  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as ProductMetricEvent;
      if (sinceMs != null) {
        const t = Date.parse(ev.ts);
        if (!Number.isFinite(t) || t < sinceMs) {
          continue;
        }
      }
      out.push(ev);
    } catch {
      /* skip */
    }
  }
  return out;
}

function windowRatesFromEvents(
  events: ProductMetricEvent[],
  assistantId: string,
): AssistantGrowthRates {
  let firstPass = 0;
  let rewrite = 0;
  for (const ev of events) {
    if (assistantIdFromEvent(ev) !== assistantId) {
      continue;
    }
    if (ev.kind === "first_pass" && ev.outcome === "ok") {
      firstPass += 1;
    } else if (ev.kind === "rewrite") {
      rewrite += 1;
    } else if (ev.kind === "first_pass" && ev.outcome === "fail") {
      rewrite += 1;
    }
  }
  return ratesFromCounts(firstPass, rewrite);
}

/**
 * Build growth report for all assistants seen in specialization store and/or window events.
 */
export async function buildAssistantGrowthReport(
  workspaceDir: string,
  opts?: { windowDays?: number },
): Promise<AssistantGrowthReport> {
  const windowDays = Math.max(1, Math.min(365, opts?.windowDays ?? 30));
  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const store = loadAgentSpecializationStore(workspaceDir);
  const amplitudeStore = loadRewriteAmplitudeStore(workspaceDir);
  const events = readProductMetricEvents(workspaceDir, { sinceMs });
  const pending = await listPendingMemorySuggestions(workspaceDir);

  const ids = new Set<string>(Object.keys(store.byAssistant));
  for (const ev of events) {
    const id = assistantIdFromEvent(ev);
    if (id) {
      ids.add(id);
    }
  }
  for (const id of Object.keys(amplitudeStore.byAssistant)) {
    ids.add(id);
  }

  const assistants: AssistantGrowthRow[] = [...ids]
    .toSorted((a, b) => a.localeCompare(b))
    .map((assistantId) => {
      const stats = store.byAssistant[assistantId];
      const amp = amplitudeStore.byAssistant[assistantId];
      const pendingAdoptions = pending.filter(
        (r) => r.scope === "assistant" && r.targetId === assistantId,
      ).length;
      return {
        assistantId,
        roleId: stats?.roleId,
        lifetime: stats ? lifetimeFromStats(stats) : emptyRates(),
        window: windowRatesFromEvents(events, assistantId),
        pendingAdoptions,
        lastUpdatedAt: stats?.lastUpdatedAt ?? amp?.lastUpdatedAt,
        rewriteAmplitude: amp
          ? {
              samples: amp.samples,
              avgAbsCharDelta: Math.round(avgAbsCharDelta(amp)),
              avgAbsParagraphDelta: Math.round(avgAbsParagraphDelta(amp) * 10) / 10,
              lastAbsCharDelta: amp.lastAbsCharDelta,
            }
          : undefined,
      };
    });

  return { windowDays, assistants };
}
