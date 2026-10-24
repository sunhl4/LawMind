/**
 * Chat-middle Word preview.
 *
 * GET  /api/word-surface?root=&path=&projectDir=&fileMtime=&proposalAt=
 * POST /api/word-surface/hunks/:hunkId/revise   { taskId, after }
 * POST /api/word-surface/hunks/:hunkId/undo     { taskId }
 * GET/POST/DELETE /api/word-surface/comments…
 * POST /api/word-surface/tracked              { root, path, decision, revId? }
 * POST /api/word-surface/save                  { root, path, paragraphs }
 * POST /api/word-surface/export                 { root, path } or { taskId }
 * POST /api/word-surface/compare                { root, path, otherRoot, otherPath }
 * POST /api/word-surface/table-row              { root, path, tableIndex, afterRowIndex }
 * POST /api/word-surface/export-pdf             { root, path }
 *
 * Save writes the open .docx. Export copies that file as a sibling 审阅稿.
 * Compare writes a sibling *_比较稿.docx with tracked diffs toward the other file.
 * Export-pdf writes a sibling .pdf via LibreOffice when available.
 */

import fsSync from "node:fs";
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
import { decideDocxTrackedRevision } from "../../../src/lawmind/drafts/word-surface-tracked.js";
import { copyDocx, saveParagraphRuns } from "../../../src/lawmind/drafts/word-revision/document.js";
import type { WordRevisionRun } from "../../../src/lawmind/drafts/word-revision/index.js";
import {
  addWordSurfaceComment,
  listWordSurfaceComments,
  removeWordSurfaceComment,
  updateWordSurfaceComment,
} from "../../../src/lawmind/drafts/word-surface-comments.js";
import { readLawyerIdentity } from "../../../src/lawmind/matter-replica/identity.js";
import {
  readRedlineProposal,
  removePendingLawyerHunk,
  revisePendingRedlineHunk,
  summarizeRedline,
} from "../../../src/lawmind/drafts/redline-proposal.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import {
  EXTERNAL_FILE_WRITE_REFUSAL,
  FILE_ROOT_PREFIX,
  readFileGrantFiles,
  resolveFsRoots,
  safeOptionalProjectDir,
  sendJson,
} from "./lawmind-server-helpers.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import type { WordBaselineRoot } from "../../../src/lawmind/artifacts/word-revision-delivery.js";
import {
  exportDirForSource,
  resolveWordBaselineAbs,
} from "../../../src/lawmind/artifacts/word-revision-delivery.js";
import { readDraft } from "../../../src/lawmind/drafts/index.js";

async function captureWordSurfaceLearning(opts: {
  workspaceDir: string;
  taskId: string;
  paragraphs: ReadonlyArray<{ before: string; after: string }>;
}): Promise<void> {
  try {
    const { captureParagraphEditLearning } = await import(
      "../../../src/lawmind/learning/draft-edit-learning.js"
    );
    const draft = readDraft(opts.workspaceDir, opts.taskId);
    await captureParagraphEditLearning({
      workspaceDir: opts.workspaceDir,
      auditDir: path.join(opts.workspaceDir, "audit"),
      taskId: opts.taskId,
      paragraphs: opts.paragraphs,
      ...(draft?.deliverableType ? { deliverableType: draft.deliverableType } : {}),
      ...(draft?.matterId ? { matterId: draft.matterId } : {}),
    });
  } catch {
    /* 学习捕获失败不阻断修订保存 */
  }
}

const reviseSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  after: z.string().max(50_000),
});

const externalRootSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => value === "workspace" || value === "project" || value.startsWith(FILE_ROOT_PREFIX),
    { message: "invalid root" },
  );

const syncSchema = z.object({
  root: externalRootSchema,
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
  moves: z.array(z.string().max(2_000)).max(40).optional(),
});

const lawyerEditSchema = z.object({
  root: externalRootSchema,
  path: z.string().trim().min(1).max(2_000),
  projectDir: z.string().optional(),
  before: z.string().max(50_000),
  after: z.string().max(50_000),
  format: z.enum(["加粗", "倾斜", "下划线"]).optional(),
});

const undoHunkSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
});

const commentCreateSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  anchorText: z.string().trim().min(1).max(2_000),
  body: z.string().max(8_000).optional(),
});

const commentUpdateSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  body: z.string().max(8_000),
});

const trackedSchema = z.object({
  root: externalRootSchema,
  path: z.string().trim().min(1).max(2_000),
  projectDir: z.string().optional(),
  decision: z.enum(["accept", "reject"]),
  revId: z.string().trim().min(1).max(80).optional(),
});

const revisionRunSchema = z.object({
  text: z.string().max(50_000),
  track: z
    .object({
      kind: z.enum(["ins", "del", "moveFrom", "moveTo", "format"]),
      id: z.string().max(80),
      author: z.string().max(80),
      date: z.string().max(80).optional(),
      moveName: z.string().max(80).optional(),
      format: z.string().max(80).optional(),
      disposition: z.enum(["open", "accepted"]).optional(),
    })
    .optional(),
  commentIds: z.array(z.string().max(80)).max(40).optional(),
  mark: z
    .object({
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      underline: z.boolean().optional(),
      fontSizePx: z.number().optional(),
      fontColor: z.string().max(20).optional(),
      fontFamily: z.string().max(200).optional(),
    })
    .optional(),
  /** Opaque `<w:r>…</w:r>` for drawings/fields — written back verbatim. */
  preservedXml: z.string().max(500_000).optional(),
});

const paragraphWriteSchema = z.object({
  sourceIndex: z.number().int().min(0).nullable().optional(),
  runs: z.array(revisionRunSchema).max(4_000),
  pPrInner: z.string().max(50_000).optional(),
});

const paragraphListSchema = z.union([
  z.array(z.array(revisionRunSchema)).max(2_000),
  z.array(paragraphWriteSchema).max(2_000),
]);

const saveSchema = z.object({
  root: externalRootSchema,
  path: z.string().trim().min(1).max(2_000),
  projectDir: z.string().optional(),
  /** Prefer `{ sourceIndex, runs }[]`; bare `runs[][]` still accepted for older clients. */
  paragraphs: paragraphListSchema,
  /** Header / footer / footnote parts keyed by zip path. */
  stories: z
    .array(
      z.object({
        part: z
          .string()
          .regex(/^word\/(?:header\d+|footer\d+|footnotes|endnotes)\.xml$/),
        paragraphs: paragraphListSchema,
      }),
    )
    .max(40)
    .optional(),
  comments: z
    .array(
      z.object({
        commentId: z.string().max(80),
        author: z.string().max(80),
        body: z.string().max(8_000),
        anchorText: z.string().max(2_000).optional(),
        date: z.string().max(80).optional(),
      }),
    )
    .max(400)
    .optional(),
});

const exportCopySchema = z.object({
  taskId: z.string().trim().min(1).max(200).optional(),
  root: externalRootSchema.optional(),
  path: z.string().trim().min(1).max(2_000).optional(),
  projectDir: z.string().optional(),
});

const compareSchema = z.object({
  root: externalRootSchema,
  path: z.string().trim().min(1).max(2_000),
  projectDir: z.string().optional(),
  otherRoot: z.enum(["workspace", "project"]),
  otherPath: z.string().trim().min(1).max(2_000),
});

const tableRowSchema = z.object({
  root: externalRootSchema,
  path: z.string().trim().min(1).max(2_000),
  projectDir: z.string().optional(),
  tableIndex: z.number().int().min(0).max(500),
  afterRowIndex: z.number().int().min(0).max(10_000),
});

const exportPdfSchema = z.object({
  root: externalRootSchema,
  path: z.string().trim().min(1).max(2_000),
  projectDir: z.string().optional(),
});

/**
 * 路由里的 `root` 可能是 `file:<id>`（工作区外、律师显式碰过的文件）。
 *
 * 引擎只认 workspace/project，所以把授权目录当作一次性的 projectDir 交给它；
 * 该目录的读写权限已由主进程登记时核过（存在性 + 拒绝名单）。
 */
function resolveWordRoot(
  ctxWorkspaceDir: string,
  rawRoot: string | null | undefined,
  rawProjectDir?: string | null,
  reqProjectDir?: string | null,
): {
  root: WordBaselineRoot;
  projectDir?: string;
  /** 外部根：只允许操作这一份文件（`body.path` 里塞同目录别的文件名要被拒）。 */
  externalAbs?: string;
} | null {
  const raw = (rawRoot ?? "").trim();
  if (raw === "workspace" || raw === "project") {
    return {
      root: raw,
      projectDir: safeOptionalProjectDir(reqProjectDir ?? rawProjectDir ?? undefined),
    };
  }
  if (!raw.startsWith(FILE_ROOT_PREFIX)) {
    return null;
  }
  const dir = resolveFsRoots(ctxWorkspaceDir)[raw];
  if (!dir) {
    return null;
  }
  const externalAbs = readFileGrantFiles(process.env.LAWMIND_FILE_GRANTS_FILE)[raw];
  return { root: "project", projectDir: dir, ...(externalAbs ? { externalAbs } : {}) };
}

/**
 * 同一守卫的相对路径版本：按 basename 比对（外部根的 rel 就是文件名）。
 *
 * 用于只拿到 snapshot.relPath、拿不到绝对路径的路由（sync / hunks）。
 */
function externalWriteBlockedByRel(
  runRoot: { externalAbs?: string },
  relPath: string,
  res: http.ServerResponse,
  c: Record<string, string>,
): boolean {
  if (!runRoot.externalAbs) {
    return false;
  }
  const rel = relPath.trim().replace(/\\/g, "/");
  const base = path.posix.basename(rel);
  if (!rel.includes("/") && base === path.basename(runRoot.externalAbs)) {
    return false;
  }
  sendJson(
    res,
    403,
    { ok: false, error: "external_file_readonly", message: EXTERNAL_FILE_WRITE_REFUSAL },
    c,
  );
  return true;
}

/**
 * 外部根的**写**入参守卫：`body.path` 必须是授权的那一份文件。
 *
 * 读可以放开（律师可能从正文点到同目录附件），但写不行 —— 否则把 `path` 换成
 * 同目录的 `别人的合同.docx` 就能改别人文件，绕过 fs 桥的精确匹配。
 */
function externalWriteBlocked(
  runRoot: { externalAbs?: string },
  absPath: string,
  res: http.ServerResponse,
  c: Record<string, string>,
): boolean {
  if (!runRoot.externalAbs) {
    return false;
  }
  if (path.resolve(runRoot.externalAbs) === path.resolve(absPath)) {
    return false;
  }
  sendJson(
    res,
    403,
    { ok: false, error: "external_file_readonly", message: EXTERNAL_FILE_WRITE_REFUSAL },
    c,
  );
  return true;
}


const wordSurfaceSource = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/lawmind/drafts/word-surface.ts",
);
const wordSurfaceLayoutSource = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/lawmind/drafts/word-surface-layout.ts",
);
const wordSurfaceTrackedSource = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/lawmind/drafts/word-surface-tracked.ts",
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
    const [surface, layout, tracked] = await Promise.all([
      fs.stat(wordSurfaceSource),
      fs.stat(wordSurfaceLayoutSource),
      fs.stat(wordSurfaceTrackedSource),
    ]);
    return String(
      Math.max(Math.round(surface.mtimeMs), Math.round(layout.mtimeMs), Math.round(tracked.mtimeMs)),
    );
  } catch {
    return "bundled";
  }
}

async function resolveLoadWordSurface(): Promise<LoadWordSurface> {
  if (process.env.LAWMIND_PACKAGED === "1") {
    return loadWordSurfaceStatic;
  }
  try {
    const [surface, layout, tracked] = await Promise.all([
      fs.stat(wordSurfaceSource),
      fs.stat(wordSurfaceLayoutSource),
      fs.stat(wordSurfaceTrackedSource),
    ]);
    const mtimeMs = Math.max(
      Math.round(surface.mtimeMs),
      Math.round(layout.mtimeMs),
      Math.round(tracked.mtimeMs),
    );
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

async function resolveDecideTracked(): Promise<typeof decideDocxTrackedRevision> {
  if (process.env.LAWMIND_PACKAGED === "1") {
    return decideDocxTrackedRevision;
  }
  try {
    const mtime = Math.round((await fs.stat(wordSurfaceTrackedSource)).mtimeMs);
    const imported = (await import(
      `${pathToFileURL(wordSurfaceTrackedSource).href}?mtime=${mtime}`
    )) as { decideDocxTrackedRevision: typeof decideDocxTrackedRevision };
    return imported.decideDocxTrackedRevision;
  } catch {
    return decideDocxTrackedRevision;
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
    const runRoot = resolveWordRoot(
      ctx.workspaceDir,
      url.searchParams.get("root"),
      url.searchParams.get("projectDir"),
    );
    const relPath = (url.searchParams.get("path") ?? "").trim();
    if (!runRoot || !relPath) {
      sendJson(res, 400, { ok: false, error: "invalid_query" }, c);
      return true;
    }
    const { root } = runRoot;
    const seenMtimeRaw = url.searchParams.get("fileMtime");
    const seenProposalAt = url.searchParams.get("proposalAt");
    const seenFileMtime =
      seenMtimeRaw != null && seenMtimeRaw.trim() !== "" ? Number(seenMtimeRaw) : undefined;
    const codeStamp = await wordSurfaceCodeStamp();
    const stampMatches = url.searchParams.get("codeStamp") === codeStamp;
    const loadWordSurface = await resolveLoadWordSurface();
    const loaded = await loadWordSurface({
      workspaceDir: ctx.workspaceDir,
      projectDir: runRoot.projectDir,
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

  if (pathname === "/api/word-surface/tracked" && req.method === "POST") {
    let body: z.infer<typeof trackedSchema>;
    try {
      body = await parseJsonBodyZod(req, trackedSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    const runRoot = resolveWordRoot(ctx.workspaceDir, body.root, body.projectDir);
    if (!runRoot) {
      sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
      return true;
    }
    const { root } = runRoot;
    const found = resolveWordBaselineAbs({
      workspaceDir: ctx.workspaceDir,
      projectDir: runRoot.projectDir,
      raw: body.path,
      preferredRoot: root,
    });
    if (!found || found.root !== root) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    if (externalWriteBlocked(runRoot, found.abs, res, c)) {
      return true;
    }
    const decideTracked = await resolveDecideTracked();
    const decided = await decideTracked({
      absPath: found.abs,
      decision: body.decision,
      ...(body.revId ? { revId: body.revId } : {}),
    });
    if (!decided.ok) {
      sendJson(res, 409, { ok: false, error: decided.error, message: decided.error }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, changed: decided.changed }, c);
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
    const runRoot = resolveWordRoot(ctx.workspaceDir, body.root, body.projectDir);
    if (!runRoot) {
      sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
      return true;
    }
    if (externalWriteBlockedByRel(runRoot, body.path, res, c)) {
      return true;
    }
    const loaded = await loadWordSurfaceStatic({
      workspaceDir: ctx.workspaceDir,
      projectDir: runRoot.projectDir,
      root: runRoot.root,
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
      moves: body.moves,
    });
    if (!synced.ok) {
      sendJson(res, 400, { ok: false, error: synced.error }, c);
      return true;
    }
    const changedParagraphs = body.paragraphs
      .filter((row) => row.baseline.trim() && row.baseline !== row.current)
      .map((row) => ({ before: row.baseline, after: row.current }));
    if (changedParagraphs.length > 0) {
      await captureWordSurfaceLearning({
        workspaceDir: ctx.workspaceDir,
        taskId: synced.taskId,
        paragraphs: changedParagraphs,
      });
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
    const runRoot = resolveWordRoot(ctx.workspaceDir, body.root, body.projectDir, body.projectDir);
    const relPath = body.path.trim();
    if (!runRoot || !relPath) {
      sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
      return true;
    }
    if (externalWriteBlockedByRel(runRoot, relPath, res, c)) {
      return true;
    }
    const loaded = await loadWordSurfaceStatic({
      workspaceDir: ctx.workspaceDir,
      projectDir: runRoot.projectDir,
      root: runRoot.root,
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
      ...(body.format ? { format: body.format } : {}),
    });
    if (!recorded.ok) {
      sendJson(res, 400, { ok: false, error: recorded.error }, c);
      return true;
    }
    await captureWordSurfaceLearning({
      workspaceDir: ctx.workspaceDir,
      taskId: recorded.taskId,
      paragraphs: [{ before: body.before, after: body.after }],
    });
    sendJson(res, 200, { ok: true, taskId: recorded.taskId, hunkId: recorded.hunkId }, c);
    return true;
  }

  const undoMatch = pathname.match(/^\/api\/word-surface\/hunks\/([^/]+)\/undo$/);
  if (undoMatch && req.method === "POST") {
    const hunkId = decodeURIComponent(undoMatch[1] ?? "");
    if (!hunkId || hunkId.length > 200) {
      sendJson(res, 400, { ok: false, error: "invalid_hunk_id" }, c);
      return true;
    }
    let body: z.infer<typeof undoHunkSchema>;
    try {
      body = await parseJsonBodyZod(req, undoHunkSchema);
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
    const removed = removePendingLawyerHunk(ctx.workspaceDir, body.taskId, hunkId);
    if (!removed.ok) {
      const status =
        removed.error === "hunk_not_found" || removed.error === "redline_not_found" ? 404 : 409;
      sendJson(res, status, { ok: false, error: removed.error }, c);
      return true;
    }
    sendJson(
      res,
      200,
      { ok: true, summary: summarizeRedline(removed.proposal), updatedAt: removed.proposal.updatedAt },
      c,
    );
    return true;
  }

  if (pathname === "/api/word-surface/comments" && req.method === "GET") {
    const taskId = (url.searchParams.get("taskId") ?? "").trim();
    if (!isSafeTaskIdSegment(taskId)) {
      sendJson(res, 400, { ok: false, error: "invalid_task_id" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, comments: listWordSurfaceComments(ctx.workspaceDir, taskId) }, c);
    return true;
  }

  if (pathname === "/api/word-surface/comments" && req.method === "POST") {
    let body: z.infer<typeof commentCreateSchema>;
    try {
      body = await parseJsonBodyZod(req, commentCreateSchema);
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
    const author = readLawyerIdentity(ctx.workspaceDir)?.displayName?.trim() || "律师";
    const added = addWordSurfaceComment(ctx.workspaceDir, {
      taskId: body.taskId,
      anchorText: body.anchorText,
      body: body.body?.trim() || "批注",
      author,
    });
    if (!added.ok) {
      sendJson(res, 400, { ok: false, error: added.error }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, comment: added.comment }, c);
    return true;
  }

  const commentMatch = pathname.match(/^\/api\/word-surface\/comments\/([^/]+)$/);
  if (commentMatch && req.method === "POST") {
    const commentId = decodeURIComponent(commentMatch[1] ?? "");
    let body: z.infer<typeof commentUpdateSchema>;
    try {
      body = await parseJsonBodyZod(req, commentUpdateSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    if (!isSafeTaskIdSegment(body.taskId) || !commentId) {
      sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
      return true;
    }
    const updated = updateWordSurfaceComment(ctx.workspaceDir, body.taskId, commentId, body.body);
    if (!updated.ok) {
      sendJson(res, updated.error === "comment_not_found" ? 404 : 400, { ok: false, error: updated.error }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, comment: updated.comment }, c);
    return true;
  }

  if (commentMatch && req.method === "DELETE") {
    const commentId = decodeURIComponent(commentMatch[1] ?? "");
    const taskId = (url.searchParams.get("taskId") ?? "").trim();
    if (!isSafeTaskIdSegment(taskId) || !commentId) {
      sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
      return true;
    }
    const removed = removeWordSurfaceComment(ctx.workspaceDir, taskId, commentId);
    if (!removed.ok) {
      sendJson(res, removed.error === "comment_not_found" ? 404 : 400, { ok: false, error: removed.error }, c);
      return true;
    }
    sendJson(res, 200, { ok: true }, c);
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
    const prior = readRedlineProposal(ctx.workspaceDir, body.taskId)?.hunks.find(
      (h) => h.hunkId === hunkId,
    );
    const revised = revisePendingRedlineHunk(ctx.workspaceDir, body.taskId, hunkId, body.after);
    if (!revised.ok) {
      const status = revised.error === "hunk_not_found" || revised.error === "redline_not_found" ? 404 : 409;
      sendJson(res, status, { ok: false, error: revised.error }, c);
      return true;
    }
    if (prior && prior.after !== body.after) {
      await captureWordSurfaceLearning({
        workspaceDir: ctx.workspaceDir,
        taskId: body.taskId,
        paragraphs: [{ before: prior.after || prior.before, after: body.after }],
      });
    }
    sendJson(
      res,
      200,
      { ok: true, summary: summarizeRedline(revised.proposal), updatedAt: revised.proposal.updatedAt },
      c,
    );
    return true;
  }

  if (pathname === "/api/word-surface/save" && req.method === "POST") {
    let body: z.infer<typeof saveSchema>;
    try {
      body = await parseJsonBodyZod(req, saveSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    const runRoot = resolveWordRoot(ctx.workspaceDir, body.root, body.projectDir);
    if (!runRoot) {
      sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
      return true;
    }
    const { root } = runRoot;
    const found = resolveWordBaselineAbs({
      workspaceDir: ctx.workspaceDir,
      projectDir: runRoot.projectDir,
      raw: body.path,
      preferredRoot: root,
    });
    if (!found || found.root !== root) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    if (externalWriteBlocked(runRoot, found.abs, res, c)) {
      return true;
    }
    const saved = await saveParagraphRuns({
      absPath: found.abs,
      paragraphs: body.paragraphs as
        | WordRevisionRun[][]
        | Array<{ sourceIndex?: number | null; runs: WordRevisionRun[]; pPrInner?: string }>,
      ...(body.stories
        ? {
            stories: body.stories.map((story) => ({
              part: story.part,
              paragraphs: story.paragraphs as
                | WordRevisionRun[][]
                | Array<{
                    sourceIndex?: number | null;
                    runs: WordRevisionRun[];
                    pPrInner?: string;
                  }>,
            })),
          }
        : {}),
      ...(body.comments
        ? {
            comments: body.comments.map((comment) => ({
              commentId: comment.commentId,
              author: comment.author,
              body: comment.body,
              anchorText: comment.anchorText ?? "",
              ...(comment.date ? { date: comment.date } : {}),
            })),
          }
        : {}),
    });
    if (!saved.ok) {
      sendJson(res, 409, { ok: false, error: saved.error, message: saved.error }, c);
      return true;
    }
    sendJson(res, 200, { ok: true }, c);
    return true;
  }

  if (pathname === "/api/word-surface/export-pdf" && req.method === "POST") {
    let body: z.infer<typeof exportPdfSchema>;
    try {
      body = await parseJsonBodyZod(req, exportPdfSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    const runRoot = resolveWordRoot(ctx.workspaceDir, body.root, body.projectDir);
    if (!runRoot) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    const found = resolveWordBaselineAbs({
      workspaceDir: ctx.workspaceDir,
      projectDir: runRoot.projectDir,
      raw: body.path,
      preferredRoot: runRoot.root,
    });
    if (!found || found.root !== runRoot.root) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    // PDF 只读原件（写到工作区导出位置），所以外部根不需要精确匹配守卫。
    const { exportDocxToPdf } = await import("../../../src/lawmind/drafts/docx-export-pdf.js");
    const abort = new AbortController();
    const onClose = () => abort.abort();
    res.once("close", onClose);
    // 原件在工作区外时 PDF 也导到会话工作区的导出位置。
    const pdfOutDir = exportDirForSource({
      workspaceDir: ctx.workspaceDir,
      sourceAbs: found.abs,
    });
    fsSync.mkdirSync(pdfOutDir, { recursive: true });
    let result: Awaited<ReturnType<typeof exportDocxToPdf>>;
    try {
      result = await exportDocxToPdf(found.abs, { signal: abort.signal, outDir: pdfOutDir });
    } finally {
      res.off("close", onClose);
    }
    if (!result.ok) {
      sendJson(res, 400, { ok: false, error: result.error, message: result.error }, c);
      return true;
    }
    // 导出位置可能已不在请求的那个根里（外部原件 → 工作区），按实际落点回相对路径。
    const underWorkspace = path.relative(ctx.workspaceDir, result.outAbs).replace(/\\/g, "/");
    const inWorkspace = !underWorkspace.startsWith("..") && !path.isAbsolute(underWorkspace);
    const outRel = inWorkspace ? underWorkspace : result.outFileName;
    sendJson(
      res,
      200,
      {
        ok: true,
        root: inWorkspace ? "workspace" : body.root,
        path: outRel,
        outputPath: result.outAbs,
        outputFileName: result.outFileName,
        tool: result.tool,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/word-surface/table-row" && req.method === "POST") {
    let body: z.infer<typeof tableRowSchema>;
    try {
      body = await parseJsonBodyZod(req, tableRowSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    const runRoot = resolveWordRoot(ctx.workspaceDir, body.root, body.projectDir);
    if (!runRoot) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    const found = resolveWordBaselineAbs({
      workspaceDir: ctx.workspaceDir,
      projectDir: runRoot.projectDir,
      raw: body.path,
      preferredRoot: runRoot.root,
    });
    if (!found || found.root !== runRoot.root) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    if (externalWriteBlocked(runRoot, found.abs, res, c)) {
      return true;
    }
    try {
      const JSZip = (await import("jszip")).default;
      const { insertEmptyTableRowInXml } = await import(
        "../../../src/lawmind/drafts/word-revision/xml.js"
      );
      const buffer = await fs.readFile(found.abs);
      const zip = await JSZip.loadAsync(buffer);
      const documentXml = await zip.file("word/document.xml")?.async("string");
      if (!documentXml) {
        sendJson(res, 400, { ok: false, error: "no_document" }, c);
        return true;
      }
      const patched = insertEmptyTableRowInXml(documentXml, body.tableIndex, body.afterRowIndex);
      if (!patched.ok) {
        sendJson(res, 400, { ok: false, error: patched.error }, c);
        return true;
      }
      zip.file("word/document.xml", patched.xml);
      const out = await zip.generateAsync({ type: "nodebuffer" });
      const tmp = `${found.abs}.${process.pid}.tmp`;
      await fs.writeFile(tmp, out);
      await fs.rename(tmp, found.abs);
      sendJson(res, 200, { ok: true }, c);
    } catch (err) {
      const message = err instanceof Error ? err.message : "table_row_failed";
      sendJson(res, 400, { ok: false, error: message }, c);
    }
    return true;
  }

  if (pathname === "/api/word-surface/compare" && req.method === "POST") {
    let body: z.infer<typeof compareSchema>;
    try {
      body = await parseJsonBodyZod(req, compareSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    const projectDir = safeOptionalProjectDir(body.projectDir);
    const base = resolveWordBaselineAbs({
      workspaceDir: ctx.workspaceDir,
      projectDir,
      raw: body.path,
      preferredRoot: body.root,
    });
    const other = resolveWordBaselineAbs({
      workspaceDir: ctx.workspaceDir,
      projectDir,
      raw: body.otherPath,
      preferredRoot: body.otherRoot,
    });
    if (!base || base.root !== body.root) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    if (!other || other.root !== body.otherRoot) {
      sendJson(res, 404, { ok: false, error: "other_not_found" }, c);
      return true;
    }
    const { writeDocxCompareCopy } = await import("../../../src/lawmind/drafts/docx-compare.js");
    // 比较稿同样跟着原件走；原件在工作区外时落在会话工作区的导出位置。
    const compareOutDir = exportDirForSource({
      workspaceDir: ctx.workspaceDir,
      sourceAbs: base.abs,
    });
    fsSync.mkdirSync(compareOutDir, { recursive: true });
    const result = await writeDocxCompareCopy({
      baseAbs: base.abs,
      otherAbs: other.abs,
      outAbs: path.join(
        compareOutDir,
        path.basename(base.abs).replace(/\.docx$/i, "_比较稿.docx"),
      ),
    });
    if (!result.ok) {
      sendJson(res, 400, { ok: false, error: result.error, message: result.error }, c);
      return true;
    }
    const relToWorkspace = path.relative(ctx.workspaceDir, result.outAbs).replace(/\\/g, "/");
    const compareInWorkspace =
      !relToWorkspace.startsWith("..") && !path.isAbsolute(relToWorkspace);
    const outRel = compareInWorkspace
      ? relToWorkspace
      : projectDir
        ? path.relative(projectDir, result.outAbs).replace(/\\/g, "/")
        : result.outFileName;
    sendJson(
      res,
      200,
      {
        ok: true,
        root: compareInWorkspace ? "workspace" : body.root,
        path: outRel,
        outputPath: result.outAbs,
        outputFileName: result.outFileName,
        changed: result.changed,
        skippedInserts: result.skippedInserts,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/word-surface/export" && req.method === "POST") {
    let body: z.infer<typeof exportCopySchema>;
    try {
      body = await parseJsonBodyZod(req, exportCopySchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    const runRoot = resolveWordRoot(ctx.workspaceDir, body.root ?? null, body.projectDir);
    if (runRoot && body.path) {
      const found = resolveWordBaselineAbs({
        workspaceDir: ctx.workspaceDir,
        projectDir: runRoot.projectDir,
        raw: body.path,
        preferredRoot: runRoot.root,
      });
      if (!found || found.root !== runRoot.root) {
        sendJson(res, 404, { ok: false, error: "not_found" }, c);
        return true;
      }
      const destName = path.basename(found.abs).replace(/\.docx$/i, "_审阅稿.docx");
      // 副本跟着原件走；原件在工作区外时导到本次会话工作区的导出位置，
      // 不往那个外部目录里新塞文件。
      const destAbs = path.join(
        exportDirForSource({ workspaceDir: ctx.workspaceDir, sourceAbs: found.abs }),
        destName,
      );
      fsSync.mkdirSync(path.dirname(destAbs), { recursive: true });
      const copied = await copyDocx(found.abs, destAbs);
      if (!copied.ok) {
        sendJson(res, 409, { ok: false, error: copied.error, message: copied.error }, c);
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        outputPath: destAbs,
        outputFileName: destName,
        mode: "copy",
        degraded: false,
      }, c);
      return true;
    }
    if (!body.taskId || !isSafeTaskIdSegment(body.taskId)) {
      sendJson(res, 400, { ok: false, error: "invalid_task_id" }, c);
      return true;
    }
    const projectDir = safeOptionalProjectDir(body.projectDir);
    const result = await exportTrackedSiblingForTask({
      workspaceDir: ctx.workspaceDir,
      taskId: body.taskId,
      acceptedOnly: false,
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
            ...(result.trackWarning ? { trackWarning: result.trackWarning } : {}),
          }
        : { ok: false, error: result.error, ...(result.code ? { code: result.code } : {}) },
      c,
    );
    return true;
  }

  return false;
}
