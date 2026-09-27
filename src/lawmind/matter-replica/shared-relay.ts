/**
 * 跨机器能看见邀请的前提：两边指向同一个共享文件夹（或案件云）。
 * 本机默认的 replica-cloud 目录不算，邀请码写在那里对方永远找不到。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadMatter, saveMatter } from "../adapters/matter-storage/index.js";
import { evaluateMatterReplicaGate } from "./feature-gate.js";
import { mergeRemoteOps } from "./record-ops.js";
import { createReplicaRelay } from "./relay.js";

export function isCrossMachineRelayReady(workspaceDir: string): boolean {
  const gate = evaluateMatterReplicaGate(workspaceDir);
  return Boolean(gate.sharedRelayDir || gate.cloudEndpoint);
}

export function listFileRelayMatterIds(relayDir: string): string[] {
  if (!relayDir || !fs.existsSync(relayDir)) {
    return [];
  }
  return fs
    .readdirSync(relayDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(relayDir, name, "ops-bundle.json")));
}

function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token.trim().toUpperCase()).digest("hex").slice(0, 16);
}

/**
 * 对方机器上还没有这桩案子。按邀请码指纹把中继里对应案件的 op 拉进本机，
 * 之后 `acceptInviteByToken` 才能重建邀请。
 */
export async function ingestInviteFromSharedRelay(
  workspaceDir: string,
  token: string,
): Promise<boolean> {
  const gate = evaluateMatterReplicaGate(workspaceDir);
  if (!gate.sharedRelayDir) {
    return false;
  }
  const fp = tokenFingerprint(token);
  const relay = createReplicaRelay(workspaceDir);
  for (const matterId of listFileRelayMatterIds(gate.sharedRelayDir)) {
    const ops = await relay.fetchOps(matterId);
    const hit = ops.some((op) => op.kind === "invite.create" && op.payload.tokenFp === fp);
    if (!hit) {
      continue;
    }
    mergeRemoteOps(workspaceDir, matterId, ops);
    return true;
  }
  return false;
}

/** 侧栏只列出有 matter.json 的案子。接受邀请后补一份，同事才能在列表里看见。 */
export function ensureMatterVisible(workspaceDir: string, matterId: string, title: string): void {
  if (loadMatter(workspaceDir, matterId)) {
    return;
  }
  const now = new Date().toISOString();
  saveMatter(workspaceDir, {
    matterId,
    title: title.trim() || matterId,
    status: "active",
    sensitivity: "normal",
    strategyStatus: "draft",
    openQuestionIds: [],
    nextActions: [],
    deadlineIds: [],
    deliverableIds: [],
    queueItemIds: [],
    createdAt: now,
    updatedAt: now,
  });
}
