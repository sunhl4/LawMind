/**
 * Lightweight listing of cases/<id>/materials for the lawyer desk.
 * No SHA hashing — pulse/open-dossier must stay cheap; replica publish still hashes.
 */

import fs from "node:fs";
import path from "node:path";
import { assertSafeMatterId } from "../adapters/matter-storage/paths.js";

export const MATTER_MATERIALS_LIST_CAP = 80;
/** 路径序清单的走查上限（排序前最多收多少份，用于「先排序再截断」）。 */
export const MATTER_MATERIALS_WALK_CEILING = 4000;
export const MATTER_MATERIALS_MAX_FILE_BYTES = 50 * 1024 * 1024;

export type MatterMaterialListing = {
  relPath: string;
  fileName: string;
  size: number;
  updatedAt: string;
};

export function matterMaterialsDir(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", assertSafeMatterId(matterId), "materials");
}

function isSafeRel(rel: string): boolean {
  const n = rel.replace(/\\/g, "/");
  return n.startsWith("materials/") && !n.includes("..") && !n.includes("\0");
}

/** @returns true when the walk stopped because `cap` was hit and more entries may remain. */
function walk(absDir: string, baseAbs: string, out: MatterMaterialListing[], cap: number): boolean {
  if (!fs.existsSync(absDir)) {
    return false;
  }
  if (out.length >= cap) {
    return true;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const ent of entries) {
    if (out.length >= cap) {
      return true;
    }
    if (ent.name.startsWith(".")) {
      continue;
    }
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      if (walk(abs, baseAbs, out, cap)) {
        return true;
      }
      continue;
    }
    if (!ent.isFile()) {
      continue;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.size > MATTER_MATERIALS_MAX_FILE_BYTES) {
      continue;
    }
    const rel = `materials/${path.relative(baseAbs, abs).replace(/\\/g, "/")}`;
    if (!isSafeRel(rel)) {
      continue;
    }
    out.push({
      relPath: rel,
      fileName: path.basename(abs),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    });
  }
  return false;
}

export type MatterMaterialList = {
  files: MatterMaterialListing[];
  /** Files seen past the returned page. Under-counts when `saturated` is true. */
  omitted: number;
  /** Walk hit the ceiling, so more files may exist on disk. */
  saturated: boolean;
};

/**
 * Stat-only listing. Walks up to the ceiling, then sorts, then pages.
 * Recent order used to stop at the first 80 directory entries, so a newer file
 * later in readdir never appeared.
 */
export function inspectMatterMaterialFiles(
  workspaceDir: string,
  matterId: string,
  opts?: { maxFiles?: number; order?: "recent" | "path" },
): MatterMaterialList {
  try {
    const dir = matterMaterialsDir(workspaceDir, matterId);
    const cap = opts?.maxFiles ?? MATTER_MATERIALS_LIST_CAP;
    const byPath = opts?.order === "path";
    const walkCap = Math.max(cap, MATTER_MATERIALS_WALK_CEILING);
    const out: MatterMaterialListing[] = [];
    const saturated = walk(dir, dir, out, walkCap);
    const sorted = byPath
      ? out.toSorted((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
      : out.toSorted(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.relPath.localeCompare(b.relPath),
        );
    return {
      files: sorted.slice(0, cap),
      omitted: Math.max(0, sorted.length - cap),
      saturated,
    };
  } catch {
    return { files: [], omitted: 0, saturated: false };
  }
}

/** Stat-only listing for the dossier 材料 tab. Does not hash file bytes. */
export function listMatterMaterialFiles(
  workspaceDir: string,
  matterId: string,
  opts?: { maxFiles?: number; order?: "recent" | "path" },
): MatterMaterialListing[] {
  return inspectMatterMaterialFiles(workspaceDir, matterId, opts).files;
}
