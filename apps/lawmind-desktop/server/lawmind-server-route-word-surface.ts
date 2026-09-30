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

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { exportTrackedSiblingForTask } from "../../../src/lawmind/drafts/export-tracked-sibling.js";
import { finishWordReviewExport } from "../../../src/lawmind/drafts/word-review.js";
import {
  loadWordSurface as loadWordSurfaceStatic,
  recordLawyerSurfaceEdit,
  syncLawyerSurfaceDocument,
  type WordSurfaceSnapshot,
} from "../../../src/lawmind/drafts/word-surface.js";
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

const syncSchema = z.object({
  root: z.enum(["workspace", "project"]),
  path: z.string().trim().min(1).max(2_000),
  projectDir: z.string().optional(),
  paragraphs: z
    .array(
      z.object({
        baseline: z.string().max(50_000),
        current: z.string().max(50_000),
      }),
    )
    .max(2_000),
});

const lawyerEditSchema = z.object({
  root: z.enum(["workspace", "project"]),
  path: z.string().trim().min(1).max(2_000),
  projectDir: z.string().optional(),
  before: z.string().max(50_000),
  after: z.string().max(50_000),
});

function parseRoot(raw: string | null): WordBaselineRoot | undefined {
  if (raw === "workspace" || raw === "project") {
    return raw;
  }
  return undefined;
}

const wordSurfaceSource = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/lawmind/drafts/word-surface.ts",
);
const wordSurfaceLayoutSource = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/lawmind/drafts/word-surface-layout.ts",
);

type LoadWordSurface = typeof loadWordSurfaceStatic;

let liveLoader: { mtimeMs: number; load: LoadWordSurface } | null = null;

/**
 * Dev preview must follow the extractor on disk. The desktop server process
 * otherwise keeps the first `import` for its whole life, and the page skips
 * work when the docx mtime is unchanged — so a source fix never reaches an
 * already open preview.
 */
async function wordSurfaceCodeStamp(): Promise<string> {
  if (process.env.LAWMIND_PACKAGED === "1") {
    return "bundled";
  }
  try {
    const [surface, layout] = await Promise.all([
      fs.stat(wordSurfaceSource),
      fs.stat(wordSurfaceLayoutSource),
    ]);
    return String(Math.max(Math.round(surface.mtimeMs), Math.round(layout.mtimeMs)));
  } catch {
    return "bundled";
  }
}

async function resolveLoadWordSurface(): Promise<LoadWordSurface> {
  if (process.env.LAWMIND_PACKAGED === "1") {
    return loadWordSurfaceStatic;
  }
  try {
    const [surface, layout] = await Promise.all([
      fs.stat(wordSurfaceSource),
      fs.stat(wordSurfaceLayoutSource),
    ]);
    const mtimeMs = Math.max(Math.round(surface.mtimeMs), Math.round(layout.mtimeMs));
    if (liveLoader?.mtimeMs === mtimeMs) {
      return liveLoader.load;
    }
    const imported = (await import(`${pathToFileURL(wordSurfaceSource).href}?mtime=${mtimeMs}`)) as {
      loadWordSurface: LoadWordSurface;
    };
    liveLoader = { mtimeMs, load: imported.loadWordSurface };
    return imported.loadWordSurface;
  } catch {
    return loadWordSurfaceStatic;
  }
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
    const codeStamp = await wordSurfaceCodeStamp();
    const stampMatches = url.searchParams.get("codeStamp") === codeStamp;
    const loadWordSurface = await resolveLoadWordSurface();
    const loaded = await loadWordSurface({
      workspaceDir: ctx.workspaceDir,
      projectDir: safeOptionalProjectDir(url.searchParams.get("projectDir")),
      root,
      relPath,
      ...(stampMatches &&
      seenFileMtime != null &&
      Number.isFinite(seenFileMtime) &&
      seenProposalAt != null
        ? { seenFileMtime, seenProposalAt }
        : {}),
    });
    if (!loaded.ok) {
      const status = loaded.error === "not_found" ? 404 : 400;
      sendJson(res, status, { ok: false, error: loaded.error }, c);
      return true;
    }
    if ("unchanged" in loaded) {
      sendJson(res, 200, { ok: true, unchanged: true, codeStamp }, c);
      return true;
    }
    const snapshot: WordSurfaceSnapshot = loaded.snapshot;
    sendJson(res, 200, { ok: true, ...snapshot, codeStamp }, c);
    return true;
  }

  if (pathname === "/api/word-surface/sync" && req.method === "POST") {
    let body: z.infer<typeof syncSchema>;
    try {
      body = await parseJsonBodyZod(req, syncSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    const root = parseRoot(body.root);
    if (!root) {
      sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
      return true;
    }
    const loaded = await loadWordSurfaceStatic({
      workspaceDir: ctx.workspaceDir,
      projectDir: safeOptionalProjectDir(body.projectDir),
      root,
      relPath: body.path,
    });
    if (!loaded.ok) {
      const status = loaded.error === "not_found" ? 404 : 400;
      sendJson(res, status, { ok: false, error: loaded.error }, c);
      return true;
    }
    if ("unchanged" in loaded) {
      sendJson(res, 400, { ok: false, error: "unreadable_docx" }, c);
      return true;
    }
    const synced = syncLawyerSurfaceDocument({
      workspaceDir: ctx.workspaceDir,
      relPath: loaded.snapshot.relPath,
      root: loaded.snapshot.root,
      fileName: loaded.snapshot.fileName,
      taskId: loaded.snapshot.taskId,
      paragraphs: body.paragraphs,
    });
    if (!synced.ok) {
      sendJson(res, 400, { ok: false, error: synced.error }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, taskId: synced.taskId, removed: synced.removed, updated: synced.updated }, c);
    return true;
  }

  if (pathname === "/api/word-surface/hunks" && req.method === "POST") {
    let body: z.infer<typeof lawyerEditSchema>;
    try {
      body = await parseJsonBodyZod(req, lawyerEditSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    const root = parseRoot(body.root);
    const relPath = body.path.trim();
    if (!root || !relPath) {
      sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
      return true;
    }
    const loaded = await loadWordSurfaceStatic({
      workspaceDir: ctx.workspaceDir,
      projectDir: safeOptionalProjectDir(body.projectDir),
      root,
      relPath,
    });
    if (!loaded.ok) {
      const status = loaded.error === "not_found" ? 404 : 400;
      sendJson(res, status, { ok: false, error: loaded.error }, c);
      return true;
    }
    if ("unchanged" in loaded) {
      sendJson(res, 400, { ok: false, error: "unreadable_docx" }, c);
      return true;
    }
    const recorded = recordLawyerSurfaceEdit({
      workspaceDir: ctx.workspaceDir,
      relPath: loaded.snapshot.relPath,
      root: loaded.snapshot.root,
      fileName: loaded.snapshot.fileName,
      before: body.before,
      after: body.after,
      taskId: loaded.snapshot.taskId,
    });
    if (!recorded.ok) {
      sendJson(res, 400, { ok: false, error: recorded.error }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, taskId: recorded.taskId, hunkId: recorded.hunkId }, c);
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
    if (result.ok) {
      finishWordReviewExport(ctx.workspaceDir, body.taskId);
    }
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
