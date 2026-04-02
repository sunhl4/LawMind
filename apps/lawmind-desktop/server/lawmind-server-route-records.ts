import { listSessions } from "../../../src/lawmind/agent/session.js";
import { listDrafts } from "../../../src/lawmind/drafts/index.js";
import { listTaskRecords } from "../../../src/lawmind/tasks/index.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import {
  filterTaskSummaries,
  parseQueryTimeMs,
  sendJson,
  taskToSummary,
} from "./lawmind-server-helpers.js";

export async function handleRecordRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/tasks" && req.method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    const since = parseQueryTimeMs(url.searchParams.get("since"));
    const until = parseQueryTimeMs(url.searchParams.get("until"));
    const rows = listTaskRecords(workspaceDir).map(taskToSummary);
    const tasks = filterTaskSummaries(rows, q, since, until);
    sendJson(res, 200, { ok: true, tasks }, c);
    return true;
  }

  if (pathname === "/api/sessions" && req.method === "GET") {
    const sessions = listSessions(workspaceDir).map((session) => ({
      sessionId: session.sessionId,
      matterId: session.matterId,
      assistantId: session.assistantId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turnCount: session.turns.length,
    }));
    sendJson(res, 200, { ok: true, sessions }, c);
    return true;
  }

  if (pathname === "/api/drafts" && req.method === "GET") {
    const drafts = listDrafts(workspaceDir);
    sendJson(res, 200, { ok: true, drafts }, c);
    return true;
  }

  if (pathname === "/api/history" && req.method === "GET") {
    const tasks = listTaskRecords(workspaceDir);
    const drafts = listDrafts(workspaceDir);
    const items: Array<{
      kind: "task" | "draft";
      id: string;
      label: string;
      updatedAt: string;
      createdAt?: string;
      status?: string;
      outputPath?: string;
      matterId?: string;
      taskRecordKind?: string;
    }> = [];

    for (const task of tasks) {
      const display = (task.title?.trim() ? task.title : task.summary).slice(0, 120);
      items.push({
        kind: "task",
        id: task.taskId,
        label: display,
        updatedAt: task.updatedAt,
        createdAt: task.createdAt,
        status: task.status,
        outputPath: task.outputPath,
        matterId: task.matterId,
        taskRecordKind: task.kind,
      });
    }
    for (const draft of drafts) {
      items.push({
        kind: "draft",
        id: draft.taskId,
        label: draft.title,
        updatedAt: draft.createdAt,
        status: draft.reviewStatus,
        outputPath: draft.outputPath,
        matterId: draft.matterId,
      });
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    sendJson(res, 200, { ok: true, items: items.slice(0, 200) }, c);
    return true;
  }

  return false;
}
