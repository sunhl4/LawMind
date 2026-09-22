/**
 * M2 materials pipe — content-hash sync via FileReplicaRelay blobs.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { emitCollaborationAudit } from "../audit/collaboration-audit.js";
import { openBytes, sealBytes } from "./crypto-envelope.js";
import { evaluateMatterReplicaGate } from "./feature-gate.js";
import { HttpMaterialsRelay } from "./http-relay.js";
import { conflictSidecarRelPath, lastWriteWinner } from "./last-write.js";
import {
  applyRemoteMaterialRemovals,
  isPathCheckedOut,
  publishLocalMaterials,
  readMaterialBytes,
  readMaterialsIndex,
  scanMatterMaterials,
  writeMaterialBytes,
  writeMaterialsIndex,
} from "./materials-blobs.js";
import { planMaterialChunks, reassembleChunks, hashBuffer } from "./materials-cdc.js";
import { defaultMatterCloudDataDir } from "./matter-cloud-store.js";
import { ensureMatterKey, matterKeyBytes } from "./matter-key.js";
import { readMembership } from "./membership.js";
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
  /** `removedRelPaths` 是墓碑：清单不能只做并集，否则已删材料会被拉回来。 */
  publishManifest(
    matterId: string,
    files: MatterMaterialEntry[],
    removedRelPaths?: string[],
  ): Promise<void>;
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

  async publishManifest(
    matterId: string,
    files: MatterMaterialEntry[],
    removedRelPaths: string[] = [],
  ): Promise<void> {
    fs.mkdirSync(this.matterDir(matterId), { recursive: true });
    const existing = await this.fetchManifest(matterId);
    const byPath = new Map<string, MatterMaterialEntry>();
    for (const f of existing) {
      byPath.set(f.relPath, f);
    }
    // Prefer newer updatedAt on collision
    for (const f of files) {
      const prev = byPath.get(f.relPath);
      if (!prev || lastWriteWinner(prev, f) === f) {
        byPath.set(f.relPath, f);
      }
    }
    for (const rel of removedRelPaths) {
      byPath.delete(rel);
    }
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
  let inner: MatterMaterialsRelay;
  if (gate.cloudEndpoint) {
    inner = new HttpMaterialsRelay(gate.cloudEndpoint, fetch, {
      authorization: gate.cloudToken ? `Bearer ${gate.cloudToken}` : undefined,
    });
  } else if (gate.enabled || gate.sharedRelayDir || gate.cloudDataDir) {
    const fileRoot =
      gate.sharedRelayDir || gate.cloudDataDir || defaultMatterCloudDataDir(workspaceDir);
    inner = new FileMaterialsRelay(fileRoot);
  } else {
    inner = new NullMaterialsRelay();
  }
  return inner;
}

/** Seal/open blob bytes with the matter key when present (always ensure on publish). */
export function wrapMaterialsRelayWithSeal(
  relay: MatterMaterialsRelay,
  key32: Buffer,
): MatterMaterialsRelay {
  return {
    putBlob: async (matterId, sha256, bytes) =>
      relay.putBlob(matterId, sha256, sealBytes(bytes, key32)),
    getBlob: async (matterId, sha256) => {
      const raw = await relay.getBlob(matterId, sha256);
      if (!raw) {
        return null;
      }
      return openBytes(raw, key32);
    },
    publishManifest: (matterId, files, removed) => relay.publishManifest(matterId, files, removed),
    fetchManifest: (matterId) => relay.fetchManifest(matterId),
  };
}

export type SyncMaterialsResult = {
  publishedFiles: number;
  uploadedBlobs: number;
  downloadedFiles: number;
  skippedLocked: number;
  skippedOlderRemote: number;
  /** 本轮因远端墓碑而删除的本机材料（相对路径） */
  deletedLocally: string[];
  /** 本轮因内容哈希不符 / 解封失败而拒收的材料（相对路径） */
  rejectedIntegrity: string[];
  /** 拒收原因（与 rejectedIntegrity 对应，供排障） */
  integrityErrors: string[];
  /** 本轮整体跳过的原因（例如云上材料同步要求成员资格） */
  skippedReason?: string;
  conflicts: Array<{ relPath: string; conflictRelPath: string; winner: "local" | "remote" }>;
  index: MatterMaterialsIndex | null;
};

async function putMaterialFile(
  relay: MatterMaterialsRelay,
  matterId: string,
  bytes: Buffer,
): Promise<{ sha256: string; chunks?: string[] }> {
  const plan = planMaterialChunks(bytes);
  if (plan.chunks.length === 1) {
    await relay.putBlob(matterId, plan.sha256, bytes);
    return { sha256: plan.sha256 };
  }
  for (const c of plan.chunks) {
    await relay.putBlob(matterId, c.sha256, bytes.subarray(c.offset, c.offset + c.size));
  }
  return { sha256: plan.sha256, chunks: plan.chunks.map((c) => c.sha256) };
}

async function getMaterialFile(
  relay: MatterMaterialsRelay,
  matterId: string,
  entry: MatterMaterialEntry,
): Promise<Buffer | null> {
  const chunkHashes = entry.chunks && entry.chunks.length > 1 ? entry.chunks : [entry.sha256];
  if (chunkHashes.length === 1) {
    const bytes = await relay.getBlob(matterId, chunkHashes[0]);
    if (!bytes) {
      return null;
    }
    // 内容寻址的意义就在这里：单块路径以前直接用中继给的字节，不比对 manifest 的 sha256，
    // 于是任何能写中继的人都能把任意字节塞进律师卷宗（差距评审 X5）。
    assertBytesMatchHash(bytes, entry.sha256, entry.relPath);
    return bytes;
  }
  const parts: Buffer[] = [];
  for (const h of chunkHashes) {
    const part = await relay.getBlob(matterId, h);
    if (!part) {
      return null;
    }
    parts.push(part);
  }
  // reassembleChunks 内部已比对整体 sha256
  return reassembleChunks(parts, entry.sha256);
}

/** 内容与 manifest 声明不符即拒收；抛错由调用方记为该文件被拒。 */
function assertBytesMatchHash(bytes: Buffer, expectedSha256: string, relPath: string): void {
  const actual = hashBuffer(bytes);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(
      `材料内容校验失败：${relPath} 期望 ${expectedSha256.slice(0, 12)}… 实得 ${actual.slice(0, 12)}…`,
    );
  }
}

/**
 * Scan local materials → upload blobs + manifest → pull missing/changed (respect locks).
 */
export async function syncMatterMaterialsPipe(
  workspaceDir: string,
  matterId: string,
): Promise<SyncMaterialsResult> {
  let publishedFiles = 0;
  let uploadedBlobs = 0;
  let downloadedFiles = 0;
  let skippedLocked = 0;
  let skippedOlderRemote = 0;
  const conflicts: SyncMaterialsResult["conflicts"] = [];
  const deletedLocally: string[] = [];
  const rejectedIntegrity: string[] = [];
  const integrityErrors: string[] = [];

  // 先落实远端删除：否则本机已删的文件会被中继清单拉回来（本机复活）
  try {
    deletedLocally.push(...applyRemoteMaterialRemovals(workspaceDir, matterId).deleted);
  } catch {
    /* 删除投影失败不阻断同步 */
  }

  let removedRelPaths: string[] = [];
  let index: MatterMaterialsIndex | null = null;
  try {
    const pub = publishLocalMaterials(workspaceDir, matterId);
    index = pub.index;
    publishedFiles = pub.index.files.length;
    removedRelPaths = pub.removed.map((f) => f.relPath);
  } catch {
    // No identity / capability — still try pull-only if we have a prior index
    index = readMaterialsIndex(workspaceDir, matterId);
  }

  const gate = evaluateMatterReplicaGate(workspaceDir);
  let relay = createMaterialsRelay(workspaceDir);
  // Encrypt blobs only for hosted cloud — file shares already trust the shared path.
  if (gate.cloudEndpoint) {
    // 不是本案成员就不在云上放材料：既没有正确钥匙（会各生成一把、互相解不开），
    // 也不该看到别人的密文。成员资格是「云上材料」的前置条件。
    if (!readMembership(workspaceDir, matterId)) {
      return {
        publishedFiles: 0,
        uploadedBlobs: 0,
        downloadedFiles: 0,
        skippedLocked: 0,
        skippedOlderRemote: 0,
        deletedLocally: [],
        rejectedIntegrity: [],
        integrityErrors: [],
        conflicts: [],
        index: null,
        skippedReason: "not_a_member",
      };
    }
    const key = ensureMatterKey(workspaceDir, matterId);
    relay = wrapMaterialsRelayWithSeal(relay, matterKeyBytes(key));
  }
  const localFiles = index?.files ?? scanMatterMaterials(workspaceDir, matterId);
  const publishedEntries: MatterMaterialEntry[] = [];

  for (const file of localFiles) {
    const bytes = readMaterialBytes(workspaceDir, matterId, file.relPath);
    if (!bytes) {
      continue;
    }
    const put = await putMaterialFile(relay, matterId, bytes);
    uploadedBlobs += put.chunks?.length ?? 1;
    publishedEntries.push({
      ...file,
      sha256: put.sha256,
      chunks: put.chunks,
    });
  }
  // 有墓碑时也要发布：清单必须能**变短**，不能只做并集
  if (publishedEntries.length > 0 || removedRelPaths.length > 0) {
    await relay.publishManifest(matterId, publishedEntries, removedRelPaths);
  }

  const remote = await relay.fetchManifest(matterId);
  const localByPath = new Map(localFiles.map((f) => [f.relPath, f]));
  const nextFiles = [...localFiles];

  for (const remoteFile of remote) {
    const local = localByPath.get(remoteFile.relPath);
    if (local && local.sha256 === remoteFile.sha256) {
      continue;
    }
    if (isPathCheckedOut(workspaceDir, matterId, remoteFile.relPath)) {
      skippedLocked += 1;
      continue;
    }
    if (local && local.sha256 !== remoteFile.sha256) {
      const winner = lastWriteWinner(local, remoteFile);
      if (winner === local) {
        skippedOlderRemote += 1;
        continue;
      }
      const taken = new Set(nextFiles.map((f) => f.relPath));
      const sidecarRel = conflictSidecarRelPath(local.relPath, taken);
      const localBytes = readMaterialBytes(workspaceDir, matterId, local.relPath);
      if (localBytes) {
        writeMaterialBytes(workspaceDir, matterId, sidecarRel, localBytes);
        nextFiles.push({
          ...local,
          relPath: sidecarRel,
          fileName: sidecarRel.split("/").pop() ?? sidecarRel,
        });
        conflicts.push({ relPath: local.relPath, conflictRelPath: sidecarRel, winner: "remote" });
        emitCollaborationAudit(workspaceDir, {
          matterId,
          kind: "collab.conflict_parked",
          detail: `冲突旁路：${sidecarRel}`,
        });
      }
    }
    let blob: Buffer | null = null;
    try {
      blob = await getMaterialFile(relay, matterId, remoteFile);
    } catch (err) {
      // 校验失败 / 解封失败：拒收这一份，不阻断其余材料同步
      rejectedIntegrity.push(remoteFile.relPath);
      integrityErrors.push(err instanceof Error ? err.message : String(err));
      emitCollaborationAudit(workspaceDir, {
        matterId,
        kind: "collab.integrity_rejected",
        detail: `拒收 ${remoteFile.relPath}：${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
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
    skippedOlderRemote,
    deletedLocally,
    rejectedIntegrity,
    integrityErrors,
    conflicts,
    index,
  };
}
