/**
 * Optional sync relay — FileRelay for shared folder / later HTTP SaaS.
 * Server never needs plaintext matter bodies for membership ops envelopes.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { evaluateMatterReplicaGate } from "./feature-gate.js";
import { resolveReplicaActor } from "./identity.js";
import { listRecordOps, mergeRemoteOps, snapshotCaseMd } from "./record-ops.js";
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
  if (gate.sharedRelayDir) {
    return new FileReplicaRelay(gate.sharedRelayDir);
  }
  return new NullReplicaRelay();
}

/** Push local ops to relay; pull remote; merge. */
export async function syncMatterRecordPipe(
  workspaceDir: string,
  matterId: string,
): Promise<{ published: number; pulled: number }> {
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
  const local = listRecordOps(workspaceDir, matterId);
  await relay.publishOps(matterId, local);
  const remote = await relay.fetchOps(matterId);
  const { appended } = mergeRemoteOps(workspaceDir, matterId, remote);
  return { published: local.length, pulled: appended };
}
