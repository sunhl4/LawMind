/**
 * Single write/read fence for anything that claims a workspace-relative path.
 * Schema text, MCP, and execute() must all call this — no startsWith prefix check.
 */

import path from "node:path";

export function isPathInsideRoot(root: string, candidate: string): boolean {
  const rootAbs = path.resolve(root);
  const candidateAbs = path.resolve(candidate);
  const rel = path.relative(rootAbs, candidateAbs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export type ResolvedWorkspacePath =
  | { ok: true; abs: string; rel: string }
  | { ok: false; error: "empty" | "escape" };

/**
 * Resolve a claimed workspace-relative (or absolute-under-root) path.
 * Rejects NUL, empty, and any escape outside the workspace root.
 */
export function resolveWorkspaceRelativePath(
  workspaceDir: string,
  raw: string,
): ResolvedWorkspacePath {
  const trimmed = raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^["'`]+|["'`]+$/g, "");
  if (!trimmed || trimmed.includes("\0")) {
    return { ok: false, error: "empty" };
  }
  const root = path.resolve(workspaceDir);
  const abs = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed);
  if (!isPathInsideRoot(root, abs)) {
    return { ok: false, error: "escape" };
  }
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  return { ok: true, abs, rel };
}
