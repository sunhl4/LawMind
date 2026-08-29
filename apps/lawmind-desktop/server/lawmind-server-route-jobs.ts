/**
 * Job/automation SSE is `{ ok, job }` snapshots — not a second RunTurnEvent dialect.
 * Chat / resume / live-turn speak embed-turn-events.ts.
 */
import path from "node:path";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { GateDecision, TaskExecutionState } from "../../../src/lawmind/platform/contracts.js";
import {
  getWorkflowJob,
  isSafeWorkflowJobId,
  isTerminalWorkflowJobStatus,
  listWorkflowJobs,
  parseJobStatusQueryParams,
  publicWorkflowJobFromRecord,
  requestCancelWorkflowJob,
  subscribeWorkflowJobUpdates,
} from "./lawmind-server-jobs.js";

function executionStateFromJob(
  job: ReturnType<typeof publicWorkflowJobFromRecord>,
): TaskExecutionState {
  if (job.status === "scheduled") {
    return {
      phase: "plan",
      status: "running",
      recoverable: true,
      detail: job.scheduledTrigger?.runAt
        ? `已预约执行：${job.scheduledTrigger.runAt}`
        : "已预约本地定时执行。",
    };
  }
  if (job.status === "queued") {
    return {
      phase: "plan",
      status: "running",
      recoverable: true,
      detail: "任务已入队，等待后台执行。",
    };
  }
  if (job.status === "running") {
    return {
      phase: "research",
      status: "running",
      recoverable: true,
      detail: "工作流执行中。",
    };
  }
  if (job.status === "completed") {
    return {
      phase: "complete",
      status: "completed",
      recoverable: false,
      detail: "工作流已完成。",
    };
  }
  if (job.status === "cancelled") {
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
    detail: job.error ?? "工作流执行失败。",
  };
}

function gateDecisionsFromJob(job: ReturnType<typeof publicWorkflowJobFromRecord>): GateDecision[] {
  if (job.cancelRequested && (job.status === "queued" || job.status === "running")) {
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

function publicWorkflowJobWithContracts(job: ReturnType<typeof publicWorkflowJobFromRecord>) {
  return {
    ...job,
    executionState: executionStateFromJob(job),
    gateDecisions: gateDecisionsFromJob(job),
  };
}

function jobBelongsToWorkspace(
  job: { workspaceDir: string },
  workspaceDir: string,
): boolean {
  return path.resolve(job.workspaceDir) === path.resolve(workspaceDir);
}

function parseJobRouteId(encodedSegment: string): string | null {
  let raw: string;
  try {
    raw = decodeURIComponent(encodedSegment);
  } catch {
    return null;
  }
  const id = raw.trim();
  return isSafeWorkflowJobId(id) ? id : null;
}

export function handleJobRoutes({
  pathname,
  req,
  res,
  url,
  c,
  ctx,
}: LawmindRouteContext): boolean {
  {
    const streamMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/stream$/);
    if (streamMatch && req.method === "GET") {
      const id = parseJobRouteId(streamMatch[1] ?? "");
      if (id === null) {
        sendJson(res, 400, { ok: false, error: "invalid_job_id" }, c);
        return true;
      }
      const job = getWorkflowJob(id);
      if (!job) {
        sendJson(res, 404, { ok: false, error: "job_not_found" }, c);
        return true;
      }
      if (!jobBelongsToWorkspace(job, ctx.workspaceDir)) {
        sendJson(res, 404, { ok: false, error: "job_not_found" }, c);
        return true;
      }
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let pingTimer: ReturnType<typeof setInterval> | null = null;
      const safeEnd = () => {
        if (closed) {
          return;
        }
        closed = true;
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        unsubscribe?.();
        unsubscribe = null;
        if (!res.writableEnded) {
          res.end();
        }
      };
      const sseLine = (j: ReturnType<typeof publicWorkflowJobFromRecord>) =>
        `data: ${JSON.stringify({ ok: true, job: j })}\n\n`;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        ...c,
      });
      res.write(sseLine(publicWorkflowJobWithContracts(publicWorkflowJobFromRecord(job))));
      if (isTerminalWorkflowJobStatus(job.status)) {
        res.end();
        return true;
      }
      unsubscribe = subscribeWorkflowJobUpdates(id, (pub) => {
        try {
          res.write(sseLine(publicWorkflowJobWithContracts(pub)));
        } catch {
          safeEnd();
          return;
        }
        if (isTerminalWorkflowJobStatus(pub.status)) {
          safeEnd();
        }
      });
      pingTimer = setInterval(() => {
        try {
          if (!closed && !res.writableEnded) {
            res.write(": ping\n\n");
          }
        } catch {
          safeEnd();
        }
      }, 25_000);
      req.on("close", () => {
        safeEnd();
      });
      return true;
    }
  }

  {
    const cancelMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === "POST") {
      const id = parseJobRouteId(cancelMatch[1] ?? "");
      if (id === null) {
        sendJson(res, 400, { ok: false, error: "invalid_job_id" }, c);
        return true;
      }
      const job = getWorkflowJob(id);
      if (!job || !jobBelongsToWorkspace(job, ctx.workspaceDir)) {
        sendJson(res, 404, { ok: false, error: "job_not_found" }, c);
        return true;
      }
      const result = requestCancelWorkflowJob(id);
      if (!result.ok) {
        const status =
          result.error === "job_not_found" ? 404 : result.error === "job_already_terminal" ? 409 : 400;
        sendJson(res, status, { ok: false, error: result.error }, c);
        return true;
      }
      sendJson(res, 200, { ok: true }, c);
      return true;
    }
  }

  if (pathname === "/api/jobs" && req.method === "GET") {
    const raw = url.searchParams.get("limit") ?? "20";
    const limit = Number.parseInt(raw, 10);
    const statusList = parseJobStatusQueryParams(url.searchParams.getAll("status"));
    const statusFilter =
      statusList === undefined ? undefined : statusList.length === 1 ? statusList[0] : statusList;
    const sinceCreatedAt = url.searchParams.get("since")?.trim() || undefined;
    const matterId = url.searchParams.get("matterId")?.trim() || undefined;
    const jobList = listWorkflowJobs(Number.isFinite(limit) ? limit : 20, {
      workspaceDir: ctx.workspaceDir,
      status: statusFilter,
      sinceCreatedAt,
      matterId,
    });
    sendJson(
      res,
      200,
      {
        ok: true,
        jobs: jobList.map((j) => publicWorkflowJobWithContracts(publicWorkflowJobFromRecord(j))),
      },
      c,
    );
    return true;
  }

  const detail = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (detail && req.method === "GET") {
    const id = parseJobRouteId(detail[1] ?? "");
    if (id === null) {
      sendJson(res, 400, { ok: false, error: "invalid_job_id" }, c);
      return true;
    }
    const job = getWorkflowJob(id);
    if (!job || !jobBelongsToWorkspace(job, ctx.workspaceDir)) {
      sendJson(res, 404, { ok: false, error: "job_not_found" }, c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        job: publicWorkflowJobWithContracts(publicWorkflowJobFromRecord(job)),
      },
      c,
    );
    return true;
  }

  return false;
}
