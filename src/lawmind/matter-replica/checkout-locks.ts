/**
 * Word / material checkout locks — iManage-style "我来改".
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { assertSafeMatterId } from "../adapters/matter-storage/paths.js";
import { resolveReplicaActor } from "./identity.js";
import { assertMemberCapability, ensureMembershipWithOwner, readMembership } from "./membership.js";
import { locksPath, replicaRoot } from "./paths.js";
import { appendRecordOp } from "./record-ops.js";
import type { MatterCheckoutLock } from "./types.js";

const DEFAULT_LOCK_TTL_MS = 8 * 60 * 60 * 1000; // 8h workday

type LocksFile = {
  version: 1;
  locks: MatterCheckoutLock[];
  updatedAt: string;
};

function readLocksFile(workspaceDir: string, matterId: string): LocksFile {
  const p = locksPath(workspaceDir, matterId);
  try {
    if (!fs.existsSync(p)) {
      return { version: 1, locks: [], updatedAt: new Date().toISOString() };
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<LocksFile>;
    if (raw?.version !== 1 || !Array.isArray(raw.locks)) {
      return { version: 1, locks: [], updatedAt: new Date().toISOString() };
    }
    return {
      version: 1,
      locks: raw.locks.filter(
        (l): l is MatterCheckoutLock =>
          !!l &&
          typeof l.lockId === "string" &&
          typeof l.relPath === "string" &&
          typeof l.holderLawyerId === "string",
      ),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return { version: 1, locks: [], updatedAt: new Date().toISOString() };
  }
}

function writeLocksFile(workspaceDir: string, matterId: string, file: LocksFile): void {
  const mid = assertSafeMatterId(matterId);
  fs.mkdirSync(replicaRoot(workspaceDir, mid), { recursive: true });
  writeJsonAtomic(locksPath(workspaceDir, mid), {
    ...file,
    updatedAt: new Date().toISOString(),
  });
}

function normalizeRelPath(relPath: string): string {
  const n = relPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!n || n.includes("..") || n.startsWith("/")) {
    throw new Error("非法材料路径");
  }
  return n;
}

function purgeExpired(locks: MatterCheckoutLock[], now = Date.now()): MatterCheckoutLock[] {
  return locks.filter((l) => Date.parse(l.expiresAt) > now);
}

export function listCheckoutLocks(workspaceDir: string, matterId: string): MatterCheckoutLock[] {
  const file = readLocksFile(workspaceDir, matterId);
  const live = purgeExpired(file.locks);
  if (live.length !== file.locks.length) {
    writeLocksFile(workspaceDir, matterId, {
      version: 1,
      locks: live,
      updatedAt: new Date().toISOString(),
    });
  }
  return live;
}

export function acquireCheckoutLock(
  workspaceDir: string,
  input: {
    matterId: string;
    matterTitle: string;
    relPath: string;
    note?: string;
    ttlMs?: number;
  },
): MatterCheckoutLock {
  const relPath = normalizeRelPath(input.relPath);
  const actor = resolveReplicaActor(workspaceDir);
  if (actor.source === "ephemeral") {
    throw new Error("请先设置你的姓名，再签出文件");
  }
  const membership = ensureMembershipWithOwner(workspaceDir, {
    matterId: input.matterId,
    matterTitle: input.matterTitle,
    ownerLawyerId: actor.lawyerId,
    ownerDisplayName: actor.displayName,
    ownerEmail: actor.email,
  });
  assertMemberCapability(membership, actor.lawyerId, "checkout_docx");

  const live = listCheckoutLocks(workspaceDir, input.matterId);
  const held = live.find((l) => l.relPath === relPath);
  if (held && held.holderLawyerId !== actor.lawyerId) {
    throw new Error(`「${relPath}」正由 ${held.holderDisplayName} 签出，请稍后再试或请对方释放`);
  }
  if (held && held.holderLawyerId === actor.lawyerId) {
    return held;
  }

  const now = Date.now();
  const lock: MatterCheckoutLock = {
    lockId: `lock_${randomBytes(6).toString("hex")}`,
    matterId: assertSafeMatterId(input.matterId),
    relPath,
    holderLawyerId: actor.lawyerId,
    holderDisplayName: actor.displayName,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (input.ttlMs ?? DEFAULT_LOCK_TTL_MS)).toISOString(),
    note: input.note?.trim() || undefined,
  };
  writeLocksFile(workspaceDir, input.matterId, {
    version: 1,
    locks: [...live, lock],
    updatedAt: new Date().toISOString(),
  });
  appendRecordOp(workspaceDir, {
    matterId: input.matterId,
    kind: "lock.acquire",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    payload: { lockId: lock.lockId, relPath, expiresAt: lock.expiresAt },
  });
  return lock;
}

export function releaseCheckoutLock(
  workspaceDir: string,
  matterId: string,
  relPath: string,
  opts?: { force?: boolean },
): void {
  const pathNorm = normalizeRelPath(relPath);
  const actor = resolveReplicaActor(workspaceDir);
  const membership = readMembership(workspaceDir, matterId);
  if (!membership) {
    throw new Error("本案尚未开启成员协作");
  }
  const live = listCheckoutLocks(workspaceDir, matterId);
  const held = live.find((l) => l.relPath === pathNorm);
  if (!held) {
    return;
  }
  if (held.holderLawyerId !== actor.lawyerId) {
    if (!opts?.force) {
      throw new Error(`只有 ${held.holderDisplayName} 或主办可以释放此签出`);
    }
    assertMemberCapability(membership, actor.lawyerId, "manage_members");
  }
  writeLocksFile(workspaceDir, matterId, {
    version: 1,
    locks: live.filter((l) => l.relPath !== pathNorm),
    updatedAt: new Date().toISOString(),
  });
  appendRecordOp(workspaceDir, {
    matterId,
    kind: "lock.release",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    payload: { lockId: held.lockId, relPath: pathNorm, force: opts?.force === true },
  });
}
