/**
 * Action summary + approval resolve routes.
 */

import { listSessions } from "../../../src/lawmind/agent/session.js";
import { listPendingToolApprovals } from "../../../src/lawmind/platform/pending-tool-approvals.js";
import { resolveApproval } from "../../../src/lawmind/application/services/approval-service.js";
import { listApprovalRequests, listWorkQueueItems } from "../../../src/lawmind/application/services/queue-service.js";
import { listWorkflowJobs } from "./lawmind-server-jobs.js";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { approvalResolvePostSchema } from "./lawmind-api-schemas.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { resolveDesktopActorId, sendJson } from "./lawmind-server-helpers.js";

function countChatRequiresActions(workspaceDir: string): number {
  let n = 0;
  for (const s of listSessions(workspaceDir)) {
    n += s.pendingRequiresAction?.length ?? 0;
  }
  return n;
}

export async function handleActionSummaryRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/action-summary" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    const matterFilter = matterId && isValidMatterId(matterId) ? matterId : undefined;
    if (matterId && !matterFilter) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }

    const [pendingApprovals, openQueueItems, jobs] = await Promise.all([
      listApprovalRequests(workspaceDir, { matterId: matterFilter, status: "pending" }),
      listWorkQueueItems(workspaceDir, { matterId: matterFilter, status: "open" }),
      Promise.resolve(
        listWorkflowJobs(30, {
          workspaceDir,
          status: ["queued", "running"],
        }),
      ),
    ]);

    const toolApprovals = listPendingToolApprovals(workspaceDir, {
      matterId: matterFilter,
    });
    const chatRequiresActionCount = countChatRequiresActions(workspaceDir);
    const total =
      pendingApprovals.length +
      openQueueItems.length +
      jobs.length +
      toolApprovals.length +
      chatRequiresActionCount;

    sendJson(
      res,
      200,
      {
        ok: true,
        total,
        pendingApprovals: pendingApprovals.length,
        openQueueItems: openQueueItems.length,
        activeJobs: jobs.length,
        chatRequiresActionCount,
        pendingToolApprovals: toolApprovals.length,
        approvals: pendingApprovals.slice(0, 20),
        queueItems: openQueueItems.slice(0, 20),
        jobs: jobs.slice(0, 10),
        toolApprovals: toolApprovals.slice(0, 20),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/approvals/resolve" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, approvalResolvePostSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        const issues = err.issues.join(" ");
        if (issues.includes("status")) {
          sendJsonError(
            res,
            400,
            "invalid_status",
            "status 须为 approved、rejected 或 needs_changes。",
            c,
          );
          return true;
        }
        sendJsonError(res, 400, "invalid_fields", "缺少有效的 matterId 或 approvalId。", c);
        return true;
      }
      throw err;
    }
    const matterId = body.matterId;
    const approvalId = body.approvalId;
    const statusRaw = body.status;
    if (!isValidMatterId(matterId)) {
      sendJsonError(res, 400, "invalid_fields", "缺少有效的 matterId 或 approvalId。", c);
      return true;
    }
    const resolvedBy =
      typeof body.resolvedBy === "string" && body.resolvedBy.trim()
        ? body.resolvedBy.trim()
        : resolveDesktopActorId();
    const updated = resolveApproval(workspaceDir, matterId, approvalId, {
      status: statusRaw,
      resolvedBy,
    });
    if (!updated) {
      sendJsonError(res, 404, "approval_not_found", "未找到该审批项。", c);
      return true;
    }
    sendJson(res, 200, { ok: true, approval: updated }, c);
    return true;
  }

  return false;
}
