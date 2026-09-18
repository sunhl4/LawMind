/**
 * M2 material blobs — whole-file content-addressed sync (CDC later).
 * Unit: files under cases/<matterId>/materials/ only.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { assertSafeMatterId } from "../adapters/matter-storage/paths.js";
import { listCheckoutLocks } from "./checkout-locks.js";
import { resolveReplicaActor } from "./identity.js";
import { assertMemberCapability, readMembership } from "./membership.js";
import { materialsIndexPath, replicaRoot } from "./paths.js";
import { appendRecordOp } from "./record-ops.js";
import type { MatterMaterialEntry, MatterMaterialsIndex } from "./types.js";

/** Soft cap per file — commercial safety; large evidence packs stay local until CDC. */
export const MAX_MATERIAL_BLOB_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;

export function materialsDir(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", assertSafeMatterId(matterId), "materials");
}

function isSafeRelUnderMaterials(relFromMatter: string): boolean {
  const n = relFromMatter.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!n.startsWith("materials/")) {
    return false;
  }
  if (n.includes("..") || n.includes("\0")) {
    return false;
  }
  return true;
}

function sha256File(abs: string): { sha256: string; size: number } {
  const buf = fs.readFileSync(abs);
  return {
    sha256: createHash("sha256").update(buf).digest("hex"),
    size: buf.length,
  };
}

function walkMaterials(
  rootAbs: string,
  baseAbs: string,
  out: MatterMaterialEntry[] = [],
): MatterMaterialEntry[] {
  if (out.length >= MAX_FILES) {
    return out;
  }
  if (!fs.existsSync(rootAbs)) {
    return out;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (out.length >= MAX_FILES) {
      break;
    }
    if (ent.name.startsWith(".")) {
      continue;
    }
    const abs = path.join(rootAbs, ent.name);
    if (ent.isDirectory()) {
      walkMaterials(abs, baseAbs, out);
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
    if (stat.size > MAX_MATERIAL_BLOB_BYTES) {
      continue;
    }
    // baseAbs is .../cases/<id>/materials — rel should be materials/...
    const rel = `materials/${path.relative(baseAbs, abs).replace(/\\/g, "/")}`;
    if (!isSafeRelUnderMaterials(rel)) {
      continue;
    }
    try {
      const { sha256, size } = sha256File(abs);
      out.push({
        relPath: rel,
        fileName: path.basename(abs),
        sha256,
        size,
        updatedAt: stat.mtime.toISOString(),
      });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

export function scanMatterMaterials(workspaceDir: string, matterId: string): MatterMaterialEntry[] {
  const mid = assertSafeMatterId(matterId);
  const dir = materialsDir(workspaceDir, mid);
  return walkMaterials(dir, dir);
}

export function readMaterialsIndex(
  workspaceDir: string,
  matterId: string,
): MatterMaterialsIndex | null {
  const p = materialsIndexPath(workspaceDir, matterId);
  try {
    if (!fs.existsSync(p)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<MatterMaterialsIndex>;
    if (raw?.version !== 1 || !Array.isArray(raw.files)) {
      return null;
    }
    return {
      version: 1,
      matterId: typeof raw.matterId === "string" ? raw.matterId : matterId,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
      files: raw.files.filter(
        (f): f is MatterMaterialEntry =>
          !!f &&
          typeof f.relPath === "string" &&
          typeof f.sha256 === "string" &&
          typeof f.size === "number",
      ),
    };
  } catch {
    return null;
  }
}

export function writeMaterialsIndex(
  workspaceDir: string,
  matterId: string,
  files: MatterMaterialEntry[],
): MatterMaterialsIndex {
  const mid = assertSafeMatterId(matterId);
  const next: MatterMaterialsIndex = {
    version: 1,
    matterId: mid,
    updatedAt: new Date().toISOString(),
    files,
  };
  fs.mkdirSync(replicaRoot(workspaceDir, mid), { recursive: true });
  writeJsonAtomic(materialsIndexPath(workspaceDir, mid), next);
  return next;
}

/**
 * Re-scan materials, update local index, append material.put ops for new/changed hashes.
 */
export function publishLocalMaterials(
  workspaceDir: string,
  matterId: string,
): {
  index: MatterMaterialsIndex;
  changed: MatterMaterialEntry[];
} {
  const actor = resolveReplicaActor(workspaceDir);
  const membership = readMembership(workspaceDir, matterId);
  if (membership) {
    assertMemberCapability(membership, actor.lawyerId, "upload_materials");
  } else if (actor.source === "ephemeral") {
    throw new Error("请先设置姓名并开启成员协作");
  }

  const scanned = scanMatterMaterials(workspaceDir, matterId);
  const prev = readMaterialsIndex(workspaceDir, matterId);
  const prevByPath = new Map((prev?.files ?? []).map((f) => [f.relPath, f]));
  const changed: MatterMaterialEntry[] = [];
  for (const file of scanned) {
    const old = prevByPath.get(file.relPath);
    if (!old || old.sha256 !== file.sha256) {
      changed.push(file);
      appendRecordOp(workspaceDir, {
        matterId,
        kind: "material.put",
        actorId: actor.lawyerId,
        actorName: actor.displayName,
        payload: {
          relPath: file.relPath,
          fileName: file.fileName,
          sha256: file.sha256,
          size: file.size,
        },
      });
    }
  }
  // Detect removals
  const nowPaths = new Set(scanned.map((f) => f.relPath));
  for (const old of prev?.files ?? []) {
    if (!nowPaths.has(old.relPath)) {
      appendRecordOp(workspaceDir, {
        matterId,
        kind: "material.remove",
        actorId: actor.lawyerId,
        actorName: actor.displayName,
        payload: { relPath: old.relPath, sha256: old.sha256 },
      });
    }
  }
  const index = writeMaterialsIndex(workspaceDir, matterId, scanned);
  return { index, changed };
}

export function absoluteMaterialPath(
  workspaceDir: string,
  matterId: string,
  relPath: string,
): string {
  if (!isSafeRelUnderMaterials(relPath)) {
    throw new Error("非法材料路径");
  }
  const mid = assertSafeMatterId(matterId);
  return path.join(workspaceDir, "cases", mid, ...relPath.split("/"));
}

export function isPathLockedByOther(
  workspaceDir: string,
  matterId: string,
  relPath: string,
  myLawyerId: string,
): boolean {
  const locks = listCheckoutLocks(workspaceDir, matterId);
  const hit = locks.find((l) => l.relPath === relPath || relPath.startsWith(`${l.relPath}/`));
  return !!hit && hit.holderLawyerId !== myLawyerId;
}

/** Any live checkout on this path — holder is editing; do not pull-overwrite. */
export function isPathCheckedOut(workspaceDir: string, matterId: string, relPath: string): boolean {
  const locks = listCheckoutLocks(workspaceDir, matterId);
  return locks.some((l) => l.relPath === relPath || relPath.startsWith(`${l.relPath}/`));
}

/** Copy file bytes into local materials tree (creates parents). */
export function writeMaterialBytes(
  workspaceDir: string,
  matterId: string,
  relPath: string,
  bytes: Buffer,
): void {
  if (!isSafeRelUnderMaterials(relPath)) {
    throw new Error("非法材料路径");
  }
  if (bytes.length > MAX_MATERIAL_BLOB_BYTES) {
    throw new Error("文件过大，暂不同步（单文件上限 50MB）");
  }
  const abs = absoluteMaterialPath(workspaceDir, matterId, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, abs);
}

export function readMaterialBytes(
  workspaceDir: string,
  matterId: string,
  relPath: string,
): Buffer | null {
  if (!isSafeRelUnderMaterials(relPath)) {
    return null;
  }
  const abs = absoluteMaterialPath(workspaceDir, matterId, relPath);
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return null;
    }
    const stat = fs.statSync(abs);
    if (stat.size > MAX_MATERIAL_BLOB_BYTES) {
      return null;
    }
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}
