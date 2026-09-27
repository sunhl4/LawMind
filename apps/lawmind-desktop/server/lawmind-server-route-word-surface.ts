/**
 * Chat-middle Word preview.
 *
 * GET  /api/word-surface?root=&path=&projectDir=&fileMtime=&proposalAt=
 * POST /api/word-surface/hunks/:hunkId/revise   { taskId, after }
 * POST /api/word-surface/export                 { taskId, projectDir? }
 *
 * Export overwrites the sibling tracked .docx already written for this draft.
 * Only accepted hunks are written. Pending and rejected hunks stay off that
 * file. The original is not modified. This preview is not a signed-off final.
 */

import { z } from "zod";
import { exportTrackedSiblingForTask } from "../../../src/lawmind/drafts/export-tracked-sibling.js";
import { loadWordSurface } from "../../../src/lawmind/drafts/word-surface.js";
import {
  revisePendingRedlineHunk,
  summarizeRedline,
} from "../../../src/lawmind/drafts/redline-proposal.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { safeOptionalProjectDir, sendJson } from "./lawmind-server-helpers.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import type { WordBaselineRoot } from "../../../src/lawmind/artifacts/word-revision-delivery.js";

const reviseSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  after: z.string().max(50_000),
});

const exportSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  projectDir: z.string().optional(),
});

function parseRoot(raw: string | null): WordBaselineRoot | undefined {
  if (raw === "workspace" || raw === "project") {
    return raw;
  }
  return undefined;
}

export async function handleWordSurfaceRoutes({
  ctx,
  req,
  res,
  url,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname === "/api/word-surface" && req.method === "GET") {
    const root = parseRoot(url.searchParams.get("root"));
    const relPath = (url.searchParams.get("path") ?? "").trim();
    if (!root || !relPath) {
      sendJson(res, 400, { ok: false, error: "invalid_query" }, c);
      return true;
    }
    const seenMtimeRaw = url.searchParams.get("fileMtime");
    const seenProposalAt = url.searchParams.get("proposalAt");
    const seenFileMtime =
      seenMtimeRaw != null && seenMtimeRaw.trim() !== "" ? Number(seenMtimeRaw) : undefined;
    const loaded = await loadWordSurface({
      workspaceDir: ctx.workspaceDir,
      projectDir: safeOptionalProjectDir(url.searchParams.get("projectDir")),
      root,
      relPath,
      ...(seenFileMtime != null && Number.isFinite(seenFileMtime) && seenProposalAt != null
        ? { seenFileMtime, seenProposalAt }
        : {}),
    });
    if (!loaded.ok) {
      const status = loaded.error === "not_found" ? 404 : 400;
      sendJson(res, status, { ok: false, error: loaded.error }, c);
      return true;
    }
    if ("unchanged" in loaded) {
      sendJson(res, 200, { ok: true, unchanged: true }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, ...loaded.snapshot }, c);
    return true;
  }

  const reviseMatch = pathname.match(/^\/api\/word-surface\/hunks\/([^/]+)\/revise$/);
  if (reviseMatch && req.method === "POST") {
    const hunkId = decodeURIComponent(reviseMatch[1] ?? "");
    if (!hunkId || hunkId.length > 200) {
      sendJson(res, 400, { ok: false, error: "invalid_hunk_id" }, c);
      return true;
    }
    let body: z.infer<typeof reviseSchema>;
    try {
      body = await parseJsonBodyZod(req, reviseSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    if (!isSafeTaskIdSegment(body.taskId)) {
      sendJson(res, 400, { ok: false, error: "invalid_task_id" }, c);
      return true;
    }
    const revised = revisePendingRedlineHunk(ctx.workspaceDir, body.taskId, hunkId, body.after);
    if (!revised.ok) {
      const status = revised.error === "hunk_not_found" || revised.error === "redline_not_found" ? 404 : 409;
      sendJson(res, status, { ok: false, error: revised.error }, c);
      return true;
    }
    sendJson(
      res,
      200,
      { ok: true, summary: summarizeRedline(revised.proposal), updatedAt: revised.proposal.updatedAt },
      c,
    );
    return true;
  }

  if (pathname === "/api/word-surface/export" && req.method === "POST") {
    let body: z.infer<typeof exportSchema>;
    try {
      body = await parseJsonBodyZod(req, exportSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    if (!isSafeTaskIdSegment(body.taskId)) {
      sendJson(res, 400, { ok: false, error: "invalid_task_id" }, c);
      return true;
    }
    const projectDir = safeOptionalProjectDir(body.projectDir);
    const result = await exportTrackedSiblingForTask({
      workspaceDir: ctx.workspaceDir,
      taskId: body.taskId,
      acceptedOnly: true,
      ...(projectDir ? { projectDir } : {}),
    });
    sendJson(
      res,
      result.ok ? 200 : result.status,
      result.ok
        ? {
            ok: true,
            outputPath: result.outputPath,
            outputFileName: result.outputFileName,
            mode: result.mode,
            degraded: result.degraded,
          }
        : { ok: false, error: result.error, ...(result.code ? { code: result.code } : {}) },
      c,
    );
    return true;
  }

  return false;
}
