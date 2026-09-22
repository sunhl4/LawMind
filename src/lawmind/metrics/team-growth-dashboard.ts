/**
 * Team-growth internal metrics dashboard (Wave A–D DoD「内测指标表」).
 * Snapshot current rates vs optional frozen baseline.
 */

import fs from "node:fs";
import path from "node:path";
import { readRecentAuditLogs } from "../audit/index.js";
import { buildAssistantGrowthReport } from "../learning/assistant-growth.js";
import { listMemorySuggestions } from "../memory/adoption-service.js";

export type TeamGrowthMetricId =
  | "first_pass_rate"
  | "rewrite_rate"
  | "learning_process_rate"
  | "routing_hit_rate"
  | "peer_review_coverage";

export type TeamGrowthMetricRow = {
  id: TeamGrowthMetricId;
  label: string;
  /** 0–1 rate; null = insufficient samples */
  value: number | null;
  numerator: number;
  denominator: number;
  targetNote: string;
  baselineValue: number | null;
  /** percentage points vs baseline (value - baseline) * 100 */
  deltaPts: number | null;
};

export type TeamGrowthAssistantSlice = {
  assistantId: string;
  roleId?: string;
  tasksReviewed: number;
  firstPassRate: number;
  rewriteRate: number;
  windowFirstPassRate: number;
  windowTasksReviewed: number;
};

export type TeamGrowthBaselineFile = {
  version: 1;
  capturedAt: string;
  windowDays: number;
  note?: string;
  metrics: Array<{ id: TeamGrowthMetricId; value: number | null }>;
};

export type TeamGrowthDashboard = {
  capturedAt: string;
  windowDays: number;
  metrics: TeamGrowthMetricRow[];
  assistants: TeamGrowthAssistantSlice[];
  baseline: { capturedAt: string; note?: string; windowDays: number } | null;
};

const TARGETS: Record<TeamGrowthMetricId, { label: string; targetNote: string }> = {
  first_pass_rate: {
    label: "主力一次过率",
    targetNote: "相对基线 ↑ ≥10pt",
  },
  rewrite_rate: {
    label: "改写率",
    targetNote: "相对基线 ↓",
  },
  learning_process_rate: {
    label: "学习处理率",
    targetNote: "≥40% 被采纳或驳回",
  },
  routing_hit_rate: {
    label: "默认路由命中",
    targetNote: "≥60%（有 defaults 且未回退）",
  },
  peer_review_coverage: {
    label: "互审闸覆盖",
    targetNote: "Firm：触发 / (触发+跳过)",
  },
};

function baselinePath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "metrics", "team-growth-baseline.json");
}

export function loadTeamGrowthBaseline(workspaceDir: string): TeamGrowthBaselineFile | null {
  const p = baselinePath(workspaceDir);
  try {
    if (!fs.existsSync(p)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as TeamGrowthBaselineFile;
    if (raw?.version !== 1 || !Array.isArray(raw.metrics)) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function saveTeamGrowthBaseline(
  workspaceDir: string,
  input: {
    windowDays: number;
    metrics: TeamGrowthMetricRow[];
    note?: string;
  },
): TeamGrowthBaselineFile {
  const next: TeamGrowthBaselineFile = {
    version: 1,
    capturedAt: new Date().toISOString(),
    windowDays: input.windowDays,
    note: input.note?.trim() || undefined,
    metrics: input.metrics.map((m) => ({ id: m.id, value: m.value })),
  };
  const p = baselinePath(workspaceDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function rate(n: number, d: number): number | null {
  if (d <= 0) {
    return null;
  }
  return n / d;
}

function withBaseline(
  id: TeamGrowthMetricId,
  value: number | null,
  numerator: number,
  denominator: number,
  baselineMap: Map<TeamGrowthMetricId, number | null>,
): TeamGrowthMetricRow {
  const baselineValue = baselineMap.has(id) ? (baselineMap.get(id) ?? null) : null;
  let deltaPts: number | null = null;
  if (value != null && baselineValue != null) {
    deltaPts = Math.round((value - baselineValue) * 1000) / 10;
  }
  return {
    id,
    label: TARGETS[id].label,
    value,
    numerator,
    denominator,
    targetNote: TARGETS[id].targetNote,
    baselineValue,
    deltaPts,
  };
}

/**
 * Build dashboard for windowDays (growth window + recent audit scan).
 */
export async function buildTeamGrowthDashboard(
  workspaceDir: string,
  opts?: { windowDays?: number },
): Promise<TeamGrowthDashboard> {
  const windowDays = Math.max(1, Math.min(365, opts?.windowDays ?? 30));
  const growth = await buildAssistantGrowthReport(workspaceDir, { windowDays });
  const baseline = loadTeamGrowthBaseline(workspaceDir);
  const baselineMap = new Map<TeamGrowthMetricId, number | null>();
  for (const m of baseline?.metrics ?? []) {
    baselineMap.set(m.id, m.value);
  }

  let firstPass = 0;
  let rewrite = 0;
  for (const a of growth.assistants) {
    firstPass += a.window.firstPassApprovals;
    rewrite += a.window.materialRewrites;
  }
  const reviewed = firstPass + rewrite;

  const suggestions = await listMemorySuggestions(workspaceDir);
  // Lawyer-facing queue only (exclude engine auto_adopted).
  const lawyerFacing = suggestions.filter((s) => s.state !== "auto_adopted");
  const pending = lawyerFacing.filter((s) => s.state === "pending").length;
  const adopted = lawyerFacing.filter((s) => s.state === "adopted").length;
  const dismissed = lawyerFacing.filter((s) => s.state === "dismissed").length;
  const processed = adopted + dismissed;
  const learnDenom = pending + processed;

  const auditDir = path.join(workspaceDir, "audit");
  const events = await readRecentAuditLogs(auditDir, {
    maxDays: windowDays + 2,
    maxEvents: 12_000,
  });
  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const recent = events.filter((e) => {
    const t = Date.parse(e.timestamp);
    return Number.isFinite(t) && t >= sinceMs;
  });

  let routingOk = 0;
  let routingMiss = 0;
  let peerRequired = 0;
  let peerSkipped = 0;
  for (const e of recent) {
    if (e.kind === "routing.resolve_ok") {
      routingOk += 1;
    } else if (e.kind === "routing.resolve_fallback" || e.kind === "routing.resolve_failed") {
      routingMiss += 1;
    } else if (e.kind === "draft.peer_review_required") {
      peerRequired += 1;
    } else if (e.kind === "draft.peer_review_skipped") {
      peerSkipped += 1;
    }
  }

  const metrics: TeamGrowthMetricRow[] = [
    withBaseline("first_pass_rate", rate(firstPass, reviewed), firstPass, reviewed, baselineMap),
    withBaseline("rewrite_rate", rate(rewrite, reviewed), rewrite, reviewed, baselineMap),
    withBaseline(
      "learning_process_rate",
      rate(processed, learnDenom),
      processed,
      learnDenom,
      baselineMap,
    ),
    withBaseline(
      "routing_hit_rate",
      rate(routingOk, routingOk + routingMiss),
      routingOk,
      routingOk + routingMiss,
      baselineMap,
    ),
    withBaseline(
      "peer_review_coverage",
      rate(peerRequired, peerRequired + peerSkipped),
      peerRequired,
      peerRequired + peerSkipped,
      baselineMap,
    ),
  ];

  const assistants: TeamGrowthAssistantSlice[] = growth.assistants
    .filter((a) => a.lifetime.tasksReviewed > 0 || a.window.tasksReviewed > 0)
    .map((a) => ({
      assistantId: a.assistantId,
      roleId: a.roleId,
      tasksReviewed: a.lifetime.tasksReviewed,
      firstPassRate: a.lifetime.firstPassRate,
      rewriteRate: a.lifetime.rewriteRate,
      windowFirstPassRate: a.window.firstPassRate,
      windowTasksReviewed: a.window.tasksReviewed,
    }));

  return {
    capturedAt: new Date().toISOString(),
    windowDays,
    metrics,
    assistants,
    baseline: baseline
      ? {
          capturedAt: baseline.capturedAt,
          note: baseline.note,
          windowDays: baseline.windowDays,
        }
      : null,
  };
}

export async function captureTeamGrowthBaseline(
  workspaceDir: string,
  opts?: { windowDays?: number; note?: string },
): Promise<{ dashboard: TeamGrowthDashboard; baseline: TeamGrowthBaselineFile }> {
  const dashboard = await buildTeamGrowthDashboard(workspaceDir, {
    windowDays: opts?.windowDays,
  });
  const baseline = saveTeamGrowthBaseline(workspaceDir, {
    windowDays: dashboard.windowDays,
    metrics: dashboard.metrics,
    note: opts?.note,
  });
  const refreshed = await buildTeamGrowthDashboard(workspaceDir, {
    windowDays: dashboard.windowDays,
  });
  return { dashboard: refreshed, baseline };
}
