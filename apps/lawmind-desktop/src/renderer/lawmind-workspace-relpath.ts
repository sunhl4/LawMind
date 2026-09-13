/**
 * Convert an absolute (or already-relative) output path into a workspace-relative path
 * for Electron `openWithSystem({ root: "workspace", path })`.
 */

export type WorkspaceOrProjectRoot = "workspace" | "project";

function posixAbs(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Map an absolute disk path onto the workspace or project root. */
export function resolveRelForAbs(
  workspaceDir: string | null | undefined,
  projectDir: string | null | undefined,
  absPath: string,
): { root: WorkspaceOrProjectRoot; rel: string } | null {
  const a = absPath.replace(/\\/g, "/");
  if (!a.trim()) {
    return null;
  }
  const w = workspaceDir ? posixAbs(workspaceDir) : "";
  const p = projectDir ? posixAbs(projectDir) : "";
  if (w && (a === w || a.startsWith(`${w}/`))) {
    return { root: "workspace", rel: a === w ? "" : a.slice(w.length + 1) };
  }
  if (p && (a === p || a.startsWith(`${p}/`))) {
    return { root: "project", rel: a === p ? "" : a.slice(p.length + 1) };
  }
  return null;
}

export function toWorkspaceRelativePath(
  workspaceDir: string | null | undefined,
  outputPath: string | null | undefined,
): string | null {
  const root = (workspaceDir ?? "").trim();
  const out = (outputPath ?? "").trim();
  if (!root || !out) {
    return null;
  }
  const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normOut = out.replace(/\\/g, "/");
  if (!normOut.includes("/") && !normOut.includes("\\")) {
    return normOut;
  }
  if (normOut.startsWith(normRoot + "/")) {
    return normOut.slice(normRoot.length + 1);
  }
  // Already relative (no drive / leading slash for unix abs)
  if (!/^[A-Za-z]:\//.test(normOut) && !normOut.startsWith("/")) {
    return normOut.replace(/^\.\//, "");
  }
  return null;
}
