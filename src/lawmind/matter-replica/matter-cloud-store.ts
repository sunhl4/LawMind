/**
 * Matter Cloud store — on-disk ops / manifest / blobs (SaaS MVP backend).
 * Same layout as FileReplicaRelay + FileMaterialsRelay.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import type { MaterialsRelayManifest } from "./materials-relay.js";
import type { ReplicaRelayEnvelope } from "./relay.js";
import type { MatterMaterialEntry, MatterRecordOp } from "./types.js";

/** 目录名清洗规则同时服务删除级联（replica-cloud 随案清理），勿另造副本。 */
export function safeMatterId(matterId: string): string {
  return matterId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

function safeSha(sha256: string): string {
  const safe = sha256.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (safe.length !== 64) {
    throw new Error("invalid blob hash");
  }
  return safe;
}

export class MatterCloudStore {
  constructor(private readonly rootDir: string) {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  matterDir(matterId: string): string {
    return path.join(this.rootDir, safeMatterId(matterId));
  }

  private opsPath(matterId: string): string {
    return path.join(this.matterDir(matterId), "ops-bundle.json");
  }

  private manifestPath(matterId: string): string {
    return path.join(this.matterDir(matterId), "materials-manifest.json");
  }

  private blobPath(matterId: string, sha256: string): string {
    return path.join(this.matterDir(matterId), "blobs", safeSha(sha256));
  }

  readOps(matterId: string): MatterRecordOp[] {
    const p = this.opsPath(matterId);
    try {
      if (!fs.existsSync(p)) {
        return [];
      }
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<ReplicaRelayEnvelope>;
      if (raw?.version !== 1 || !Array.isArray(raw.ops)) {
        return [];
      }
      return raw.ops.filter((o) => o && typeof o.opId === "string");
    } catch {
      return [];
    }
  }

  writeOps(matterId: string, ops: MatterRecordOp[]): ReplicaRelayEnvelope {
    const byId = new Map<string, MatterRecordOp>();
    for (const op of this.readOps(matterId)) {
      byId.set(op.opId, op);
    }
    for (const op of ops) {
      byId.set(op.opId, op);
    }
    const merged = [...byId.values()].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
    const envelope: ReplicaRelayEnvelope = {
      version: 1,
      matterId,
      publishedAt: new Date().toISOString(),
      ops: merged,
    };
    fs.mkdirSync(this.matterDir(matterId), { recursive: true });
    writeJsonAtomic(this.opsPath(matterId), envelope);
    return envelope;
  }

  readManifest(matterId: string): MatterMaterialEntry[] {
    const p = this.manifestPath(matterId);
    try {
      if (!fs.existsSync(p)) {
        return [];
      }
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<MaterialsRelayManifest>;
      if (raw?.version !== 1 || !Array.isArray(raw.files)) {
        return [];
      }
      return raw.files.filter(
        (f): f is MatterMaterialEntry =>
          !!f &&
          typeof f.relPath === "string" &&
          typeof f.sha256 === "string" &&
          typeof f.size === "number",
      );
    } catch {
      return [];
    }
  }

  writeManifest(
    matterId: string,
    files: MatterMaterialEntry[],
    removedRelPaths: string[] = [],
  ): MaterialsRelayManifest {
    const byPath = new Map<string, MatterMaterialEntry>();
    for (const f of this.readManifest(matterId)) {
      byPath.set(f.relPath, f);
    }
    for (const f of files) {
      byPath.set(f.relPath, f);
    }
    for (const rel of removedRelPaths) {
      byPath.delete(rel);
    }
    const envelope: MaterialsRelayManifest = {
      version: 1,
      matterId,
      publishedAt: new Date().toISOString(),
      files: [...byPath.values()].toSorted((a, b) => a.relPath.localeCompare(b.relPath)),
    };
    fs.mkdirSync(this.matterDir(matterId), { recursive: true });
    writeJsonAtomic(this.manifestPath(matterId), envelope);
    return envelope;
  }

  putBlob(matterId: string, sha256: string, bytes: Buffer): { created: boolean } {
    const dest = this.blobPath(matterId, sha256);
    if (fs.existsSync(dest)) {
      return { created: false };
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${Date.now()}`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, dest);
    return { created: true };
  }

  getBlob(matterId: string, sha256: string): Buffer | null {
    try {
      const p = this.blobPath(matterId, sha256);
      if (!fs.existsSync(p)) {
        return null;
      }
      return fs.readFileSync(p);
    } catch {
      return null;
    }
  }
}

/** Default on-disk cloud root inside a workspace (no NAS required for single-host MVP). */
export function defaultMatterCloudDataDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "replica-cloud");
}
