/**
 * 对话采信纸。
 *
 *   GET /api/sessions/:sessionId/acceptance-sheet?taskId=
 *   GET /api/acceptance-sheet/locate?path=&root=
 *   GET /api/acceptance-sheet/page?path=&page=&root=
 *   POST /api/drafts/:taskId/acceptance-sheet
 *     { claimId, mark } 或 { restoreRemoved: true }
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadSession } from "../../../src/lawmind/agent/session.js";
import { acceptancePageNumber, relativeMaterialPath } from "../../../src/lawmind/acceptance-sheet/model.js";
import { renderPdfPagePng } from "../../../src/lawmind/acceptance-sheet/pdf-page.js";
import {
  applyAcceptanceMark,
  loadAcceptanceSheet,
  resolveAcceptanceSheet,
  restoreRemovedAcceptanceMarks,
} from "../../../src/lawmind/acceptance-sheet/store.js";
import { fenceAgentFilePath } from "../../../src/lawmind/runtime/workspace-io-fence.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { resolveFsRoots, sendJson } from "./lawmind-server-helpers.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";

const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

const markSchema = z.union([
  z.object({
    claimId: z.string().trim().min(1).max(80),
    mark: z.enum(["accepted", "too_strong", "removed"]).nullable(),
  }),
  z.object({
    restoreRemoved: z.literal(true),
  }),
]);

function isSafeSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id) && !id.includes("..");
}

type MaterialRoot = "workspace" | "project";

type LocatedMaterial =
  | { ok: true; root: MaterialRoot; abs: string }
  | { ok: false; error: "not_found" | "ambiguous_root" };

function locateOne(root: string | undefined, rel: string): string | null {
  if (!root) {
    return null;
  }
  const fenced = fenceAgentFilePath({ rootDir: root, abs: path.resolve(root, rel) });
  if (!fenced.ok) {
    return null;
  }
  try {
    if (!fs.statSync(fenced.abs).isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  return fenced.abs;
}

function locateMaterial(workspaceDir: string, rel: string, preferred: string | null): LocatedMaterial {
  const roots = resolveFsRoots(workspaceDir);
  if (preferred === "workspace" || preferred === "project") {
    const named = locateOne(roots[preferred], rel);
    if (named) {
      return { ok: true, root: preferred, abs: named };
    }
  }
  const hits: Array<{ root: MaterialRoot; abs: string }> = [];
  for (const key of ["workspace", "project"] as const) {
    const abs = locateOne(roots[key], rel);
    if (abs && !hits.some((hit) => hit.abs === abs)) {
      hits.push({ root: key, abs });
    }
  }
  if (hits.length === 1) {
    return { ok: true, root: hits[0].root, abs: hits[0].abs };
  }
  if (hits.length > 1) {
    return { ok: false, error: "ambiguous_root" };
  }
  return { ok: false, error: "not_found" };
}

export async function handleAcceptanceSheetRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const sessionMatch = /^\/api\/sessions\/([^/]+)\/acceptance-sheet$/.exec(pathname);
  if (sessionMatch && req.method === "GET") {
    const sessionId = decodeURIComponent(sessionMatch[1] ?? "");
    if (!isSafeSessionId(sessionId)) {
      sendJson(res, 400, { ok: false, error: "invalid session id" }, c);
      return true;
    }
    if (!loadSession(ctx.workspaceDir, sessionId)) {
      sendJson(res, 404, { ok: false, error: "not found" }, c);
      return true;
    }
    const explicit = url.searchParams.get("taskId")?.trim();
    if (explicit && !isSafeTaskIdSegment(explicit)) {
      sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
      return true;
    }
    const sheet = resolveAcceptanceSheet(ctx.workspaceDir, sessionId, explicit || undefined);
    sendJson(res, 200, { ok: true, sheet }, c);
    return true;
  }

  if (pathname === "/api/acceptance-sheet/locate" && req.method === "GET") {
    const rel = relativeMaterialPath(url.searchParams.get("path") ?? "");
    const root = url.searchParams.get("root");
    if (!rel) {
      sendJson(res, 400, { ok: false, error: "invalid path" }, c);
      return true;
    }
    if (root && root !== "workspace" && root !== "project") {
      sendJson(res, 400, { ok: false, error: "invalid root" }, c);
      return true;
    }
    const located = locateMaterial(ctx.workspaceDir, rel, root);
    if (!located.ok) {
      sendJson(
        res,
        located.error === "ambiguous_root" ? 409 : 404,
        { ok: false, error: located.error },
        c,
      );
      return true;
    }
    sendJson(res, 200, { ok: true, root: located.root }, c);
    return true;
  }

  if (pathname === "/api/acceptance-sheet/page" && req.method === "GET") {
    const rel = relativeMaterialPath(url.searchParams.get("path") ?? "");
    const page = acceptancePageNumber(url.searchParams.get("page") ?? "");
    const root = url.searchParams.get("root");
    if (!rel || !rel.toLowerCase().endsWith(".pdf") || !page) {
      sendJson(res, 400, { ok: false, error: "invalid page request" }, c);
      return true;
    }
    if (root && root !== "workspace" && root !== "project") {
      sendJson(res, 400, { ok: false, error: "invalid root" }, c);
      return true;
    }
    const located = locateMaterial(ctx.workspaceDir, rel, root);
    if (!located.ok) {
      sendJson(
        res,
        located.error === "ambiguous_root" ? 409 : 404,
        { ok: false, error: located.error },
        c,
      );
      return true;
    }
    try {
      const png = await renderPdfPagePng(located.abs, page);
      res.writeHead(200, {
        "content-type": "image/png",
        "cache-control": "private, no-store",
      });
      res.end(png);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "pdf_too_large") {
        sendJson(res, 413, { ok: false, error: "pdf_too_large" }, c);
      } else {
        sendJson(res, 404, { ok: false, error: "page_not_found" }, c);
      }
    }
    return true;
  }

  const markMatch = /^\/api\/drafts\/([^/]+)\/acceptance-sheet$/.exec(pathname);
  if (markMatch && req.method === "GET") {
    const taskId = decodeURIComponent(markMatch[1] ?? "");
    if (!isSafeTaskIdSegment(taskId)) {
      sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, sheet: loadAcceptanceSheet(ctx.workspaceDir, taskId) }, c);
    return true;
  }

  if (markMatch && req.method === "POST") {
    const taskId = decodeURIComponent(markMatch[1] ?? "");
    if (!isSafeTaskIdSegment(taskId)) {
      sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
      return true;
    }
    let body: z.infer<typeof markSchema>;
    try {
      body = await parseJsonBodyZod(req, markSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid body" }, c);
        return true;
      }
      throw err;
    }
    const written =
      "restoreRemoved" in body
        ? restoreRemovedAcceptanceMarks(ctx.workspaceDir, taskId)
        : applyAcceptanceMark(ctx.workspaceDir, taskId, body.claimId, body.mark);
    if (!written.ok) {
      sendJson(
        res,
        written.error === "unknown_claim" ? 400 : 404,
        { ok: false, error: written.error },
        c,
      );
      return true;
    }
    sendJson(res, 200, { ok: true, sheet: written.sheet }, c);
    return true;
  }

  return false;
}
