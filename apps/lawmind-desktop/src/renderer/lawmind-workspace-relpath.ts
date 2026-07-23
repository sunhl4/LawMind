/**
 * Convert an absolute (or already-relative) output path into a workspace-relative path
 * for Electron `openWithSystem({ root: "workspace", path })`.
 */

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
