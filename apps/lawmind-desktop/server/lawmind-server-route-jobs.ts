import path from "node:path";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
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
      if (path.resolve(job.workspaceDir) !== path.resolve(ctx.workspaceDir)) {
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
      res.write(sseLine(publicWorkflowJobFromRecord(job)));
      if (isTerminalWorkflowJobStatus(job.status)) {
        res.end();
        return true;
      }
      unsubscribe = subscribeWorkflowJobUpdates(id, (pub) => {
        try {
          res.write(sseLine(pub));
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
    const jobList = listWorkflowJobs(Number.isFinite(limit) ? limit : 20, {
      workspaceDir: ctx.workspaceDir,
      status: statusFilter,
      sinceCreatedAt,
    });
    sendJson(
      res,
      200,
      {
        ok: true,
        jobs: jobList.map((j) => publicWorkflowJobFromRecord(j)),
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
    if (!job) {
      sendJson(res, 404, { ok: false, error: "job_not_found" }, c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        job: publicWorkflowJobFromRecord(job),
      },
      c,
    );
    return true;
  }

  return false;
}
