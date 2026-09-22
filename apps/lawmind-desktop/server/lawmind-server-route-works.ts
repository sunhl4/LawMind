import { z } from "zod";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import { createAutomationFromWork } from "../../../src/lawmind/platform/automation-from-work.js";
import { isLawyerCapabilityId } from "../../../src/lawmind/skills/lawyer-capability-lock.js";
import {
  createLawyerWork,
  findLawyerWork,
  listLawyerWorks,
  readLawyerWork,
  setLawyerWorkGoal,
} from "../../../src/lawmind/work/index.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

const createWorkSchema = z.object({
  title: z.string().trim().max(200).optional(),
  goal: z.string().trim().max(200).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
  taskId: z.string().trim().min(1).max(128).optional(),
  matterId: z.string().trim().min(1).max(128).optional(),
  source: z.enum(["chat", "mail", "file", "compare", "automation"]).optional(),
  capabilityId: z.string().trim().min(1).max(64).optional(),
});

const goalSchema = z.object({
  goal: z.string().max(200),
});

const fromWorkSchema = z.object({
  workId: z.string().trim().min(1).max(128).optional(),
  taskId: z.string().trim().min(1).max(128).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
  matterId: z.string().trim().min(1).max(128).optional(),
  title: z.string().trim().max(200).optional(),
  goal: z.string().trim().max(200).optional(),
  schedule: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("daily"),
        hour: z.coerce.number().int().min(0).max(23),
        minute: z.coerce.number().int().min(0).max(59),
      }),
      z.object({
        kind: z.literal("weekly"),
        weekday: z.coerce.number().int().min(0).max(6),
        hour: z.coerce.number().int().min(0).max(23),
        minute: z.coerce.number().int().min(0).max(59),
      }),
      z.object({
        kind: z.literal("interval"),
        everyMinutes: z.coerce.number().int().min(5).max(7 * 24 * 60),
      }),
    ])
    .optional(),
});

export async function handleWorksRoutes({
  ctx,
  req,
  res,
  url,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/works" && req.method === "GET") {
    const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
    const works = sessionId
      ? listLawyerWorks(workspaceDir).filter((work) => work.sessionId === sessionId)
      : listLawyerWorks(workspaceDir);
    sendJson(res, 200, { ok: true, works }, c);
    return true;
  }

  if (pathname === "/api/works" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, createWorkSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_work" }, c);
        return true;
      }
      throw err;
    }
    const existing = findLawyerWork(workspaceDir, {
      sessionId: body.sessionId,
      taskId: body.taskId,
    });
    if (existing) {
      if (body.goal !== undefined) {
        setLawyerWorkGoal(workspaceDir, existing.workId, body.goal);
      }
      sendJson(res, 200, { ok: true, work: readLawyerWork(workspaceDir, existing.workId) }, c);
      return true;
    }
    const work = createLawyerWork(workspaceDir, {
      title: body.title || body.goal || "本件",
      goal: body.goal ?? "",
      sessionId: body.sessionId,
      taskId: body.taskId,
      matterId: body.matterId,
      source: body.source ?? "chat",
      status: "open",
      capabilityId: body.capabilityId && isLawyerCapabilityId(body.capabilityId) ? body.capabilityId : undefined,
    });
    if (work.goal) {
      setLawyerWorkGoal(workspaceDir, work.workId, work.goal);
    }
    sendJson(res, 201, { ok: true, work }, c);
    return true;
  }

  if (pathname === "/api/works/automation" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, fromWorkSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    let work = body.workId
      ? readLawyerWork(workspaceDir, body.workId)
      : findLawyerWork(workspaceDir, {
          taskId: body.taskId,
          sessionId: body.sessionId,
        });
    const matterId = body.matterId?.trim() || work?.matterId;
    if (matterId && !isValidMatterId(matterId)) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }
    if (!work) {
      if (!matterId) {
        sendJsonError(res, 400, "work_missing_matter", "先指定案件，才能存成自动办件。", c);
        return true;
      }
      work = createLawyerWork(workspaceDir, {
        title: body.title || body.goal || "本件",
        goal: body.goal ?? body.title ?? "",
        taskId: body.taskId,
        sessionId: body.sessionId,
        matterId,
        source: "chat",
        status: "done",
      });
    }
    try {
      const automation = createAutomationFromWork(workspaceDir, work, {
        matterId,
        schedule: body.schedule,
      });
      sendJson(res, 201, { ok: true, automation, workId: work.workId }, c);
    } catch (err) {
      const code = err instanceof Error ? err.message : "automation_from_work_failed";
      sendJsonError(
        res,
        400,
        code,
        code === "work_missing_matter" ? "先指定案件，才能存成自动办件。" : "无法存成自动办件。",
        c,
      );
    }
    return true;
  }

  const goalMatch = pathname.match(/^\/api\/works\/([^/]+)\/goal$/);
  if (goalMatch && req.method === "POST") {
    const workId = decodeURIComponent(goalMatch[1] ?? "");
    const current = readLawyerWork(workspaceDir, workId);
    if (!current) {
      sendJson(res, 404, { ok: false, error: "work_not_found" }, c);
      return true;
    }
    let body;
    try {
      body = await parseJsonBodyZod(req, goalSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_goal" }, c);
        return true;
      }
      throw err;
    }
    setLawyerWorkGoal(workspaceDir, workId, body.goal);
    sendJson(res, 200, { ok: true, work: readLawyerWork(workspaceDir, workId) }, c);
    return true;
  }

  const oneMatch = pathname.match(/^\/api\/works\/([^/]+)$/);
  if (oneMatch && req.method === "GET") {
    const work = readLawyerWork(workspaceDir, decodeURIComponent(oneMatch[1] ?? ""));
    if (!work) {
      sendJson(res, 404, { ok: false, error: "work_not_found" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, work }, c);
    return true;
  }

  return false;
}
