/**
 * Lightweight listing of cases/<id>/materials for the lawyer desk.
 * No SHA hashing — pulse/open-dossier must stay cheap; replica publish still hashes.
 */

import fs from "node:fs";
import path from "node:path";
import { assertSafeMatterId } from "../adapters/matter-storage/paths.js";

export const MATTER_MATERIALS_LIST_CAP = 80;
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

function walk(absDir: string, baseAbs: string, out: MatterMaterialListing[], cap: number): void {
  if (out.length >= cap || !fs.existsSync(absDir)) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= cap) {
      return;
    }
    if (ent.name.startsWith(".")) {
      continue;
    }
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      walk(abs, baseAbs, out, cap);
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
}

/** Stat-only listing for the dossier 材料 tab. Does not hash file bytes. */
export function listMatterMaterialFiles(
  workspaceDir: string,
  matterId: string,
  opts?: { maxFiles?: number },
): MatterMaterialListing[] {
  try {
    const dir = matterMaterialsDir(workspaceDir, matterId);
    const cap = opts?.maxFiles ?? MATTER_MATERIALS_LIST_CAP;
    const out: MatterMaterialListing[] = [];
    walk(dir, dir, out, cap);
    return out.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}
