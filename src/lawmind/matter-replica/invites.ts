/**
 * Invite create / accept / revoke — commercial invite codes without requiring firm NAS.
 */

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  appendJsonl,
  listMatterIdsFromStorage,
  readJsonl,
  rewriteJsonl,
} from "../adapters/matter-storage/io.js";
import { assertSafeMatterId } from "../adapters/matter-storage/paths.js";
import { emitCollaborationAudit } from "../audit/collaboration-audit.js";
import { resolveReplicaActor } from "./identity.js";
import {
  unwrapMatterKeyFromInvite,
  wrapMatterKeyForInvite,
  type WrappedMatterKey,
} from "./invite-key-wrap.js";
import {
  ensureMatterKey,
  installMatterKey,
  matterKeyBytes,
  readMatterKey,
  rotateMatterKey,
  type MatterReplicaKey,
} from "./matter-key.js";
import {
  ensureMemberKeyPair,
  memberKeyFingerprint,
  memberPublicKeysFromOps,
  wrapMatterKeyForMember,
} from "./member-keys.js";
import {
  assertMemberCapability,
  ensureMembershipWithOwner,
  findActiveMember,
  readMembership,
  upsertMember,
  writeMembership,
} from "./membership.js";
import { invitesJsonlPath, pendingInviteInboxDir, replicaRoot } from "./paths.js";
import { appendRecordOp, listRecordOps, snapshotCaseMd } from "./record-ops.js";
import {
  MATTER_REPLICA_ROLES,
  roleHasCapability,
  type MatterRecordOp,
  type MatterReplicaInvite,
  type MatterReplicaMember,
  type MatterReplicaRole,
} from "./types.js";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const inviteSchema = z.object({
  inviteId: z.string().min(1),
  matterId: z.string().min(1),
  matterTitle: z.string(),
  token: z.string().min(8),
  email: z.string().min(1),
  role: z.enum(["owner", "lead", "associate", "paralegal", "readonly", "external"]),
  invitedBy: z.string().min(1),
  invitedByName: z.string().min(1),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  createdAt: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().optional(),
  acceptedBy: z.string().optional(),
});

function newInviteId(): string {
  return `inv_${randomBytes(8).toString("hex")}`;
}

/**
 * 公布本机公钥，供密钥轮换时逐人封装（X8）。
 * 同一把公钥只发一次，避免每次同步都长出新 op。
 */
export function publishMemberPublicKey(workspaceDir: string, matterId: string): boolean {
  const actor = resolveReplicaActor(workspaceDir);
  if (actor.source === "ephemeral") {
    return false;
  }
  const pair = ensureMemberKeyPair(workspaceDir, actor.lawyerId);
  const already = listRecordOps(workspaceDir, matterId).some(
    (op) =>
      op.kind === "member.key" &&
      op.actorId === actor.lawyerId &&
      op.payload.publicKeyB64 === pair.publicKeyB64,
  );
  if (already) {
    // 已公布过：返回 false，调用方据此避免重复记审计（同步每轮都会调它）
    return false;
  }
  appendRecordOp(workspaceDir, {
    matterId,
    kind: "member.key",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    payload: {
      publicKeyB64: pair.publicKeyB64,
      fingerprint: memberKeyFingerprint(pair.publicKeyB64),
    },
  });
  return true;
}

/**
 * 把**当前**案件密钥分发给尚未拿到它的在册成员（不轮换）。
 *
 * 为什么需要它：云的邀请由服务端建，所以新成员那边**没有** `matter_key.share` op 可解 ——
 * 他的钥匙从哪来？答案是「主办端在下一轮同步时补发」。这与 X8 的轮换是同一台机器，
 * 区别只是不换钥匙、只补分发；因此走的仍是 `matter_key.rotate` op（带当前 keyId），
 * 对端 apply 时按「keyId 与我现有不同才装」处理，已有该钥匙的成员会被自然跳过。
 *
 * **只有具备 `manage_members` 的角色可以分发**：密钥权威必须是唯一的。
 * 否则两个成员各持一把自生成的钥匙、各自分发，对端就会「最后收到的那个赢」——
 * 而先前的密文是用另一把钥匙封的，会静默变得读不出来。所以：
 * 主办端分发，其他人只接受。
 *
 * **幂等**：已经为每个在册成员分发过当前 keyId 时直接返回，不产生新 op。
 * 否则每轮自动同步都会长出一条 op，日志会被灌满。
 */
export function shareCurrentMatterKeyWithMembers(
  workspaceDir: string,
  matterId: string,
): {
  keyId: string | null;
  sharedFor: string[];
  missingPublicKey: string[];
  alreadyCovered: boolean;
} {
  const mid = assertSafeMatterId(matterId);
  const key = readMatterKey(workspaceDir, mid);
  if (!key) {
    return { keyId: null, sharedFor: [], missingPublicKey: [], alreadyCovered: false };
  }
  const membership = readMembership(workspaceDir, mid);
  if (!membership) {
    return { keyId: key.keyId, sharedFor: [], missingPublicKey: [], alreadyCovered: false };
  }
  const actor = resolveReplicaActor(workspaceDir);
  const me = membership.members.find((m) => m.lawyerId === actor.lawyerId && m.status === "active");
  if (!me || !roleHasCapability(me.role, "manage_members")) {
    // 非密钥权威：保持沉默，等主办端分发
    return { keyId: key.keyId, sharedFor: [], missingPublicKey: [], alreadyCovered: false };
  }
  const ops = listRecordOps(workspaceDir, mid);
  const publicKeys = memberPublicKeysFromOps(ops);

  // 已经分发过当前 keyId 的对象
  const covered = new Set<string>();
  for (const op of ops) {
    if (op.kind !== "matter_key.rotate" || op.payload.keyId !== key.keyId) {
      continue;
    }
    const wraps = op.payload.wraps;
    if (wraps && typeof wraps === "object") {
      for (const lawyerId of Object.keys(wraps as Record<string, unknown>)) {
        covered.add(lawyerId);
      }
    }
  }

  const targets = (membership.members ?? []).filter(
    (m) => m.status === "active" && m.role !== "external" && !covered.has(m.lawyerId),
  );
  if (targets.length === 0) {
    return { keyId: key.keyId, sharedFor: [], missingPublicKey: [], alreadyCovered: true };
  }

  const keyBytes = matterKeyBytes(key);
  const wraps: Record<string, unknown> = {};
  const sharedFor: string[] = [];
  const missingPublicKey: string[] = [];
  for (const member of targets) {
    const pub =
      publicKeys.get(member.lawyerId) ??
      (member.lawyerId === actor.lawyerId
        ? ensureMemberKeyPair(workspaceDir, actor.lawyerId).publicKeyB64
        : undefined);
    if (!pub) {
      // 对方还没公布公钥（老客户端 / 尚未同步）—— 记下来，下轮再试
      missingPublicKey.push(member.lawyerId);
      continue;
    }
    wraps[member.lawyerId] = wrapMatterKeyForMember({
      matterKeyBytes: keyBytes,
      matterId: mid,
      forLawyerId: member.lawyerId,
      recipientPublicKeyB64: pub,
    });
    sharedFor.push(member.lawyerId);
  }

  if (sharedFor.length > 0) {
    appendRecordOp(workspaceDir, {
      matterId: mid,
      kind: "matter_key.rotate",
      actorId: actor.lawyerId,
      actorName: actor.displayName,
      payload: { keyId: key.keyId, wraps, wrappedFor: sharedFor, distributed: true },
    });
    emitCollaborationAudit(workspaceDir, {
      matterId: mid,
      kind: "collab.key_distributed",
      actorId: actor.lawyerId,
      actorName: actor.displayName,
      detail: `向 ${sharedFor.length} 位成员补发当前密钥`,
    });
  }
  return { keyId: key.keyId, sharedFor, missingPublicKey, alreadyCovered: false };
}

/**
 * 轮换案件密钥并逐人封装给**仍在册且已公布公钥**的成员（含自己）。
 *
 * 返回被跳过的成员（尚未公布公钥的老客户端）：他们的钥匙换不了，
 * 所以轮换后读不到新内容 —— 安全上宁可如此，但要把名单记进 op 便于排障。
 */
export function rotateAndShareMatterKey(
  workspaceDir: string,
  matterId: string,
): { keyId: string; wrappedFor: string[]; skipped: string[] } {
  const mid = assertSafeMatterId(matterId);
  const membership = readMembership(workspaceDir, mid);
  const actor = resolveReplicaActor(workspaceDir);
  const ops = listRecordOps(workspaceDir, mid);
  const publicKeys = memberPublicKeysFromOps(ops);

  const next = rotateMatterKey(workspaceDir, mid);
  const keyBytes = matterKeyBytes(next);
  const wraps: Record<string, unknown> = {};
  const wrappedFor: string[] = [];
  const skipped: string[] = [];

  for (const member of membership?.members ?? []) {
    if (member.status !== "active" || member.role === "external") {
      continue;
    }
    const pub = publicKeys.get(member.lawyerId);
    if (!pub) {
      // 自己可以用本机公钥兜底（首次轮换时可能还没发过 member.key）
      if (member.lawyerId === actor.lawyerId) {
        const mine = ensureMemberKeyPair(workspaceDir, actor.lawyerId);
        wraps[member.lawyerId] = wrapMatterKeyForMember({
          matterKeyBytes: keyBytes,
          matterId: mid,
          forLawyerId: member.lawyerId,
          recipientPublicKeyB64: mine.publicKeyB64,
        });
        wrappedFor.push(member.lawyerId);
        continue;
      }
      skipped.push(member.lawyerId);
      continue;
    }
    wraps[member.lawyerId] = wrapMatterKeyForMember({
      matterKeyBytes: keyBytes,
      matterId: mid,
      forLawyerId: member.lawyerId,
      recipientPublicKeyB64: pub,
    });
    wrappedFor.push(member.lawyerId);
  }

  appendRecordOp(workspaceDir, {
    matterId: mid,
    kind: "matter_key.rotate",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    payload: { keyId: next.keyId, wraps, wrappedFor, skipped },
  });
  emitCollaborationAudit(workspaceDir, {
    matterId: mid,
    kind: "collab.key_rotated",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    detail: `轮换案件密钥（发给 ${wrappedFor.length} 人，跳过 ${skipped.length} 人）`,
  });
  // 旧快照是用旧钥匙封的，轮换后对端解不开；立刻用新钥匙重打一份摘要
  try {
    snapshotCaseMd(workspaceDir, {
      matterId: mid,
      actorId: actor.lawyerId,
      actorName: actor.displayName,
    });
  } catch {
    /* 摘要重打失败不影响轮换 */
  }
  return { keyId: next.keyId, wrappedFor, skipped };
}

function newToken(): string {
  // Human-shareable: LAWMIND-XXXX-XXXX style
  const raw = randomBytes(8).toString("hex").toUpperCase();
  return `LM-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token.trim().toUpperCase()).digest("hex").slice(0, 16);
}

function isRole(value: unknown): value is MatterReplicaRole {
  return typeof value === "string" && (MATTER_REPLICA_ROLES as readonly string[]).includes(value);
}

export function listInvites(workspaceDir: string, matterId: string): MatterReplicaInvite[] {
  const p = invitesJsonlPath(workspaceDir, matterId);
  return readJsonl(p, inviteSchema);
}

function rewriteInvites(
  workspaceDir: string,
  matterId: string,
  invites: MatterReplicaInvite[],
): void {
  const mid = assertSafeMatterId(matterId);
  fs.mkdirSync(replicaRoot(workspaceDir, mid), { recursive: true });
  rewriteJsonl(invitesJsonlPath(workspaceDir, mid), inviteSchema, invites);
}

export function createInvite(
  workspaceDir: string,
  input: {
    matterId: string;
    matterTitle: string;
    email: string;
    role: MatterReplicaRole;
  },
): MatterReplicaInvite {
  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("请填写有效的同事邮箱");
  }
  if (input.role === "owner") {
    throw new Error("不能通过邀请直接授予主办；请先邀请为协办后再调整");
  }
  const actor = resolveReplicaActor(workspaceDir);
  if (actor.source === "ephemeral") {
    throw new Error("请先在「成员协作」中设置你的姓名与邮箱，再邀请同事");
  }
  const membership = ensureMembershipWithOwner(workspaceDir, {
    matterId: input.matterId,
    matterTitle: input.matterTitle,
    ownerLawyerId: actor.lawyerId,
    ownerDisplayName: actor.displayName,
    ownerEmail: actor.email,
  });
  assertMemberCapability(membership, actor.lawyerId, "invite");

  const now = Date.now();
  const invite: MatterReplicaInvite = {
    inviteId: newInviteId(),
    matterId: assertSafeMatterId(input.matterId),
    matterTitle: input.matterTitle.trim() || input.matterId,
    token: newToken(),
    email,
    role: input.role,
    invitedBy: actor.lawyerId,
    invitedByName: actor.displayName,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
  };
  appendJsonl(invitesJsonlPath(workspaceDir, invite.matterId), inviteSchema, invite);
  appendRecordOp(workspaceDir, {
    matterId: invite.matterId,
    kind: "invite.create",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    payload: {
      inviteId: invite.inviteId,
      email: invite.email,
      role: invite.role,
      // 对端机器要据此重建邀请，matterTitle 不在别处可取
      matterTitle: invite.matterTitle,
      tokenFp: tokenFingerprint(invite.token),
      expiresAt: invite.expiresAt,
    },
  });
  const matterKey = ensureMatterKey(workspaceDir, invite.matterId);
  // 公布自己的公钥，让将来的轮换能封装给我（X8）
  try {
    publishMemberPublicKey(workspaceDir, invite.matterId);
  } catch {
    /* 公钥发布失败不影响邀请本身 */
  }
  const wrapped = wrapMatterKeyForInvite(matterKey, invite.token, invite.matterId);
  appendRecordOp(workspaceDir, {
    matterId: invite.matterId,
    kind: "matter_key.share",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    payload: { inviteId: invite.inviteId, wrapped },
  });
  emitCollaborationAudit(workspaceDir, {
    matterId: invite.matterId,
    kind: "collab.invite_created",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    detail: `邀请 ${invite.email}（角色 ${invite.role}）`,
  });
  return invite;
}

export function revokeInvite(
  workspaceDir: string,
  matterId: string,
  inviteId: string,
): MatterReplicaInvite {
  const actor = resolveReplicaActor(workspaceDir);
  const membership = readMembership(workspaceDir, matterId);
  if (!membership) {
    throw new Error("本案尚未开启成员协作");
  }
  assertMemberCapability(membership, actor.lawyerId, "manage_members");
  const invites = listInvites(workspaceDir, matterId);
  const idx = invites.findIndex((i) => i.inviteId === inviteId);
  if (idx < 0) {
    throw new Error("邀请不存在");
  }
  const cur = invites[idx];
  if (cur.status !== "pending") {
    throw new Error("只能撤销待接受的邀请");
  }
  const next: MatterReplicaInvite = { ...cur, status: "revoked" };
  invites[idx] = next;
  rewriteInvites(workspaceDir, matterId, invites);
  appendRecordOp(workspaceDir, {
    matterId,
    kind: "invite.revoke",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    payload: { inviteId },
  });
  emitCollaborationAudit(workspaceDir, {
    matterId,
    kind: "collab.invite_revoked",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    detail: `撤销对 ${cur.email} 的邀请`,
  });
  // 撤销必须让已泄露的密钥失效：轮换 + 只对仍在册成员重新封装（X8）
  try {
    rotateAndShareMatterKey(workspaceDir, matterId);
  } catch {
    /* 轮换失败不阻断撤销本身；下次撤销或手动轮换可补 */
  }
  return next;
}

/**
 * Accept an invite by token on this machine.
 * Creates/updates local membership; caller may later sync via relay.
 */
export function acceptInviteByToken(
  workspaceDir: string,
  token: string,
): { membership: ReturnType<typeof readMembership>; invite: MatterReplicaInvite } {
  const normalized = token.trim().toUpperCase();
  if (!normalized) {
    throw new Error("请粘贴邀请码");
  }
  const actor = resolveReplicaActor(workspaceDir);
  if (actor.source === "ephemeral") {
    throw new Error("请先设置你的姓名与邮箱，再接受邀请");
  }

  // Search all matters' invite logs for this token (local). Also check inbox packs.
  const found = findInviteByToken(workspaceDir, normalized);
  if (!found) {
    throw new Error("邀请码无效或已过期");
  }
  let invite = found.invite;
  if (invite.status === "revoked") {
    throw new Error("该邀请已被撤销");
  }
  if (invite.status === "accepted") {
    throw new Error("该邀请已被使用");
  }
  if (Date.parse(invite.expiresAt) < Date.now()) {
    invite = { ...invite, status: "expired" };
    const all = listInvites(workspaceDir, invite.matterId);
    const i = all.findIndex((x) => x.inviteId === invite.inviteId);
    if (i >= 0) {
      all[i] = invite;
      rewriteInvites(workspaceDir, invite.matterId, all);
    }
    throw new Error("邀请已过期，请让主办重新发送");
  }

  let membership = readMembership(workspaceDir, invite.matterId);
  if (!membership) {
    membership = ensureMembershipWithOwner(workspaceDir, {
      matterId: invite.matterId,
      matterTitle: invite.matterTitle,
      ownerLawyerId: invite.invitedBy,
      ownerDisplayName: invite.invitedByName,
    });
  }

  const existing = findActiveMember(membership, actor.lawyerId);
  if (existing) {
    // Already a member — mark invite accepted and return.
  } else {
    const member: MatterReplicaMember = {
      lawyerId: actor.lawyerId,
      displayName: actor.displayName,
      email: actor.email ?? invite.email,
      role: invite.role,
      status: "active",
      joinedAt: new Date().toISOString(),
      invitedBy: invite.invitedBy,
    };
    membership = writeMembership(workspaceDir, upsertMember(membership, member, actor.lawyerId));
  }

  const all = listInvites(workspaceDir, invite.matterId);
  const idx = all.findIndex((x) => x.inviteId === invite.inviteId);
  const accepted: MatterReplicaInvite = {
    ...invite,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
    acceptedBy: actor.lawyerId,
  };
  if (idx >= 0) {
    all[idx] = accepted;
    rewriteInvites(workspaceDir, invite.matterId, all);
  }

  appendRecordOp(workspaceDir, {
    matterId: invite.matterId,
    kind: "invite.accept",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    payload: {
      inviteId: invite.inviteId,
      role: invite.role,
      // 对端机器要据这条 op 重建成员名册，所以身份字段必须自带
      email: actor.email ?? invite.email,
      invitedBy: invite.invitedBy,
    },
  });

  // 新成员公布公钥，之后的轮换才能把新钥匙封装给他
  try {
    publishMemberPublicKey(workspaceDir, invite.matterId);
  } catch {
    /* 公钥发布失败不阻断加入 */
  }

  emitCollaborationAudit(workspaceDir, {
    matterId: invite.matterId,
    kind: "collab.invite_accepted",
    actorId: actor.lawyerId,
    actorName: actor.displayName,
    detail: `加入本案（角色 ${invite.role}）`,
  });

  tryInstallMatterKeyFromOps(workspaceDir, invite.matterId, token);

  return { membership, invite: accepted };
}

function tryInstallMatterKeyFromOps(workspaceDir: string, matterId: string, token: string): void {
  const local = readMatterKey(workspaceDir, matterId);
  // 本机自生成的钥匙（例如还没入伙就先同步过一次）**必须**能被主办分发的钥匙取代，
  // 否则两台机器各持一把，密文互相解不开 —— 这正是 X9 暴露出来的问题。
  // 但已由轮换得到的钥匙不能被旧邀请降级覆盖。
  if (local && local.source !== "generated") {
    return;
  }
  const shares = listRecordOps(workspaceDir, matterId).filter((o) => o.kind === "matter_key.share");
  for (const op of shares.toReversed()) {
    const wrapped = op.payload.wrapped as WrappedMatterKey | undefined;
    if (!wrapped || wrapped.version !== 2) {
      continue;
    }
    try {
      const key = unwrapMatterKeyFromInvite(wrapped, token, matterId);
      installMatterKeyFromPack(workspaceDir, matterId, key);
      return;
    } catch {
      /* wrong token / corrupt — try older shares */
    }
  }
}

function findInviteByToken(
  workspaceDir: string,
  token: string,
): { invite: MatterReplicaInvite; matterId: string } | null {
  for (const name of listMatterIdsFromStorage(workspaceDir)) {
    try {
      const invites = listInvites(workspaceDir, name);
      const hit = invites.find((i) => i.token.toUpperCase() === token);
      if (hit) {
        return { invite: hit, matterId: name };
      }
    } catch {
      /* skip unsafe ids */
    }
  }
  return findInviteInInbox(workspaceDir, token) ?? findInviteFromOps(workspaceDir, token);
}

/**
 * 从 op 日志重建邀请。
 *
 * 同事那台机器上**没有** `invites.jsonl` —— 邀请是随中继上的 `invite.create` op 到的，
 * 这正是「跨机器粘贴邀请码」以前必然失败的原因。
 *
 * 用 `tokenFp`（SHA-256 前 16 位）匹配而不是邀请码本身：中继上从不出现邀请码明文，
 * 而持有邀请码的人可以自己算出指纹。被递过来的 token 就是明文本身，无需从 op 里恢复。
 *
 * 状态由 `invite.revoke` / `invite.accept` op 还原 —— 否则「已撤销的邀请还能用」
 * 会在对端复活。
 */
function findInviteFromOps(
  workspaceDir: string,
  normalizedToken: string,
): { invite: MatterReplicaInvite; matterId: string } | null {
  const fp = tokenFingerprint(normalizedToken);
  for (const matterId of listMatterIdsFromStorage(workspaceDir)) {
    let ops: MatterRecordOp[];
    try {
      ops = listRecordOps(workspaceDir, matterId);
    } catch {
      continue;
    }
    const created = ops.find(
      (op) =>
        op.kind === "invite.create" &&
        typeof op.payload.tokenFp === "string" &&
        op.payload.tokenFp === fp,
    );
    if (!created) {
      continue;
    }
    const inviteId = str(created.payload.inviteId);
    const expiresAt = str(created.payload.expiresAt);
    const role = created.payload.role;
    if (!inviteId || !expiresAt || !isRole(role)) {
      continue;
    }
    const revoked = ops.some(
      (op) => op.kind === "invite.revoke" && op.payload.inviteId === inviteId,
    );
    const accepted = ops.find(
      (op) => op.kind === "invite.accept" && op.payload.inviteId === inviteId,
    );
    const invite: MatterReplicaInvite = {
      inviteId,
      matterId,
      matterTitle: str(created.payload.matterTitle) || matterId,
      token: normalizedToken,
      email: str(created.payload.email),
      role,
      invitedBy: created.actorId,
      invitedByName: created.actorName,
      status: revoked ? "revoked" : accepted ? "accepted" : "pending",
      createdAt: created.createdAt,
      expiresAt,
      acceptedAt: accepted?.createdAt,
      acceptedBy: accepted?.actorId,
    };
    // 落到本机 invites.jsonl：接受流程会就地改写状态，行必须存在
    try {
      const existing = listInvites(workspaceDir, matterId);
      if (!existing.some((i) => i.inviteId === invite.inviteId)) {
        fs.mkdirSync(replicaRoot(workspaceDir, matterId), { recursive: true });
        appendJsonl(invitesJsonlPath(workspaceDir, matterId), inviteSchema, invite);
      }
    } catch {
      /* 落盘失败不阻断接受 */
    }
    return { invite, matterId };
  }
  return null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function findInviteInInbox(
  workspaceDir: string,
  token: string,
): { invite: MatterReplicaInvite; matterId: string } | null {
  const dir = pendingInviteInboxDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    return null;
  }
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as
        | MatterReplicaInvite
        | {
            kind?: string;
            invite?: MatterReplicaInvite;
            matterKey?: MatterReplicaKey;
            wrappedMatterKey?: WrappedMatterKey;
          };
      const raw: MatterReplicaInvite =
        parsed && "token" in parsed && typeof parsed.token === "string"
          ? parsed
          : (parsed as { invite?: MatterReplicaInvite }).invite!;
      const packKey =
        parsed && "matterKey" in parsed
          ? (parsed as { matterKey?: MatterReplicaKey }).matterKey
          : undefined;
      const wrapped =
        parsed && "wrappedMatterKey" in parsed
          ? (parsed as { wrappedMatterKey?: WrappedMatterKey }).wrappedMatterKey
          : undefined;
      if (raw?.token?.toUpperCase() === token) {
        const existing = listInvites(workspaceDir, raw.matterId);
        if (!existing.some((i) => i.inviteId === raw.inviteId)) {
          fs.mkdirSync(replicaRoot(workspaceDir, raw.matterId), { recursive: true });
          appendJsonl(invitesJsonlPath(workspaceDir, raw.matterId), inviteSchema, raw);
        }
        if (wrapped) {
          try {
            installMatterKeyFromPack(
              workspaceDir,
              raw.matterId,
              unwrapMatterKeyFromInvite(wrapped, token, raw.matterId),
            );
          } catch {
            /* fall through */
          }
        } else if (packKey) {
          // legacy v2 plaintext key pack
          installMatterKeyFromPack(workspaceDir, raw.matterId, packKey);
        }
        return { invite: raw, matterId: raw.matterId };
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

/** Export invite pack for sharing (WeChat / email) — colleague can drop into inbox. */
export function exportInvitePack(workspaceDir: string, invite: MatterReplicaInvite): string {
  const matterKey = ensureMatterKey(workspaceDir, invite.matterId);
  const wrappedMatterKey = wrapMatterKeyForInvite(matterKey, invite.token, invite.matterId);
  return JSON.stringify(
    {
      kind: "lawmind.matter_replica.invite",
      version: 3,
      invite,
      wrappedMatterKey,
      shareHint: `在 LawMind「成员协作」中粘贴邀请码：${invite.token}`,
    },
    null,
    2,
  );
}

export function installMatterKeyFromPack(
  workspaceDir: string,
  matterId: string,
  matterKey: MatterReplicaKey,
): void {
  if (matterKey.version !== 1 || typeof matterKey.keyB64 !== "string") {
    return;
  }
  // 邀请包只用于**首次入伙**：本机已有权威钥匙（invite / rotation）时不再覆盖。
  // 否则一个滞留在 inbox 里的旧邀请包就能把当前钥匙降级回去。
  const existing = readMatterKey(workspaceDir, matterId);
  if (existing && existing.source !== "generated") {
    return;
  }
  installMatterKey(workspaceDir, matterId, matterKey, "invite");
}
