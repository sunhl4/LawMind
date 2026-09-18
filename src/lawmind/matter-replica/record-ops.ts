/**
 * M1 record pipe — append-only ops log (idempotent by opId).
 */

import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { appendJsonl, readJsonl } from "../adapters/matter-storage/io.js";
import { assertSafeMatterId } from "../adapters/matter-storage/paths.js";
import { opsJsonlPath, replicaRoot } from "./paths.js";
import type { MatterRecordOp, MatterRecordOpKind } from "./types.js";

const opSchema = z.object({
  opId: z.string().min(1),
  matterId: z.string().min(1),
  kind: z.string().min(1),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
  createdAt: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export function newOpId(): string {
  return `op_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

export function listRecordOps(workspaceDir: string, matterId: string): MatterRecordOp[] {
  const rows = readJsonl(opsJsonlPath(workspaceDir, matterId), opSchema);
  return rows.map((r) => ({
    opId: r.opId,
    matterId: r.matterId,
    kind: r.kind as MatterRecordOpKind,
    actorId: r.actorId,
    actorName: r.actorName,
    createdAt: r.createdAt,
    payload: r.payload,
  }));
}

export function appendRecordOp(
  workspaceDir: string,
  input: {
    matterId: string;
    kind: MatterRecordOpKind;
    actorId: string;
    actorName: string;
    payload: Record<string, unknown>;
    opId?: string;
  },
): MatterRecordOp {
  const mid = assertSafeMatterId(input.matterId);
  fs.mkdirSync(replicaRoot(workspaceDir, mid), { recursive: true });
  const op: MatterRecordOp = {
    opId: input.opId ?? newOpId(),
    matterId: mid,
    kind: input.kind,
    actorId: input.actorId,
    actorName: input.actorName,
    createdAt: new Date().toISOString(),
    payload: input.payload,
  };
  // Idempotent: skip if opId already present
  const existing = listRecordOps(workspaceDir, mid);
  if (existing.some((e) => e.opId === op.opId)) {
    return existing.find((e) => e.opId === op.opId)!;
  }
  appendJsonl(opsJsonlPath(workspaceDir, mid), opSchema, op);
  return op;
}

/**
 * Merge remote ops into local log (by opId). Returns how many were newly applied.
 * Does not yet mutate matter.json — that is a follow-on apply step.
 */
export function mergeRemoteOps(
  workspaceDir: string,
  matterId: string,
  remoteOps: MatterRecordOp[],
): { appended: number; total: number } {
  const mid = assertSafeMatterId(matterId);
  const have = new Set(listRecordOps(workspaceDir, mid).map((o) => o.opId));
  let appended = 0;
  for (const op of remoteOps) {
    if (have.has(op.opId)) {
      continue;
    }
    if (op.matterId !== mid) {
      continue;
    }
    appendRecordOp(workspaceDir, {
      matterId: mid,
      kind: op.kind,
      actorId: op.actorId,
      actorName: op.actorName,
      payload: op.payload,
      opId: op.opId,
    });
    have.add(op.opId);
    appended += 1;
  }
  return { appended, total: have.size };
}

export function opsSince(
  workspaceDir: string,
  matterId: string,
  afterOpId?: string,
): MatterRecordOp[] {
  const all = listRecordOps(workspaceDir, matterId);
  if (!afterOpId) {
    return all;
  }
  const idx = all.findIndex((o) => o.opId === afterOpId);
  if (idx < 0) {
    return all;
  }
  return all.slice(idx + 1);
}

/** Snapshot CASE.md into the replica ops log so another machine can see the narrative version. */
export function snapshotCaseMd(
  workspaceDir: string,
  input: { matterId: string; actorId: string; actorName: string },
): MatterRecordOp {
  const mid = assertSafeMatterId(input.matterId);
  const casePath = path.join(workspaceDir, "cases", mid, "CASE.md");
  let body = "";
  try {
    body = fs.existsSync(casePath) ? fs.readFileSync(casePath, "utf8") : "";
  } catch {
    body = "";
  }
  const excerpt = body.slice(0, 8000);
  const sha256 = body.length > 0 ? createHash("sha256").update(body, "utf8").digest("hex") : "";
  return appendRecordOp(workspaceDir, {
    matterId: mid,
    kind: "case_md.snapshot",
    actorId: input.actorId,
    actorName: input.actorName,
    payload: {
      relPath: `cases/${mid}/CASE.md`,
      charCount: body.length,
      excerpt,
      sha256,
      missing: body.length === 0,
    },
  });
}

export type CaseMdReplicaConflict = {
  localSha256: string;
  remoteSha256: string;
  remoteActorName: string;
  remoteCreatedAt: string;
  sidecarRel: string;
};

function caseMdConflictSidecarRel(matterId: string): string {
  return `cases/${matterId}/CASE（冲突摘录）.md`;
}

/**
 * Never overwrite local CASE.md (snapshots are truncated excerpts).
 * If the newest remote snapshot hash differs, park the excerpt beside it.
 */
export function detectAndParkCaseMdConflict(
  workspaceDir: string,
  matterId: string,
): CaseMdReplicaConflict | null {
  const mid = assertSafeMatterId(matterId);
  const casePath = path.join(workspaceDir, "cases", mid, "CASE.md");
  let localBody = "";
  try {
    localBody = fs.existsSync(casePath) ? fs.readFileSync(casePath, "utf8") : "";
  } catch {
    localBody = "";
  }
  const localSha256 =
    localBody.length > 0 ? createHash("sha256").update(localBody, "utf8").digest("hex") : "";
  const snaps = listRecordOps(workspaceDir, mid)
    .filter((op) => op.kind === "case_md.snapshot")
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const diverged = snaps.filter((op) => {
    const sha = typeof op.payload.sha256 === "string" ? op.payload.sha256 : "";
    return sha.length > 0 && sha !== localSha256;
  });
  const latest = diverged.at(-1);
  if (!latest) {
    return null;
  }
  const remoteSha256 = typeof latest.payload.sha256 === "string" ? latest.payload.sha256 : "";
  if (!remoteSha256 || remoteSha256 === localSha256) {
    return null;
  }
  const excerpt = typeof latest.payload.excerpt === "string" ? latest.payload.excerpt : "";
  const sidecarRel = caseMdConflictSidecarRel(mid);
  const sidecarAbs = path.join(workspaceDir, sidecarRel);
  const body = [
    "# 案件叙事冲突摘录",
    "",
    "副本同步**没有**覆盖本机 CASE.md（快照只有摘录）。请人工合并。",
    "",
    `- 对端律师：${latest.actorName}`,
    `- 对端时间：${latest.createdAt}`,
    `- 对端 SHA-256：${remoteSha256}`,
    `- 本机 SHA-256：${localSha256 || "（空文件）"}`,
    "",
    "---",
    "",
    excerpt.trim() || "（对端摘录为空）",
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(sidecarAbs), { recursive: true });
  fs.writeFileSync(sidecarAbs, body, "utf8");
  return {
    localSha256,
    remoteSha256,
    remoteActorName: latest.actorName,
    remoteCreatedAt: latest.createdAt,
    sidecarRel,
  };
}
