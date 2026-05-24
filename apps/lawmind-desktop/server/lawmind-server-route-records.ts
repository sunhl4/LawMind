import { DEFAULT_ASSISTANT_ID } from "../../../src/lawmind/assistants/constants.js";
import type { AgentSession } from "../../../src/lawmind/agent/types.js";
import {
  createSession,
  deleteSession,
  displayChatSessionTitle,
  listSessions,
  loadSession,
  renameSession,
  sessionHistoryToSimpleMessages,
} from "../../../src/lawmind/agent/session.js";
import { listDrafts } from "../../../src/lawmind/drafts/index.js";
import { listTaskRecords, readTaskRecord } from "../../../src/lawmind/tasks/index.js";
import { taskRecordStatusLabel } from "../../../src/lawmind/tasks/status-label.js";
import { getLiveTurnProgress } from "../../../src/lawmind/agent/live-turn-progress.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import {
  filterTaskSummaries,
  isLawMindHttpError,
  parseQueryTimeMs,
  readJsonBody,
  resolveDesktopActorId,
  sendJson,
  taskToSummary,
} from "./lawmind-server-helpers.js";

function sessionMatchesAssistantFilter(session: AgentSession, assistantId: string): boolean {
  if (session.assistantId === assistantId) {
    return true;
  }
  if (!session.assistantId && assistantId === DEFAULT_ASSISTANT_ID) {
    return true;
  }
  return false;
}

function performSessionDelete(
  workspaceDir: string,
  sessionId: string,
  assistantId: string,
):
  | { status: 200; payload: { ok: true; sessionId: string } }
  | { status: 404; payload: { ok: false; code: string; message: string } }
  | { status: 500; payload: { ok: false; code: string; message: string } } {
  const session = loadSession(workspaceDir, sessionId);
  if (!session) {
    return { status: 404, payload: { ok: false, code: "not_found", message: "session not found" } };
  }
  if (!sessionMatchesAssistantFilter(session, assistantId)) {
    return { status: 404, payload: { ok: false, code: "not_found", message: "session not found" } };
  }
  if (!deleteSession(workspaceDir, sessionId)) {
    return {
      status: 500,
      payload: { ok: false, code: "delete_failed", message: "could not delete session files" },
    };
  }
  return { status: 200, payload: { ok: true, sessionId } };
}

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
    const rows = listTaskRecords(workspaceDir).map((t) => ({
      ...taskToSummary(t),
      statusLabel: taskRecordStatusLabel(t),
    }));
    const tasks = filterTaskSummaries(rows, q, since, until);
    sendJson(res, 200, { ok: true, tasks }, c);
    return true;
  }

  const taskItemMatch = /^\/api\/tasks\/([^/]+)$/.exec(pathname);
  if (taskItemMatch && req.method === "GET") {
    const taskId = taskItemMatch[1];
    if (!isSafeTaskIdSegment(taskId)) {
      sendJson(res, 400, { ok: false, code: "invalid_task_id", message: "invalid task id" }, c);
      return true;
    }
    const record = readTaskRecord(workspaceDir, taskId);
    if (!record) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "task not found" }, c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        task: { ...taskToSummary(record), statusLabel: taskRecordStatusLabel(record) },
      },
      c,
    );
    return true;
  }

  const sessionLiveMatch = /^\/api\/sessions\/([^/]+)\/live-turn$/.exec(pathname);
  if (sessionLiveMatch && req.method === "GET") {
    const sessionId = sessionLiveMatch[1];
    const progress = getLiveTurnProgress(sessionId);
    sendJson(
      res,
      200,
      progress ? { ok: true, progress } : { ok: true, progress: null, status: "idle" },
      c,
    );
    return true;
  }

  const sessionItemMatch = /^\/api\/sessions\/([^/]+)$/.exec(pathname);

  if (pathname === "/api/sessions" && req.method === "POST") {
    try {
      const body = (await readJsonBody(req)) as {
        assistantId?: unknown;
        matterId?: unknown;
        title?: unknown;
      };
      const assistantId =
        typeof body.assistantId === "string" && body.assistantId.trim()
          ? body.assistantId.trim()
          : DEFAULT_ASSISTANT_ID;
      const matterId =
        typeof body.matterId === "string" && body.matterId.trim() ? body.matterId.trim() : undefined;
      const title =
        typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : undefined;
      const session = createSession({
        workspaceDir,
        matterId,
        actorId: resolveDesktopActorId(),
        assistantId,
        title,
      });
      sendJson(
        res,
        200,
        {
          ok: true,
          sessionId: session.sessionId,
          title: displayChatSessionTitle(session),
        },
        c,
      );
    } catch (e) {
      if (isLawMindHttpError(e)) {
        sendJson(res, e.status, { ok: false, message: e.message }, c);
      } else {
        sendJson(res, 400, { ok: false, message: "invalid_request" }, c);
      }
    }
    return true;
  }

  /** 与 DELETE 等价；桌面端用 POST 避免部分环境下 DELETE 预检失败（Failed to fetch）。 */
  if (pathname === "/api/sessions/delete" && req.method === "POST") {
    let body: { sessionId?: unknown; assistantId?: unknown };
    try {
      body = (await readJsonBody(req)) as { sessionId?: unknown; assistantId?: unknown };
    } catch (e) {
      if (isLawMindHttpError(e)) {
        sendJson(res, e.status, { ok: false, message: e.message }, c);
      } else {
        sendJson(res, 400, { ok: false, message: "invalid_request" }, c);
      }
      return true;
    }
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : "";
    if (!sessionId) {
      sendJson(res, 400, { ok: false, code: "session_id_required", message: "sessionId is required" }, c);
      return true;
    }
    const assistantId =
      typeof body.assistantId === "string" && body.assistantId.trim()
        ? body.assistantId.trim()
        : DEFAULT_ASSISTANT_ID;
    const out = performSessionDelete(workspaceDir, sessionId, assistantId);
    sendJson(res, out.status, out.payload, c);
    return true;
  }

  if (sessionItemMatch && req.method === "GET") {
    const sessionId = sessionItemMatch[1];
    const assistantId = url.searchParams.get("assistantId")?.trim() || DEFAULT_ASSISTANT_ID;
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    if (!sessionMatchesAssistantFilter(session, assistantId)) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        sessionId: session.sessionId,
        title: displayChatSessionTitle(session),
        messages: sessionHistoryToSimpleMessages(session),
      },
      c,
    );
    return true;
  }

  if (sessionItemMatch && req.method === "PATCH") {
    const sessionId = sessionItemMatch[1];
    const assistantId = url.searchParams.get("assistantId")?.trim() || DEFAULT_ASSISTANT_ID;
    let body: { title?: unknown };
    try {
      body = (await readJsonBody(req)) as { title?: unknown };
    } catch (e) {
      if (isLawMindHttpError(e)) {
        sendJson(res, e.status, { ok: false, message: e.message }, c);
      } else {
        sendJson(res, 400, { ok: false, message: "invalid_request" }, c);
      }
      return true;
    }
    const nextTitle = typeof body.title === "string" ? body.title : "";
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    if (!sessionMatchesAssistantFilter(session, assistantId)) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    const updated = renameSession(workspaceDir, sessionId, nextTitle);
    sendJson(
      res,
      200,
      {
        ok: true,
        sessionId,
        title: updated ? displayChatSessionTitle(updated) : displayChatSessionTitle(session),
      },
      c,
    );
    return true;
  }

  if (sessionItemMatch && req.method === "DELETE") {
    const sessionId = sessionItemMatch[1];
    const assistantId = url.searchParams.get("assistantId")?.trim() || DEFAULT_ASSISTANT_ID;
    const out = performSessionDelete(workspaceDir, sessionId, assistantId);
    sendJson(res, out.status, out.payload, c);
    return true;
  }

  if (pathname === "/api/sessions" && req.method === "GET") {
    const assistantFilter = url.searchParams.get("assistantId")?.trim();
    let rows = listSessions(workspaceDir);
    if (assistantFilter) {
      rows = rows.filter((session) => sessionMatchesAssistantFilter(session, assistantFilter));
    }
    const sessions = rows.map((session) => {
      const tail = [...session.conversationHistory]
        .toReversed()
        .find((m) => m.role === "user" || m.role === "assistant");
      const preview =
        typeof tail?.content === "string"
          ? tail.content.replace(/\s+/g, " ").trim().slice(0, 120)
          : "";
      return {
        sessionId: session.sessionId,
        title: displayChatSessionTitle(session),
        matterId: session.matterId,
        assistantId: session.assistantId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        turnCount: session.turns.length,
        lastPreview: preview || undefined,
      };
    });
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
