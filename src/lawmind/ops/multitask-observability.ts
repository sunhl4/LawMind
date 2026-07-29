/**
 * Multitask observability metrics (jobs + collaboration-audit window).
 * Shared by CLI script and Doctor / health payload.
 */

import fs from "node:fs";
import path from "node:path";
import { readCollaborationEvents } from "../agent/collaboration/audit.js";

export type MultitaskJobLike = {
  status?: string;
  createdAt?: string;
  completedAt?: string;
  updatedAt?: string;
  retryCount?: number;
  retries?: number;
  attempt?: number;
  attempts?: number;
};

export type MultitaskObservabilityReport = {
  reportType: "multitask-observability";
  runAt: string;
  workspaceDir: string;
  windowDays: number;
  sample: {
    jobsTotal: number;
    jobsInWindow: number;
    collaborationEvents: number;
    malformedEventLines: number;
  };
  metrics: {
    leadTimeP50Ms: number | null;
    leadTimeP90Ms: number | null;
    retryRate: number;
    cancelRate: number;
    failureRate: number;
    conflictRate: number;
    firstPassRate: number | null;
  };
  notes: string[];
};

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dir, entry.name));
}

function parseIsoMs(value?: string): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function toRate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

function loadCollaborationEvents(workspaceDir: string): {
  events: Array<{ timestampMs: number; line: string }>;
  malformed: number;
} {
  const parsed = readCollaborationEvents(workspaceDir);
  return {
    events: parsed.map((e) => ({
      timestampMs: parseIsoMs(e.timestamp) ?? 0,
      line: JSON.stringify(e),
    })),
    malformed: 0,
  };
}

function computeFirstPassRate(distDir: string | undefined): number | null {
  if (!distDir || !fs.existsSync(distDir)) {
    return null;
  }
  const reportFiles = fs
    .readdirSync(distDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.startsWith("report-") && entry.name.endsWith(".json"),
    )
    .map((entry) => path.join(distDir, entry.name));
  if (reportFiles.length === 0) {
    return null;
  }
  let pass = 0;
  let total = 0;
  for (const file of reportFiles) {
    const report = readJsonFile<{ summary?: { requiredFailed?: number; releaseReady?: boolean } }>(
      file,
    );
    if (!report?.summary) {
      continue;
    }
    total += 1;
    if (report.summary.requiredFailed === 0 && report.summary.releaseReady === true) {
      pass += 1;
    }
  }
  if (total === 0) {
    return null;
  }
  return toRate(pass, total);
}

export function buildMultitaskObservabilityReport(opts: {
  workspaceDir: string;
  windowDays?: number;
  /** Optional dist dir for firstPassRate from validation reports */
  validationDistDir?: string;
}): MultitaskObservabilityReport {
  const windowDays = opts.windowDays ?? 14;
  const workspaceDir = opts.workspaceDir;
  const jobsDir = path.join(workspaceDir, "lawmind", "jobs");
  const jobFiles = listJsonFiles(jobsDir);
  const jobs = jobFiles
    .map((jobPath) => readJsonFile<MultitaskJobLike>(jobPath))
    .filter((job): job is MultitaskJobLike => job !== null);

  const now = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const windowStart = now - windowMs;

  const inWindowJobs = jobs.filter((job) => {
    const ts = parseIsoMs(job.createdAt ?? job.updatedAt);
    return ts !== null && ts >= windowStart;
  });
  const terminalStatuses = new Set([
    "completed",
    "failed",
    "cancelled",
    "canceled",
    "interrupted_by_restart",
  ]);
  const leadTimes = inWindowJobs
    .filter((job) => terminalStatuses.has(String(job.status ?? "").toLowerCase()))
    .map((job) => {
      const created = parseIsoMs(job.createdAt);
      const completed = parseIsoMs(job.completedAt ?? job.updatedAt);
      if (created === null || completed === null || completed < created) {
        return null;
      }
      return completed - created;
    })
    .filter((v): v is number => v !== null)
    .toSorted((a, b) => a - b);

  const retried = inWindowJobs.filter((job) => {
    const retryCount =
      job.retryCount ??
      job.retries ??
      (typeof job.attempts === "number" ? Math.max(0, job.attempts - 1) : undefined) ??
      (typeof job.attempt === "number" ? Math.max(0, job.attempt - 1) : 0);
    return Number(retryCount) > 0;
  }).length;

  const cancelled = inWindowJobs.filter((job) => {
    const status = String(job.status ?? "").toLowerCase();
    return status === "cancelled" || status === "canceled";
  }).length;
  const failed = inWindowJobs.filter((job) => {
    const status = String(job.status ?? "").toLowerCase();
    return status === "failed" || status === "error" || status === "interrupted_by_restart";
  }).length;

  const eventData = loadCollaborationEvents(workspaceDir);
  const eventsInWindow = eventData.events.filter((event) => event.timestampMs >= windowStart);
  const conflictEvents = eventsInWindow.filter((event) => /conflict|冲突/i.test(event.line)).length;

  const notes: string[] = [];
  if (inWindowJobs.length === 0) {
    notes.push("窗口内无 jobs 数据，leadTime/retry/cancel/failure 指标仅用于口径验证。");
  }
  if (eventsInWindow.length === 0) {
    notes.push("窗口内无 collaboration-audit 事件，conflictRate 记为 0。");
  }
  if (eventData.malformed > 0) {
    notes.push(`collaboration-audit.jsonl 含 ${eventData.malformed} 条非法 JSON 行，已跳过。`);
  }

  return {
    reportType: "multitask-observability",
    runAt: new Date().toISOString(),
    workspaceDir,
    windowDays,
    sample: {
      jobsTotal: jobs.length,
      jobsInWindow: inWindowJobs.length,
      collaborationEvents: eventsInWindow.length,
      malformedEventLines: eventData.malformed,
    },
    metrics: {
      leadTimeP50Ms: percentile(leadTimes, 50),
      leadTimeP90Ms: percentile(leadTimes, 90),
      retryRate: toRate(retried, inWindowJobs.length),
      cancelRate: toRate(cancelled, inWindowJobs.length),
      failureRate: toRate(failed, inWindowJobs.length),
      conflictRate: toRate(conflictEvents, eventsInWindow.length),
      firstPassRate: computeFirstPassRate(opts.validationDistDir),
    },
    notes,
  };
}

export function multitaskObservabilityToMarkdown(report: MultitaskObservabilityReport): string {
  const lines: string[] = [];
  lines.push("# LawMind Multitask Observability Report");
  lines.push("");
  lines.push(`- reportType: ${report.reportType}`);
  lines.push(`- runAt: ${report.runAt}`);
  lines.push(`- workspaceDir: ${report.workspaceDir}`);
  lines.push(`- windowDays: ${report.windowDays}`);
  lines.push("");
  lines.push("## Sample");
  lines.push(`- jobsTotal: ${report.sample.jobsTotal}`);
  lines.push(`- jobsInWindow: ${report.sample.jobsInWindow}`);
  lines.push(`- collaborationEvents: ${report.sample.collaborationEvents}`);
  lines.push(`- malformedEventLines: ${report.sample.malformedEventLines}`);
  lines.push("");
  lines.push("## Metrics");
  lines.push(`- leadTimeP50Ms: ${report.metrics.leadTimeP50Ms ?? "n/a"}`);
  lines.push(`- leadTimeP90Ms: ${report.metrics.leadTimeP90Ms ?? "n/a"}`);
  lines.push(`- retryRate: ${report.metrics.retryRate}`);
  lines.push(`- cancelRate: ${report.metrics.cancelRate}`);
  lines.push(`- failureRate: ${report.metrics.failureRate}`);
  lines.push(`- conflictRate: ${report.metrics.conflictRate}`);
  lines.push(`- firstPassRate: ${report.metrics.firstPassRate ?? "n/a"}`);
  lines.push("");
  lines.push("## Notes");
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  return `${lines.join("\n")}\n`;
}
