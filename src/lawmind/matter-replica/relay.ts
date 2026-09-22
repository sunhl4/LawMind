/**
 * Optional sync relay — FileRelay for shared folder / later HTTP SaaS.
 * Server never needs plaintext matter bodies for membership ops envelopes.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { emitCollaborationAudit } from "../audit/collaboration-audit.js";
import { applyRecordOpsToState, type ApplyOpsResult } from "./apply-ops.js";
import { rematerializeCaseMd } from "./case-md-live.js";
import { evaluateMatterReplicaGate } from "./feature-gate.js";
import { HttpReplicaRelay } from "./http-relay.js";
import { resolveReplicaActor } from "./identity.js";
import { publishMemberPublicKey } from "./invites.js";
import { syncMatterMaterialsPipe, type SyncMaterialsResult } from "./materials-relay.js";
import { defaultMatterCloudDataDir } from "./matter-cloud-store.js";
import { readMembership } from "./membership.js";
import {
  detectAndParkCaseMdConflict,
  listRecordOps,
  mergeRemoteOps,
  snapshotCaseMd,
  type CaseMdReplicaConflict,
} from "./record-ops.js";
import type { MatterRecordOp } from "./types.js";

export type ReplicaRelayEnvelope = {
  version: 1;
  matterId: string;
  publishedAt: string;
  ops: MatterRecordOp[];
};

export type MatterReplicaRelay = {
  publishOps(matterId: string, ops: MatterRecordOp[]): Promise<void>;
  fetchOps(matterId: string, afterOpId?: string): Promise<MatterRecordOp[]>;
};

export class NullReplicaRelay implements MatterReplicaRelay {
  async publishOps(): Promise<void> {
    /* local-only */
  }
  async fetchOps(): Promise<MatterRecordOp[]> {
    return [];
  }
}

/**
 * Shared-directory relay: each matter gets `relayDir/<matterId>/ops-bundle.json`.
 * Firms without SaaS can point two LawMind installs at the same synced folder
 * (or a USB export). Not a NAS requirement — only an optional path.
 */
export class FileReplicaRelay implements MatterReplicaRelay {
  constructor(private readonly relayDir: string) {}

  private matterDir(matterId: string): string {
    const safe = matterId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
    return path.join(this.relayDir, safe);
  }

  private bundlePath(matterId: string): string {
    return path.join(this.matterDir(matterId), "ops-bundle.json");
  }

  async publishOps(matterId: string, ops: MatterRecordOp[]): Promise<void> {
    const dir = this.matterDir(matterId);
    fs.mkdirSync(dir, { recursive: true });
    const existing = await this.readBundle(matterId);
    const byId = new Map<string, MatterRecordOp>();
    for (const op of existing) {
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
    writeJsonAtomic(this.bundlePath(matterId), envelope);
  }

  async fetchOps(matterId: string, afterOpId?: string): Promise<MatterRecordOp[]> {
    const all = await this.readBundle(matterId);
    if (!afterOpId) {
      return all;
    }
    const idx = all.findIndex((o) => o.opId === afterOpId);
    return idx < 0 ? all : all.slice(idx + 1);
  }

  private async readBundle(matterId: string): Promise<MatterRecordOp[]> {
    const p = this.bundlePath(matterId);
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
}

export function createReplicaRelay(workspaceDir: string): MatterReplicaRelay {
  const gate = evaluateMatterReplicaGate(workspaceDir);
  if (gate.cloudEndpoint) {
    return new HttpReplicaRelay(gate.cloudEndpoint, fetch, {
      authorization: gate.cloudToken ? `Bearer ${gate.cloudToken}` : undefined,
    });
  }
  const fileRoot =
    gate.sharedRelayDir || gate.cloudDataDir || defaultMatterCloudDataDir(workspaceDir);
  if (gate.enabled) {
    return new FileReplicaRelay(fileRoot);
  }
  if (gate.sharedRelayDir) {
    return new FileReplicaRelay(gate.sharedRelayDir);
  }
  return new NullReplicaRelay();
}

/** Push local ops + materials to relay; pull remote; merge; apply to local state. */
export async function syncMatterRecordPipe(
  workspaceDir: string,
  matterId: string,
): Promise<{
  published: number;
  pulled: number;
  applied: ApplyOpsResult;
  materials: SyncMaterialsResult;
  /** 材料同步失败的原因（null = 成功）。ops 仍可能已同步。 */
  materialsError: string | null;
  caseMdConflict: CaseMdReplicaConflict | null;
}> {
  try {
    const casePath = path.join(workspaceDir, "cases", matterId, "CASE.md");
    if (fs.existsSync(casePath)) {
      const actor = resolveReplicaActor(workspaceDir);
      snapshotCaseMd(workspaceDir, {
        matterId,
        actorId: actor.lawyerId,
        actorName: actor.displayName,
      });
    }
  } catch {
    /* CASE.md snapshot is best-effort before publish */
  }

  const relay = createReplicaRelay(workspaceDir);

  // 先拉 op 并**生效**，再动材料：这样同事刚签出的文件，本轮就能被跳过而不是被覆盖。
  let pulled = 0;
  try {
    const remote = await relay.fetchOps(matterId);
    pulled = mergeRemoteOps(workspaceDir, matterId, remote).appended;
  } catch {
    /* ops 拉取失败不应阻断材料同步 */
  }

  let applied: ApplyOpsResult = {
    locks: 0,
    members: 0,
    matterFields: 0,
    keyRotated: false,
    changed: false,
  };
  try {
    applied = applyRecordOpsToState(workspaceDir, matterId);
  } catch {
    /* apply 失败时保留本机状态，下次同步重投影自愈 */
  }

  // 每次同步都公布本机公钥（幂等）：不能只在「本地邀请」时才发 —— 云邀请路径下
  // 没有 invite.create/accept 的本地动作，而不发公钥就没人能为我封装轮换后的钥匙。
  try {
    if (readMembership(workspaceDir, matterId)) {
      const published = publishMemberPublicKey(workspaceDir, matterId);
      if (published) {
        const actor = resolveReplicaActor(workspaceDir);
        emitCollaborationAudit(workspaceDir, {
          matterId,
          kind: "collab.member_key_published",
          actorId: actor.lawyerId,
          actorName: actor.displayName,
          detail: "公布设备公钥（供密钥分发）",
        });
      }
    }
  } catch {
    /* 公钥发布失败不影响同步 */
  }

  let materials: SyncMaterialsResult = {
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
  };
  // 材料同步一直是最佳努力（不阻断 ops），但**必须把失败说出来**：
  // 早先这里直接吞掉异常，于是「云上传被 400 拒了」在结果里表现为「0 份」，
  // 看起来像「没有材料」而不是「上传失败」—— 排查时极易误判。
  let materialsError: string | null = null;
  try {
    materials = await syncMatterMaterialsPipe(workspaceDir, matterId);
  } catch (err) {
    materialsError = err instanceof Error ? err.message : String(err);
  }

  // 材料同步会产生本轮的 material.put op，所以发布放在最后，一次带上
  const local = listRecordOps(workspaceDir, matterId);
  await relay.publishOps(matterId, local);

  let caseMdConflict: ReturnType<typeof detectAndParkCaseMdConflict> = null;
  try {
    rematerializeCaseMd(workspaceDir, matterId);
    caseMdConflict = detectAndParkCaseMdConflict(workspaceDir, matterId);
  } catch {
    /* conflict park is best-effort */
  }
  // 只在**确有变化**时记审计：每 30 秒一轮的同步不该把审计链灌满心跳。
  const changed =
    pulled > 0 ||
    applied.changed ||
    materials.downloadedFiles > 0 ||
    materials.deletedLocally.length > 0 ||
    materials.conflicts.length > 0;
  if (changed) {
    const actor = resolveReplicaActor(workspaceDir);
    emitCollaborationAudit(workspaceDir, {
      matterId,
      kind: "collab.sync_activity",
      actorId: actor.lawyerId,
      actorName: actor.displayName,
      detail: `拉取 ${pulled} · 生效 签出${applied.locks}/成员${applied.members} · 收材料 ${materials.downloadedFiles}${
        materials.deletedLocally.length ? ` · 删 ${materials.deletedLocally.length}` : ""
      }${materials.conflicts.length ? ` · 冲突 ${materials.conflicts.length}` : ""}`,
    });
  }
  return { published: local.length, pulled, applied, materials, materialsError, caseMdConflict };
}
