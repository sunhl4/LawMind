import fs from "node:fs";
import path from "node:path";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

function safeRelativePath(workspaceDir: string, rel: string): string | null {
  const root = path.resolve(workspaceDir);
  const norm = path.normalize(rel.trim());
  if (norm.startsWith("..") || path.isAbsolute(norm)) {
    return null;
  }
  const full = path.resolve(root, norm);
  const relToRoot = path.relative(root, full);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    return null;
  }
  return full;
}

/**
 * GET /api/memory/source-text?path=MEMORY.md&maxChars=2000
 * Read-only workspace file excerpt for MemoryInspector diff preview.
 */
export function handleMemorySourceTextRoute({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): boolean {
  if (!(pathname === "/api/memory/source-text" && req.method === "GET")) {
    return false;
  }
  const rel = url.searchParams.get("path")?.trim() ?? "";
  if (!rel) {
    sendJson(res, 400, { ok: false, error: "path_required" }, c);
    return true;
  }
  const full = safeRelativePath(ctx.workspaceDir, rel);
  if (!full) {
    sendJson(res, 400, { ok: false, error: "invalid_path" }, c);
    return true;
  }
  try {
    const st = fs.statSync(full);
    if (!st.isFile()) {
      sendJson(res, 404, { ok: false, error: "not_a_file" }, c);
      return true;
    }
    const maxRaw = Number(url.searchParams.get("maxChars") ?? "4000");
    const max = Number.isFinite(maxRaw) ? Math.min(16_000, Math.max(200, Math.floor(maxRaw))) : 4000;
    const raw = fs.readFileSync(full, "utf8");
    const truncated = raw.length > max;
    sendJson(
      res,
      200,
      {
        ok: true,
        path: rel,
        charCount: raw.length,
        truncated,
        text: truncated ? raw.slice(0, max) : raw,
      },
      c,
    );
  } catch {
    sendJson(res, 404, { ok: false, error: "read_failed" }, c);
  }
  return true;
}
