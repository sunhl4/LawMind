import {
  cancelDelegation,
  getDelegation,
  listDelegations,
  readCollaborationEvents,
} from "../../../src/lawmind/agent/collaboration/index.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

export async function handleCollaborationRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/collaboration/summary" && req.method === "GET") {
    const collaborationEnabled =
      process.env.LAWMIND_ENABLE_COLLABORATION?.trim().toLowerCase() !== "false";
    const delegations = listDelegations();
    const events = readCollaborationEvents(workspaceDir).slice(-40);
    sendJson(
      res,
      200,
      {
        ok: true,
        collaborationEnabled,
        collaborationHint: collaborationEnabled
          ? "协作已开启：委派与事件会写入内存注册表与 workspace 审计（若存在）。"
          : "协作已关闭（LAWMIND_ENABLE_COLLABORATION=false）：不会注册多助手委派。",
        delegationCount: delegations.length,
        delegations: delegations.slice(-20).map((delegation) => ({
          delegationId: delegation.delegationId,
          fromAssistantId: delegation.fromAssistantId,
          toAssistantId: delegation.toAssistantId,
          status: delegation.status,
          matterId: delegation.matterId,
          startedAt: delegation.startedAt,
        })),
        recentCollaborationEvents: events,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/delegations" && req.method === "GET") {
    const statusFilter = url.searchParams.get("status") ?? undefined;
    const assistantFilter = url.searchParams.get("assistantId") ?? undefined;
    const records = listDelegations({
      fromAssistantId: assistantFilter || undefined,
      status: statusFilter as "pending" | "running" | "completed" | "failed" | undefined,
    });
    sendJson(
      res,
      200,
      {
        ok: true,
        delegations: records.slice(0, 100).map((record) => ({
          delegationId: record.delegationId,
          fromAssistant: record.fromAssistantId,
          toAssistant: record.toAssistantId,
          task: record.task.slice(0, 200),
          status: record.status,
          priority: record.priority,
          result: record.result?.slice(0, 300),
          error: record.error,
          startedAt: record.startedAt,
          completedAt: record.completedAt,
        })),
        total: records.length,
      },
      c,
    );
    return true;
  }

  {
    const delegationDetail = pathname.match(/^\/api\/delegations\/([^/]+)$/);
    if (delegationDetail && req.method === "GET") {
      const id = decodeURIComponent(delegationDetail[1] ?? "");
      const record = getDelegation(id);
      if (!record) {
        sendJson(res, 404, { ok: false, error: "delegation not found" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, delegation: record }, c);
      return true;
    }
    if (delegationDetail && req.method === "DELETE") {
      const id = decodeURIComponent(delegationDetail[1] ?? "");
      const record = cancelDelegation(workspaceDir, id);
      if (!record) {
        sendJson(res, 404, { ok: false, error: "delegation not found" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, delegation: record }, c);
      return true;
    }
  }

  if (pathname === "/api/collaboration-events" && req.method === "GET") {
    const since = url.searchParams.get("since") ?? undefined;
    let events = readCollaborationEvents(workspaceDir);
    if (since) {
      const sinceMs = Date.parse(since);
      if (Number.isFinite(sinceMs)) {
        events = events.filter((event) => Date.parse(event.timestamp) >= sinceMs);
      }
    }
    sendJson(res, 200, { ok: true, events: events.slice(-200), total: events.length }, c);
    return true;
  }

  return false;
}
