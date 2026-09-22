/**
 * Apply 层 —— 把远端 op **真正物化**成本机状态（签出锁 / 成员名册 / 案件字段）。
 *
 * ## 为什么需要它
 *
 * `mergeRemoteOps` 只把 op 追加进本机 `ops.jsonl`；在它能改变本机行为之前，
 * 跨机器协作是空转的：同事的 `lock.acquire` 到了、`locks.json` 却没变，
 * 于是两人仍可能同时改同一份 Word。
 *
 * 本模块是「日志 → 状态」的**投影**，而不是「收到什么就改什么」：
 *
 * - **幂等**：从本机既有状态 + 全量 op 日志重新投影。重复调用结果相同，
 *   中途失败后下次同步会自愈（不需要事务补偿）。
 * - **确定性收敛**：同一路径上多个签出按 `acquiredAt` 早者胜（平局比 `lockId`），
 *   所以两台机器对「谁占着这份文件」会算出同一个答案，而不是各信各的。
 * - **保守**：`invite.accept` 只补不覆盖（不会让已被移出的成员复活）；
 *   改 `matter.json` 只允许白名单字段，且过 `matterSchema` 校验。
 *
 * ## 刻意不做
 *
 * - 不投影 `material.*`（材料状态的真相处在 `materials-index.json`，
 *   由材料管道自己维护，重复投影会与本地扫描打架）。
 * - 不校验 op 签名/来源：中继仍是可信通道。完整性收口见差距评审 G5–G6。
 */

import { loadMatter, matterSchema, saveMatter } from "../adapters/matter-storage/index.js";
import type { MatterRecord } from "../adapters/matter-storage/index.js";
import { assertSafeMatterId } from "../adapters/matter-storage/paths.js";
import { listCheckoutLocks, writeCheckoutLocks } from "./checkout-locks.js";
import { resolveReplicaActor } from "./identity.js";
import { installMatterKey, readMatterKey } from "./matter-key.js";
import {
  readMemberKeyPair,
  unwrapMatterKeyForMember,
  type WrappedMatterKeyForMember,
} from "./member-keys.js";
import { readMembership, revokeMember, upsertMember, writeMembership } from "./membership.js";
import { listRecordOps } from "./record-ops.js";
import {
  MATTER_REPLICA_ROLES,
  roleHasCapability,
  type MatterCheckoutLock,
  type MatterRecordOp,
  type MatterReplicaMember,
  type MatterReplicaMembership,
  type MatterReplicaRole,
} from "./types.js";

/**
 * 允许经 op 跨机器设置的 matter.json 字段。
 *
 * 只收「协作协调类」标量与短数组；`matterId` / 各类 `*Ids` / `parties` / `docket`
 * 不在内 —— 它们要么是身份，要么与本机文件一一对应，远端覆盖会让两侧脱节。
 * `title` 也刻意不在内：改名影响邀请文案与侧栏，应走明确的产品动作。
 */
export const APPLIABLE_MATTER_FIELDS = [
  "status",
  "sensitivity",
  "strategyStatus",
  "ownerLawyerId",
  "primaryAssistantRoleId",
  "counterparty",
  "causeOfAction",
  "matterKind",
  "practiceTags",
  "nextActions",
  "openQuestionIds",
] as const;

export type ApplyOpsResult = {
  /** 投影后本机存活的签出锁数 */
  locks: number;
  /** 投影后本机活跃成员数 */
  members: number;
  /** 实际改动的 matter.json 字段数 */
  matterFields: number;
  /** 本轮是否装上了轮换后的案件密钥 */
  keyRotated: boolean;
  /** 本次投影是否写入了任何本机状态 */
  changed: boolean;
};

function isRole(value: unknown): value is MatterReplicaRole {
  return typeof value === "string" && (MATTER_REPLICA_ROLES as readonly string[]).includes(value);
}

function byCreatedAt(a: MatterRecordOp, b: MatterRecordOp): number {
  const diff = a.createdAt.localeCompare(b.createdAt);
  return diff !== 0 ? diff : a.opId.localeCompare(b.opId);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 从 `lock.acquire` op 还原一条签出记录（不变量：op 自身携带持有者身份）。 */
function lockFromOp(op: MatterRecordOp): MatterCheckoutLock | null {
  const relPath = str(op.payload.relPath);
  const lockId = str(op.payload.lockId);
  const expiresAt = str(op.payload.expiresAt);
  if (!relPath || !lockId || !expiresAt) {
    return null;
  }
  if (relPath.includes("..") || relPath.startsWith("/")) {
    return null;
  }
  const note = str(op.payload.note);
  return {
    lockId,
    matterId: op.matterId,
    relPath,
    holderLawyerId: op.actorId,
    holderDisplayName: op.actorName,
    acquiredAt: op.createdAt,
    expiresAt,
    note: note || undefined,
  };
}

/** 先到者胜 —— 让两台机器对同一路径算出同一个持有者。 */
function earlierLock(a: MatterCheckoutLock, b: MatterCheckoutLock): MatterCheckoutLock {
  const ta = Date.parse(a.acquiredAt);
  const tb = Date.parse(b.acquiredAt);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
    return ta < tb ? a : b;
  }
  return a.lockId <= b.lockId ? a : b;
}

function projectLocks(
  workspaceDir: string,
  matterId: string,
  ops: MatterRecordOp[],
): MatterCheckoutLock[] {
  const byPath = new Map<string, MatterCheckoutLock>();
  // 以本机既有（未过期）签出为底，兼容升级前没有 op 的历史锁
  for (const lock of listCheckoutLocks(workspaceDir, matterId)) {
    byPath.set(lock.relPath, lock);
  }
  for (const op of ops) {
    if (op.kind === "lock.acquire") {
      const lock = lockFromOp(op);
      if (!lock) {
        continue;
      }
      const prev = byPath.get(lock.relPath);
      byPath.set(lock.relPath, prev ? earlierLock(prev, lock) : lock);
      continue;
    }
    if (op.kind === "lock.release") {
      const relPath = str(op.payload.relPath);
      if (relPath) {
        byPath.delete(relPath);
      }
    }
  }
  return [...byPath.values()];
}

function projectMembership(
  workspaceDir: string,
  matterId: string,
  ops: MatterRecordOp[],
): MatterReplicaMembership | null {
  let membership = readMembership(workspaceDir, matterId);
  if (!membership) {
    // 无名册就无从投影：不凭空造一个「主办」，那需要身份信息
    return null;
  }
  for (const op of ops) {
    if (op.kind === "invite.accept") {
      if (membership.members.some((m) => m.lawyerId === op.actorId)) {
        continue;
      }
      const role = op.payload.role;
      if (!isRole(role)) {
        continue;
      }
      const email = str(op.payload.email);
      const member: MatterReplicaMember = {
        lawyerId: op.actorId,
        displayName: op.actorName,
        email: email || undefined,
        role,
        status: "active",
        joinedAt: op.createdAt,
        invitedBy: str(op.payload.invitedBy) || undefined,
      };
      membership = upsertMember(membership, member, op.actorId);
      continue;
    }
    if (op.kind === "member.upsert") {
      const role = op.payload.role;
      const lawyerId = str(op.payload.lawyerId) || op.actorId;
      if (!isRole(role) || !lawyerId) {
        continue;
      }
      const existing = membership.members.find((m) => m.lawyerId === lawyerId);
      const member: MatterReplicaMember = {
        lawyerId,
        displayName: str(op.payload.displayName) || existing?.displayName || op.actorName,
        email: str(op.payload.email) || existing?.email,
        role,
        status: "active",
        joinedAt: existing?.joinedAt ?? op.createdAt,
        invitedBy: existing?.invitedBy,
      };
      membership = upsertMember(membership, member, op.actorId);
      continue;
    }
    if (op.kind === "member.revoke") {
      const lawyerId = str(op.payload.lawyerId);
      const target = membership.members.find((m) => m.lawyerId === lawyerId);
      if (!target || target.status !== "active") {
        continue;
      }
      // 与本地 revokeMember 同一条护栏：不能把案件搞成无主办
      const activeOwners = membership.members.filter(
        (m) => m.role === "owner" && m.status === "active",
      );
      if (target.role === "owner" && activeOwners.length <= 1) {
        continue;
      }
      membership = revokeMember(membership, lawyerId, op.actorId);
    }
  }
  return membership;
}

/**
 * 落实密钥轮换 / 分发：只接受封装给**本机**的那一份（X8）。
 *
 * **权威性检查**：只采信具备 `manage_members` 的成员发出的密钥 op。
 * 否则两个成员各持一把自生成钥匙、各自分发，对端就成了「最后收到的赢」，
 * 而先前的密文是用另一把钥匙封的，会静默读不出来。
 *
 * 判断「是不是更新的一代」用 keyId：重复投影本机自己发出的会因 keyId 相同而跳过。
 */
function applyMatterKeyRotation(
  workspaceDir: string,
  matterId: string,
  ops: MatterRecordOp[],
): boolean {
  const actor = resolveReplicaActor(workspaceDir);
  if (actor.source === "ephemeral") {
    return false;
  }
  const pair = readMemberKeyPair(workspaceDir);
  if (!pair || pair.lawyerId !== actor.lawyerId) {
    return false;
  }
  const membership = readMembership(workspaceDir, matterId);
  let changed = false;
  for (const op of ops) {
    if (op.kind !== "matter_key.rotate") {
      continue;
    }
    // 只有密钥权威（manage_members）能改我的钥匙
    const issuer = membership?.members.find(
      (m) => m.lawyerId === op.actorId && m.status === "active",
    );
    if (!issuer || !roleHasCapability(issuer.role, "manage_members")) {
      continue;
    }
    const wraps = op.payload.wraps;
    if (!wraps || typeof wraps !== "object") {
      continue;
    }
    const mine = (wraps as Record<string, unknown>)[actor.lawyerId];
    if (!mine || typeof mine !== "object") {
      continue;
    }
    const keyId = typeof op.payload.keyId === "string" ? op.payload.keyId : "";
    const current = readMatterKey(workspaceDir, matterId);
    if (keyId && current?.keyId === keyId) {
      continue;
    }
    try {
      const raw = unwrapMatterKeyForMember({
        wrapped: mine as WrappedMatterKeyForMember,
        matterId,
        myPrivateKeyB64: pair.privateKeyB64,
      });
      installMatterKey(
        workspaceDir,
        matterId,
        {
          version: 1,
          keyId: keyId || `mk_${op.opId.slice(-8)}`,
          keyB64: raw.toString("base64"),
          createdAt: op.createdAt,
        },
        "rotation",
      );
      changed = true;
    } catch {
      /* 不是给我的 / 私钥不匹配 —— 跳过 */
    }
  }
  return changed;
}

function projectMatterFields(
  workspaceDir: string,
  matterId: string,
  ops: MatterRecordOp[],
): { matter: MatterRecord | null; changedFields: number } {
  let matter = loadMatter(workspaceDir, matterId);
  if (!matter) {
    return { matter: null, changedFields: 0 };
  }
  let changedFields = 0;
  const allow = new Set<string>(APPLIABLE_MATTER_FIELDS);
  for (const op of ops) {
    if (op.kind !== "matter.field_set") {
      continue;
    }
    const field = str(op.payload.field);
    if (!allow.has(field)) {
      continue;
    }
    const candidate = { ...matter, [field]: op.payload.value } as MatterRecord;
    // 白名单只保证字段名安全；值仍交给 schema，避免把非法枚举写进真相源
    const parsed = matterSchema.safeParse(candidate);
    if (!parsed.success) {
      continue;
    }
    if (
      JSON.stringify(candidate[field as keyof MatterRecord]) !==
      JSON.stringify(matter[field as keyof MatterRecord])
    ) {
      changedFields += 1;
    }
    matter = parsed.data;
  }
  return { matter, changedFields };
}

/**
 * 投影远端 op 到本机状态。应在本机 op 日志已合并远端之后调用。
 * 幂等：重复调用不会重复计入成员，也不会重复建锁。
 */
export function applyRecordOpsToState(workspaceDir: string, matterId: string): ApplyOpsResult {
  const mid = assertSafeMatterId(matterId);
  const ops = listRecordOps(workspaceDir, mid).toSorted(byCreatedAt);

  const before = JSON.stringify(listCheckoutLocks(workspaceDir, mid));
  const locks = projectLocks(workspaceDir, mid, ops);
  const locksChanged =
    JSON.stringify(locks.toSorted((a, b) => a.relPath.localeCompare(b.relPath))) !== before;
  if (locksChanged) {
    writeCheckoutLocks(workspaceDir, mid, locks);
  }

  const membershipBefore = readMembership(workspaceDir, mid);
  const membership = projectMembership(workspaceDir, mid, ops);
  const membershipChanged =
    membership !== null &&
    JSON.stringify(membership.members) !== JSON.stringify(membershipBefore?.members ?? null);
  if (membershipChanged && membership) {
    writeMembership(workspaceDir, membership);
  }

  const { matter, changedFields } = projectMatterFields(workspaceDir, mid, ops);
  if (changedFields > 0 && matter) {
    saveMatter(workspaceDir, matter);
  }

  const rotated = applyMatterKeyRotation(workspaceDir, mid, ops);

  const liveLocks = listCheckoutLocks(workspaceDir, mid);
  const liveMembership = readMembership(workspaceDir, mid);
  return {
    locks: liveLocks.length,
    members: (liveMembership?.members ?? []).filter((m) => m.status === "active").length,
    matterFields: changedFields,
    keyRotated: rotated,
    changed: locksChanged || membershipChanged || changedFields > 0 || rotated,
  };
}
