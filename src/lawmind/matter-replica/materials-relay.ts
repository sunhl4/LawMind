/**
 * M2 materials pipe — content-hash sync via FileReplicaRelay blobs.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { evaluateMatterReplicaGate } from "./feature-gate.js";
import { resolveReplicaActor } from "./identity.js";
import {
  isPathLockedByOther,
  publishLocalMaterials,
  readMaterialBytes,
  readMaterialsIndex,
  scanMatterMaterials,
  writeMaterialBytes,
  writeMaterialsIndex,
} from "./materials-blobs.js";
import type { MatterMaterialEntry, MatterMaterialsIndex } from "./types.js";

export type MaterialsRelayManifest = {
  version: 1;
  matterId: string;
  publishedAt: string;
  files: MatterMaterialEntry[];
};

export type MatterMaterialsRelay = {
  putBlob(matterId: string, sha256: string, bytes: Buffer): Promise<void>;
  getBlob(matterId: string, sha256: string): Promise<Buffer | null>;
  publishManifest(matterId: string, files: MatterMaterialEntry[]): Promise<void>;
  fetchManifest(matterId: string): Promise<MatterMaterialEntry[]>;
};

export class NullMaterialsRelay implements MatterMaterialsRelay {
  async putBlob(): Promise<void> {
    /* local-only */
  }
  async getBlob(): Promise<Buffer | null> {
    return null;
  }
  async publishManifest(): Promise<void> {
    /* local-only */
  }
  async fetchManifest(): Promise<MatterMaterialEntry[]> {
    return [];
  }
}

export class FileMaterialsRelay implements MatterMaterialsRelay {
  constructor(private readonly relayDir: string) {}

  private matterDir(matterId: string): string {
    const safe = matterId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
    return path.join(this.relayDir, safe);
  }

  private blobsDir(matterId: string): string {
    return path.join(this.matterDir(matterId), "blobs");
  }

  private blobPath(matterId: string, sha256: string): string {
    const safe = sha256.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
    if (safe.length !== 64) {
      throw new Error("invalid blob hash");
    }
    return path.join(this.blobsDir(matterId), safe);
  }

  private manifestPath(matterId: string): string {
    return path.join(this.matterDir(matterId), "materials-manifest.json");
  }

  async putBlob(matterId: string, sha256: string, bytes: Buffer): Promise<void> {
    const dest = this.blobPath(matterId, sha256);
    if (fs.existsSync(dest)) {
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${Date.now()}`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, dest);
  }

  async getBlob(matterId: string, sha256: string): Promise<Buffer | null> {
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

  async publishManifest(matterId: string, files: MatterMaterialEntry[]): Promise<void> {
    fs.mkdirSync(this.matterDir(matterId), { recursive: true });
    const existing = await this.fetchManifest(matterId);
    const byPath = new Map<string, MatterMaterialEntry>();
    for (const f of existing) {
      byPath.set(f.relPath, f);
    }
    for (const f of files) {
      byPath.set(f.relPath, f);
    }
    // Prefer newer updatedAt on collision
    const merged = [...byPath.values()].toSorted((a, b) => a.relPath.localeCompare(b.relPath));
    const envelope: MaterialsRelayManifest = {
      version: 1,
      matterId,
      publishedAt: new Date().toISOString(),
      files: merged,
    };
    writeJsonAtomic(this.manifestPath(matterId), envelope);
  }

  async fetchManifest(matterId: string): Promise<MatterMaterialEntry[]> {
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
}

export function createMaterialsRelay(workspaceDir: string): MatterMaterialsRelay {
  const gate = evaluateMatterReplicaGate(workspaceDir);
  if (gate.sharedRelayDir) {
    return new FileMaterialsRelay(gate.sharedRelayDir);
  }
  return new NullMaterialsRelay();
}

export type SyncMaterialsResult = {
  publishedFiles: number;
  uploadedBlobs: number;
  downloadedFiles: number;
  skippedLocked: number;
  index: MatterMaterialsIndex | null;
};

/**
 * Scan local materials → upload blobs + manifest → pull missing/changed (respect locks).
 */
export async function syncMatterMaterialsPipe(
  workspaceDir: string,
  matterId: string,
): Promise<SyncMaterialsResult> {
  const actor = resolveReplicaActor(workspaceDir);
  let publishedFiles = 0;
  let uploadedBlobs = 0;
  let downloadedFiles = 0;
  let skippedLocked = 0;

  let index: MatterMaterialsIndex | null = null;
  try {
    const pub = publishLocalMaterials(workspaceDir, matterId);
    index = pub.index;
    publishedFiles = pub.index.files.length;
  } catch {
    // No identity / capability — still try pull-only if we have a prior index
    index = readMaterialsIndex(workspaceDir, matterId);
  }

  const relay = createMaterialsRelay(workspaceDir);
  const localFiles = index?.files ?? scanMatterMaterials(workspaceDir, matterId);

  for (const file of localFiles) {
    const bytes = readMaterialBytes(workspaceDir, matterId, file.relPath);
    if (!bytes) {
      continue;
    }
    await relay.putBlob(matterId, file.sha256, bytes);
    uploadedBlobs += 1;
  }
  if (localFiles.length > 0) {
    await relay.publishManifest(matterId, localFiles);
  }

  const remote = await relay.fetchManifest(matterId);
  const localByPath = new Map(localFiles.map((f) => [f.relPath, f]));
  const nextFiles = [...localFiles];

  for (const remoteFile of remote) {
    const local = localByPath.get(remoteFile.relPath);
    if (local && local.sha256 === remoteFile.sha256) {
      continue;
    }
    if (isPathLockedByOther(workspaceDir, matterId, remoteFile.relPath, actor.lawyerId)) {
      skippedLocked += 1;
      continue;
    }
    const blob = await relay.getBlob(matterId, remoteFile.sha256);
    if (!blob) {
      continue;
    }
    writeMaterialBytes(workspaceDir, matterId, remoteFile.relPath, blob);
    downloadedFiles += 1;
    const idx = nextFiles.findIndex((f) => f.relPath === remoteFile.relPath);
    if (idx >= 0) {
      nextFiles[idx] = remoteFile;
    } else {
      nextFiles.push(remoteFile);
    }
  }

  if (downloadedFiles > 0 || index === null) {
    index = writeMaterialsIndex(workspaceDir, matterId, nextFiles);
  }

  return {
    publishedFiles,
    uploadedBlobs,
    downloadedFiles,
    skippedLocked,
    index,
  };
}
