import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import {
  buildWorkflowReport,
  executeWorkflow as runCollaborationWorkflow,
} from "../../../src/lawmind/agent/orchestrator/index.js";
import type { ExecuteWorkflowOptions } from "../../../src/lawmind/agent/orchestrator/index.js";
import type { CollaborationWorkflow } from "../../../src/lawmind/agent/orchestrator/types.js";
import {
  instantiateCollaborationWorkflowFromTemplate,
  readWorkspaceWorkflowTemplate,
} from "../../../src/lawmind/agent/collaboration/workspace-workflow-templates.js";
import type { WorkflowMemoryBundleSnapshot } from "../../../src/lawmind/agent/collaboration/workflow-memory-bundle.js";
import type { AgentConfig } from "../../../src/lawmind/agent/types.js";
import { emitCollaborationEvent } from "../../../src/lawmind/agent/collaboration/audit.js";
import { emitPlatformGateSnapshot } from "../../../src/lawmind/platform/audit-gate.js";
import type { GateDecision, TaskExecutionState } from "../../../src/lawmind/platform/contracts.js";
import { withExclusiveFileLock } from "../../../src/lawmind/adapters/matter-storage/io.js";

export type WorkflowJobStatus =
  | "scheduled"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Local-only schedule (no remote daemon). */
export type WorkflowJobScheduledTrigger = {
  runAt: string;
  source: "local_schedule";
};

export type WorkflowJobResultBody = {
  ok: true;
  workflowId: string;
  status: string;
  report: string;
  steps: Array<{ stepId: string; assignee: string; status: string; error?: string }>;
};

export type WorkflowJobProgress = {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  runningStepIds: string[];
  updatedAt: string;
};

export type WorkflowJobRecord = {
  jobId: string;
  kind: "workflow_run";
  status: WorkflowJobStatus;
  workflowId: string;
  matterId?: string;
  workspaceDir: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: WorkflowJobResultBody;
  /** Present while status is queued or running; cleared when the job finishes. */
  progress?: WorkflowJobProgress;
  cancelRequested?: boolean;
  idempotencyKey?: string;
  scheduledTrigger?: WorkflowJobScheduledTrigger;
  /** Serialized workflow for deferred / scheduled runs. */
  workflowSnapshot?: CollaborationWorkflow;
  /** Workspace template id for re-instantiation when snapshot is missing after restart. */
  templateId?: string;
  workflowVars?: Record<string, string>;
  createdByAssistantId?: string;
  /** Enqueue-time assistant PROFILE excerpts for step assignees. */
  memoryBundleSnapshot?: WorkflowMemoryBundleSnapshot;
};

/** HTTP / SSE payload (no workspaceDir, idempotencyKey, or workflowSnapshot). */
export type PublicWorkflowJob = Omit<
  WorkflowJobRecord,
  "workspaceDir" | "idempotencyKey" | "workflowSnapshot"
>;

const jobs = new Map<string, WorkflowJobRecord>();
const jobOrder: string[] = [];
const MAX_JOBS = 200;
const idempotencyKeyToJobId = new Map<string, string>();
const MAX_IDEMPOTENCY_KEY_LEN = 128;

const jobWatchEmitter = new EventEmitter();
jobWatchEmitter.setMaxListeners(256);

export function publicWorkflowJobFromRecord(job: WorkflowJobRecord): PublicWorkflowJob {
  return {
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    workflowId: job.workflowId,
    matterId: job.matterId,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    result: job.result,
    cancelRequested: job.cancelRequested,
    progress: job.progress,
    scheduledTrigger: job.scheduledTrigger,
  };
}

export function isTerminalWorkflowJobStatus(s: string): boolean {
  return s === "completed" || s === "failed" || s === "cancelled";
}

const MAX_WORKFLOW_JOB_ID_LEN = 128;

/**
 * Single path-segment job id from URLs / filenames: alphanumerics, dot, underscore, hyphen; bounded length.
 * Rejects slashes and ".." to avoid path injection into `lawmind/jobs/<id>.json`.
 */
export function isSafeWorkflowJobId(raw: string): boolean {
  const id = raw.trim();
  if (id.length === 0 || id.length > MAX_WORKFLOW_JOB_ID_LEN) {
    return false;
  }
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    return false;
  }
  return /^[a-zA-Z0-9._-]+$/.test(id);
}

/**
 * Subscribe to in-memory job updates (same payload as GET /api/jobs/:id). Used by SSE.
 */
export function subscribeWorkflowJobUpdates(
  jobId: string,
  listener: (job: PublicWorkflowJob) => void,
): () => void {
  const channel = `job:${jobId}`;
  const fn = (payload: PublicWorkflowJob) => listener(payload);
  jobWatchEmitter.on(channel, fn);
  return () => {
    jobWatchEmitter.off(channel, fn);
  };
}

function jobsDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "jobs");
}

function jobFilePath(workspaceDir: string, jobId: string): string {
  return path.join(jobsDir(workspaceDir), `${jobId}.json`);
}

function readWorkflowJobFromDisk(workspaceDir: string, jobId: string): WorkflowJobRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(jobFilePath(workspaceDir, jobId), "utf8")) as Omit<
      WorkflowJobRecord,
      "workspaceDir"
    >;
    return {
      ...raw,
      jobId: raw.jobId || jobId,
      workspaceDir: path.resolve(workspaceDir),
    };
  } catch {
    return null;
  }
}

function rememberWorkflowJob(rec: WorkflowJobRecord): void {
  const existing = jobs.get(rec.jobId);
  if (existing && existing.status !== "scheduled" && rec.status === "scheduled") {
    return;
  }
  if (!existing) {
    jobOrder.push(rec.jobId);
  }
  jobs.set(rec.jobId, rec);
}

/** Load scheduled jobs written by another process (desktop ↔ lawmindd). */
function refreshScheduledJobsFromDisk(workspaceDir: string): void {
  const dir = jobsDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const jobId = name.replace(/\.json$/u, "");
    const rec = readWorkflowJobFromDisk(workspaceDir, jobId);
    if (!rec || rec.status !== "scheduled") {
      continue;
    }
    rememberWorkflowJob(rec);
  }
}

/**
 * Atomically claim a due scheduled job so desktop + lawmindd cannot double-fire.
 * Returns null if another process already claimed it or it is not due.
 */
export function claimDueScheduledJob(
  workspaceDir: string,
  jobId: string,
  nowMs = Date.now(),
): WorkflowJobRecord | null {
  const root = path.resolve(workspaceDir);
  const file = jobFilePath(root, jobId);
  if (!fs.existsSync(file)) {
    return null;
  }
  return withExclusiveFileLock(`${file}.lock`, () => {
    const rec = readWorkflowJobFromDisk(root, jobId);
    if (!rec || !isDueScheduledJob(rec, nowMs)) {
      return null;
    }
    rec.status = "queued";
    persistWorkflowJob(rec);
    rememberWorkflowJob(rec);
    return rec;
  });
}

function normalizeIdempotencyKey(raw: string | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const t = raw.trim().slice(0, MAX_IDEMPOTENCY_KEY_LEN);
  return t.length > 0 ? t : null;
}

function isTerminalStatus(s: WorkflowJobStatus): boolean {
  return s === "completed" || s === "failed" || s === "cancelled";
}

function isDueScheduledJob(rec: WorkflowJobRecord, nowMs = Date.now()): boolean {
  if (rec.status !== "scheduled" || !rec.scheduledTrigger?.runAt) {
    return false;
  }
  const t = Date.parse(rec.scheduledTrigger.runAt);
  return Number.isFinite(t) && t <= nowMs;
}

let resolveSchedulerConfig:
  | ((workspaceDir: string) => AgentConfig | null | undefined)
  | undefined;

/** Desktop local server registers config builder for scheduled job ticks. */
export function setWorkflowJobSchedulerContext(
  fn: (workspaceDir: string) => AgentConfig | null | undefined,
): void {
  resolveSchedulerConfig = fn;
}

function releaseIdempotencyForRecord(rec: WorkflowJobRecord): void {
  const key = rec.idempotencyKey;
  if (!key) {
    return;
  }
  if (idempotencyKeyToJobId.get(key) === rec.jobId) {
    idempotencyKeyToJobId.delete(key);
  }
}

function trimJobRegistry(): void {
  while (jobOrder.length > MAX_JOBS) {
    const old = jobOrder.shift();
    if (!old) {
      continue;
    }
    const rec = jobs.get(old);
    if (rec?.idempotencyKey && idempotencyKeyToJobId.get(rec.idempotencyKey) === old) {
      idempotencyKeyToJobId.delete(rec.idempotencyKey);
    }
    const ws = rec?.workspaceDir;
    jobs.delete(old);
    if (ws) {
      try {
        fs.unlinkSync(jobFilePath(ws, old));
      } catch {
        /* ignore */
      }
    }
  }
}

function workflowJobExecutionState(
  status: WorkflowJobStatus,
  error?: string,
): TaskExecutionState {
  if (status === "scheduled") {
    return {
      phase: "plan",
      status: "running",
      recoverable: true,
      detail: "已预约本地定时执行。",
    };
  }
  if (status === "queued") {
    return {
      phase: "plan",
      status: "running",
      recoverable: true,
      detail: "任务已入队，等待后台执行。",
    };
  }
  if (status === "running") {
    return {
      phase: "research",
      status: "running",
      recoverable: true,
      detail: "工作流执行中。",
    };
  }
  if (status === "completed") {
    return {
      phase: "complete",
      status: "completed",
      recoverable: false,
      detail: "工作流已完成。",
    };
  }
  if (status === "cancelled") {
    return {
      phase: "error",
      status: "failed",
      recoverable: true,
      detail: "工作流已取消。",
    };
  }
  return {
    phase: "error",
    status: "failed",
    recoverable: true,
    detail: error ?? "工作流执行失败。",
  };
}

function workflowJobGateDecisions(record: WorkflowJobRecord): GateDecision[] {
  if (
    record.cancelRequested &&
    (record.status === "queued" || record.status === "running")
  ) {
    return [
      {
        gate: "approval_gate",
        decision: "awaiting_confirmation",
        reason: "已请求取消，等待当前步骤可中断点。",
      },
    ];
  }
  return [];
}

function auditWorkflowJobGateSnapshot(record: WorkflowJobRecord): void {
  void emitPlatformGateSnapshot(path.join(record.workspaceDir, "audit"), {
    taskId: record.jobId,
    source: "workflow_job",
    actor: "system",
    executionState: workflowJobExecutionState(record.status, record.error),
    gateDecisions: workflowJobGateDecisions(record),
    context: {
      jobStatus: record.status,
      workflowId: record.workflowId,
    },
  });
}

function emitJobAudit(workspaceDir: string, detail: string): void {
  try {
    emitCollaborationEvent(workspaceDir, {
      eventId: randomUUID(),
      kind: "notify.sent",
      fromAssistantId: "system",
      toAssistantId: "lawyer",
      detail,
      timestamp: new Date().toISOString(),
    });
  } catch {
    /* best-effort */
  }
}

export function persistWorkflowJob(record: WorkflowJobRecord): void {
  try {
    const dir = jobsDir(record.workspaceDir);
    fs.mkdirSync(dir, { recursive: true });
    const { workspaceDir, ...rest } = record;
    fs.writeFileSync(
      jobFilePath(workspaceDir, record.jobId),
      JSON.stringify(rest),
      "utf8",
    );
  } catch {
    /* best-effort */
  }
  jobWatchEmitter.emit(`job:${record.jobId}`, publicWorkflowJobFromRecord(record));
}

/**
 * Load job JSON files into memory; non-terminal jobs from a previous process become failed.
 */
export function loadJobsFromDiskOnStartup(workspaceDir: string): void {
  const dir = jobsDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const loaded: WorkflowJobRecord[] = [];
  for (const f of files) {
    try {
      const jobId = f.replace(/\.json$/u, "");
      const abs = path.join(dir, f);
      const raw = fs.readFileSync(abs, "utf8");
      const parsed = JSON.parse(raw) as Omit<WorkflowJobRecord, "workspaceDir">;
      const rec: WorkflowJobRecord = {
        ...parsed,
        jobId: parsed.jobId || jobId,
        workspaceDir: path.resolve(workspaceDir),
      };
      if (rec.status === "queued" || rec.status === "running") {
        rec.status = "failed";
        rec.error = "interrupted_by_restart";
        rec.completedAt = new Date().toISOString();
        delete rec.progress;
        delete rec.cancelRequested;
        const { workspaceDir: _w, ...persistBody } = rec;
        void _w;
        fs.writeFileSync(abs, JSON.stringify(persistBody), "utf8");
      }
      // scheduled jobs survive restart; tick will pick them up
      loaded.push(rec);
    } catch {
      /* skip corrupt file */
    }
  }
  loaded.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const rec of loaded) {
    jobs.set(rec.jobId, rec);
    jobOrder.push(rec.jobId);
  }
  trimJobRegistry();
}

export function getWorkflowJob(jobId: string): WorkflowJobRecord | undefined {
  return jobs.get(jobId);
}

const ALL_JOB_STATUSES: ReadonlyArray<WorkflowJobStatus> = [
  "scheduled",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
];

function isWorkflowJobStatus(s: string): s is WorkflowJobStatus {
  return (ALL_JOB_STATUSES as readonly string[]).includes(s);
}

function matchesWorkspaceFilter(rec: WorkflowJobRecord, workspaceDir?: string): boolean {
  if (!workspaceDir?.trim()) {
    return true;
  }
  return path.resolve(rec.workspaceDir) === path.resolve(workspaceDir);
}

function matchesStatusFilter(
  rec: WorkflowJobRecord,
  status?: WorkflowJobStatus | WorkflowJobStatus[],
): boolean {
  if (status === undefined) {
    return true;
  }
  const arr = Array.isArray(status) ? status : [status];
  return arr.includes(rec.status);
}

function matchesSinceFilter(rec: WorkflowJobRecord, sinceIso?: string): boolean {
  if (!sinceIso?.trim()) {
    return true;
  }
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) {
    return true;
  }
  const createdMs = Date.parse(rec.createdAt);
  if (!Number.isFinite(createdMs)) {
    return true;
  }
  return createdMs >= sinceMs;
}

export type ListWorkflowJobsOptions = {
  /** When set, only jobs whose workspace matches this root (same server is usually one workspace). */
  workspaceDir?: string;
  /** Filter by matter when job was started with matterId. */
  matterId?: string;
  /** Single status or multiple (repeat query param). */
  status?: WorkflowJobStatus | WorkflowJobStatus[];
  /** ISO timestamp: only jobs with createdAt >= since */
  sinceCreatedAt?: string;
};

export function listWorkflowJobs(limit: number, options?: ListWorkflowJobsOptions): WorkflowJobRecord[] {
  const n = Math.min(Math.max(limit, 1), 100);
  const out: WorkflowJobRecord[] = [];
  for (let i = jobOrder.length - 1; i >= 0 && out.length < n; i--) {
    const id = jobOrder[i];
    const rec = id ? jobs.get(id) : undefined;
    if (!rec) {
      continue;
    }
    if (!matchesWorkspaceFilter(rec, options?.workspaceDir)) {
      continue;
    }
    if (!matchesStatusFilter(rec, options?.status)) {
      continue;
    }
    if (!matchesSinceFilter(rec, options?.sinceCreatedAt)) {
      continue;
    }
    const matterFilter = options?.matterId?.trim();
    if (matterFilter && rec.matterId !== matterFilter) {
      continue;
    }
    out.push(rec);
  }
  return out;
}

/** Parse repeated `status` query values into a filter (invalid tokens dropped). */
export function parseJobStatusQueryParams(values: string[]): WorkflowJobStatus[] | undefined {
  const out = values.map((v) => v.trim()).filter(isWorkflowJobStatus);
  return out.length > 0 ? out : undefined;
}

/** Test-only: clear registry between tests. */
export function clearWorkflowJobsForTests(): void {
  jobs.clear();
  jobOrder.length = 0;
  idempotencyKeyToJobId.clear();
  jobWatchEmitter.removeAllListeners();
}

export type WorkflowRunDeps = {
  run?: (
    baseConfig: AgentConfig,
    workflow: CollaborationWorkflow,
    options?: ExecuteWorkflowOptions,
  ) => Promise<CollaborationWorkflow>;
};

export type EnqueueWorkflowRunOptions = WorkflowRunDeps & {
  idempotencyKey?: string;
  /** ISO datetime — defer start until this time (local scheduler tick). */
  scheduleRunAt?: string;
  templateId?: string;
  workflowVars?: Record<string, string>;
  createdByAssistantId?: string;
  memoryBundleSnapshot?: WorkflowMemoryBundleSnapshot;
};

/**
 * Resolve runnable workflow from job record (snapshot preferred; template fallback).
 */
export function resolveWorkflowForJob(rec: WorkflowJobRecord): CollaborationWorkflow | null {
  if (rec.workflowSnapshot) {
    return rec.workflowSnapshot;
  }
  const templateId = rec.templateId?.trim();
  if (!templateId) {
    return null;
  }
  const template = readWorkspaceWorkflowTemplate(rec.workspaceDir, templateId);
  if (!template) {
    return null;
  }
  return instantiateCollaborationWorkflowFromTemplate(template, {
    matterId: rec.matterId,
    createdBy: rec.createdByAssistantId ?? "workflow_scheduler",
    vars: rec.workflowVars,
    workflowId: rec.workflowId,
  });
}

export function requestCancelWorkflowJob(jobId: string): { ok: boolean; error?: string } {
  const r = jobs.get(jobId);
  if (!r) {
    return { ok: false, error: "job_not_found" };
  }
  if (isTerminalStatus(r.status)) {
    return { ok: false, error: "job_already_terminal" };
  }
  if (r.status === "scheduled" || r.status === "queued") {
    r.status = "cancelled";
    r.completedAt = new Date().toISOString();
    r.error = "cancelled_by_user";
    releaseIdempotencyForRecord(r);
    persistWorkflowJob(r);
    auditWorkflowJobGateSnapshot(r);
    emitJobAudit(r.workspaceDir, `workflow_job=${r.jobId} status=cancelled queued_abort`);
    return { ok: true };
  }
  r.cancelRequested = true;
  persistWorkflowJob(r);
  auditWorkflowJobGateSnapshot(r);
  emitJobAudit(r.workspaceDir, `workflow_job=${r.jobId} cancel_requested`);
  return { ok: true };
}

function finalizeJobFromWorkflow(jobId: string, finished: CollaborationWorkflow): void {
  const r = jobs.get(jobId);
  if (!r) {
    return;
  }
  const report = buildWorkflowReport(finished);
  r.completedAt = new Date().toISOString();
  r.result = {
    ok: true,
    workflowId: finished.workflowId,
    status: finished.status,
    report,
    steps: finished.steps.map((s) => ({
      stepId: s.stepId,
      assignee: s.assignee,
      status: s.status,
      error: s.error,
    })),
  };

  if (finished.status === "cancelled") {
    r.status = "cancelled";
    r.error = r.cancelRequested ? "cancelled_by_user" : "workflow_cancelled";
  } else if (finished.status === "failed") {
    r.status = "failed";
    const errStep = finished.steps.find((s) => s.status === "failed");
    r.error = errStep?.error ?? `workflow status: ${finished.status}`;
  } else {
    r.status = "completed";
    delete r.error;
  }

  delete r.cancelRequested;
  delete r.progress;
  releaseIdempotencyForRecord(r);
  persistWorkflowJob(r);
  auditWorkflowJobGateSnapshot(r);
  emitJobAudit(
    r.workspaceDir,
    `workflow_job=${jobId} status=${r.status} workflowId=${finished.workflowId}`,
  );
}

function startWorkflowJobExecution(
  jobId: string,
  baseConfig: AgentConfig,
  workflow: CollaborationWorkflow,
  runner: NonNullable<WorkflowRunDeps["run"]>,
): void {
  const workspaceDir = path.resolve(baseConfig.workspaceDir);
  setImmediate(() => {
    const cur = jobs.get(jobId);
    if (!cur || cur.status !== "queued") {
      return;
    }
    cur.status = "running";
    cur.startedAt = new Date().toISOString();
    delete cur.workflowSnapshot;
    persistWorkflowJob(cur);
    emitJobAudit(workspaceDir, `workflow_job=${jobId} running`);

    const memoryBundle = cur.memoryBundleSnapshot;
    void runner(baseConfig, workflow, {
      shouldAbort: () => jobs.get(jobId)?.cancelRequested === true,
      memoryBundle,
      onProgress: (snapshot) => {
        const r = jobs.get(jobId);
        if (!r || isTerminalStatus(r.status)) {
          return;
        }
        r.progress = {
          ...snapshot,
          updatedAt: new Date().toISOString(),
        };
        persistWorkflowJob(r);
      },
    })
      .then((finished) => {
        finalizeJobFromWorkflow(jobId, finished);
      })
      .catch((err) => {
        const r = jobs.get(jobId);
        if (!r) {
          return;
        }
        r.status = "failed";
        r.completedAt = new Date().toISOString();
        r.error = err instanceof Error ? err.message : String(err);
        delete r.cancelRequested;
        delete r.progress;
        releaseIdempotencyForRecord(r);
        persistWorkflowJob(r);
        auditWorkflowJobGateSnapshot(r);
        emitJobAudit(workspaceDir, `workflow_job=${jobId} status=failed error=${r.error}`);
      });
  });
}

/**
 * Fire scheduled jobs whose runAt has passed (local desktop tick only).
 */
export function processDueScheduledJobs(workspaceDir: string): number {
  const root = path.resolve(workspaceDir);
  const config = resolveSchedulerConfig?.(root);
  if (!config) {
    return 0;
  }
  refreshScheduledJobsFromDisk(root);
  let fired = 0;
  for (const rec of Array.from(jobs.values())) {
    if (path.resolve(rec.workspaceDir) !== root) {
      continue;
    }
    if (!isDueScheduledJob(rec)) {
      continue;
    }
    const claimed = claimDueScheduledJob(root, rec.jobId);
    if (!claimed) {
      continue;
    }
    const workflow = resolveWorkflowForJob(claimed);
    if (!workflow) {
      claimed.status = "failed";
      claimed.error = "missing_workflow_snapshot";
      claimed.completedAt = new Date().toISOString();
      persistWorkflowJob(claimed);
      rememberWorkflowJob(claimed);
      continue;
    }
    if (!claimed.workflowSnapshot) {
      claimed.workflowSnapshot = workflow;
      persistWorkflowJob(claimed);
    }
    delete claimed.scheduledTrigger;
    persistWorkflowJob(claimed);
    startWorkflowJobExecution(claimed.jobId, config, workflow, runCollaborationWorkflow);
    fired += 1;
  }
  return fired;
}

/**
 * Enqueue a team workflow run; returns jobId immediately. Work runs on a later tick via setImmediate.
 */
export function enqueueWorkflowRun(
  baseConfig: AgentConfig,
  workflow: CollaborationWorkflow,
  deps?: EnqueueWorkflowRunOptions,
): string {
  const workspaceDir = path.resolve(baseConfig.workspaceDir);
  const idemKey = normalizeIdempotencyKey(deps?.idempotencyKey);
  if (idemKey) {
    const existingId = idempotencyKeyToJobId.get(idemKey);
    if (existingId) {
      const existing = jobs.get(existingId);
      if (existing && !isTerminalStatus(existing.status)) {
        return existingId;
      }
    }
  }

  const jobId = randomUUID();
  const runner = deps?.run ?? runCollaborationWorkflow;
  const scheduleRaw = deps?.scheduleRunAt?.trim();
  const scheduleMs = scheduleRaw ? Date.parse(scheduleRaw) : NaN;
  const isScheduled = Number.isFinite(scheduleMs) && scheduleMs > Date.now();

  const templateId = deps?.templateId?.trim() || undefined;
  const memoryBundleSnapshot = deps?.memoryBundleSnapshot;
  const createdByAssistantId = deps?.createdByAssistantId?.trim() || undefined;
  const workflowVars = deps?.workflowVars;

  const record: WorkflowJobRecord = {
    jobId,
    kind: "workflow_run",
    status: isScheduled ? "scheduled" : "queued",
    workflowId: workflow.workflowId,
    matterId: workflow.matterId?.trim() || undefined,
    workspaceDir,
    createdAt: new Date().toISOString(),
    workflowSnapshot: workflow,
    ...(templateId ? { templateId } : {}),
    ...(workflowVars && Object.keys(workflowVars).length > 0 ? { workflowVars } : {}),
    ...(createdByAssistantId ? { createdByAssistantId } : {}),
    ...(memoryBundleSnapshot ? { memoryBundleSnapshot } : {}),
    ...(idemKey ? { idempotencyKey: idemKey } : {}),
    ...(isScheduled
      ? {
          scheduledTrigger: { runAt: new Date(scheduleMs).toISOString(), source: "local_schedule" as const },
        }
      : {}),
  };
  jobs.set(jobId, record);
  jobOrder.push(jobId);
  if (idemKey) {
    idempotencyKeyToJobId.set(idemKey, jobId);
  }
  trimJobRegistry();
  persistWorkflowJob(record);
  emitJobAudit(
    workspaceDir,
    `workflow_job=${jobId} ${isScheduled ? "scheduled" : "enqueued"} workflowId=${workflow.workflowId}`,
  );

  if (!isScheduled) {
    startWorkflowJobExecution(jobId, baseConfig, workflow, runner);
  }

  return jobId;
}
