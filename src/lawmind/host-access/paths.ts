import fs from "node:fs";
import path from "node:path";

export function realpathOrResolve(p: string): string {
  const resolved = path.resolve(p);
  const parts: string[] = [];
  let cursor = resolved;
  while (true) {
    try {
      if (fs.existsSync(cursor)) {
        return path.join(fs.realpathSync(cursor), ...parts.toReversed());
      }
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return resolved;
    }
    parts.push(path.basename(cursor));
    cursor = parent;
  }
}

export function isUnderRoot(root: string, candidate: string): boolean {
  const rootAbs = realpathOrResolve(root);
  const candidateAbs = realpathOrResolve(candidate);
  const rel = path.relative(rootAbs, candidateAbs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function toPosixRel(root: string, abs: string): string {
  return path.relative(path.resolve(root), path.resolve(abs)).replace(/\\/g, "/");
}

export function newHostId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function redactHostPath(abs: string): { displayName: string; parentName: string } {
  return { displayName: path.basename(abs), parentName: path.basename(path.dirname(abs)) };
}
