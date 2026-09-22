/**
 * Last-write-wins for replica materials + a conflict sidecar for the loser.
 * Not a CRDT: two lawyers editing the same file keep both bytes on disk.
 */

import path from "node:path";

export type HashedStamp = {
  sha256: string;
  updatedAt: string;
};

export function lastWriteWinner<T extends HashedStamp>(a: T, b: T): T {
  const ta = Date.parse(a.updatedAt);
  const tb = Date.parse(b.updatedAt);
  const aOk = Number.isFinite(ta);
  const bOk = Number.isFinite(tb);
  if (aOk && bOk && ta !== tb) {
    return ta >= tb ? a : b;
  }
  if (a.sha256 !== b.sha256) {
    return a.sha256 >= b.sha256 ? a : b;
  }
  return a;
}

/** `materials/合同.docx` → `materials/合同 (冲突).docx` (unique against `taken`). */
export function conflictSidecarRelPath(relPath: string, taken: Set<string>): string {
  const posix = relPath.replace(/\\/g, "/");
  const dir = posix.includes("/") ? posix.slice(0, posix.lastIndexOf("/")) : "";
  const base = posix.includes("/") ? posix.slice(posix.lastIndexOf("/") + 1) : posix;
  const ext = path.posix.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const prefix = dir ? `${dir}/` : "";
  let candidate = `${prefix}${stem} (冲突)${ext}`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${prefix}${stem} (冲突 ${n})${ext}`;
    n += 1;
  }
  return candidate;
}
