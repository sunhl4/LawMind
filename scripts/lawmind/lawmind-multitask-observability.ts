import fs from "node:fs";
import path from "node:path";

type CliOptions = {
  workspaceDir: string;
  outDir: string;
  windowDays: number;
};

type JobLike = {
  status?: string;
  createdAt?: string;
  completedAt?: string;
  updatedAt?: string;
  retryCount?: number;
  retries?: number;
  attempt?: number;
  attempts?: number;
};

type ObservabilityReport = {
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

function parseArgs(argv: string[]): CliOptions {
  let workspaceDir = process.env.LAWMIND_WORKSPACE_DIR ?? path.join(process.cwd(), "workspace");
  let outDir = path.join(process.cwd(), "dist", "lawmind", "multitask-validation");
  let windowDays = 14;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      continue;
    }
    if (token === "--help") {
      console.log(
        "Usage: node --import tsx scripts/lawmind/lawmind-multitask-observability.ts [--workspace-dir <path>] [--out-dir <path>] [--window-days <days>]",
      );
      process.exit(0);
    }
    if (token !== "--workspace-dir" && token !== "--out-dir" && token !== "--window-days") {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    if (token === "--workspace-dir") {
      workspaceDir = path.resolve(process.cwd(), value);
    } else if (token === "--out-dir") {
      outDir = path.resolve(process.cwd(), value);
    } else {
      const parsedWindowDays = Number(value);
      if (!Number.isFinite(parsedWindowDays) || parsedWindowDays <= 0) {
        throw new Error(`invalid --window-days value: ${value}`);
      }
      windowDays = parsedWindowDays;
    }
    i += 1;
  }

  return { workspaceDir, outDir, windowDays };
}

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
  const eventFile = path.join(workspaceDir, "collaboration-audit.jsonl");
  if (!fs.existsSync(eventFile)) {
    return { events: [], malformed: 0 };
  }
  const lines = fs
    .readFileSync(eventFile, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const events: Array<{ timestampMs: number; line: string }> = [];
  let malformed = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { createdAt?: string; timestamp?: string };
      const timestampMs = parseIsoMs(parsed.createdAt ?? parsed.timestamp) ?? 0;
      events.push({ timestampMs, line });
    } catch {
      malformed += 1;
    }
  }
  return { events, malformed };
}

function computeFirstPassRate(distDir: string): number | null {
  if (!fs.existsSync(distDir)) {
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

function toMarkdown(report: ObservabilityReport): string {
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

function writeReport(
  outDir: string,
  report: ObservabilityReport,
): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.runAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `observability-${stamp}.json`);
  const mdPath = path.join(outDir, `observability-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, toMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const jobsDir = path.join(opts.workspaceDir, "lawmind", "jobs");
  const jobFiles = listJsonFiles(jobsDir);
  const jobs = jobFiles
    .map((jobPath) => readJsonFile<JobLike>(jobPath))
    .filter((job): job is JobLike => job !== null);

  const now = Date.now();
  const windowMs = opts.windowDays * 24 * 60 * 60 * 1000;
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

  const eventData = loadCollaborationEvents(opts.workspaceDir);
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

  const report: ObservabilityReport = {
    reportType: "multitask-observability",
    runAt: new Date().toISOString(),
    workspaceDir: opts.workspaceDir,
    windowDays: opts.windowDays,
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
      firstPassRate: computeFirstPassRate(opts.outDir),
    },
    notes,
  };
  const output = writeReport(opts.outDir, report);
  console.log("[Multitask Observability] report written:");
  console.log(`- ${output.jsonPath}`);
  console.log(`- ${output.mdPath}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Multitask Observability] failed: ${message}`);
  process.exitCode = 1;
}
