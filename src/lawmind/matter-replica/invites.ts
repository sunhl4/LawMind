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
import { resolveReplicaActor } from "./identity.js";
import {
  assertMemberCapability,
  ensureMembershipWithOwner,
  findActiveMember,
  readMembership,
  upsertMember,
  writeMembership,
} from "./membership.js";
import { invitesJsonlPath, pendingInviteInboxDir, replicaRoot } from "./paths.js";
import { appendRecordOp } from "./record-ops.js";
import {
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

function newToken(): string {
  // Human-shareable: LAWMIND-XXXX-XXXX style
  const raw = randomBytes(8).toString("hex").toUpperCase();
  return `LM-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token.trim().toUpperCase()).digest("hex").slice(0, 16);
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
      tokenFp: tokenFingerprint(invite.token),
      expiresAt: invite.expiresAt,
    },
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
    payload: { inviteId: invite.inviteId, role: invite.role },
  });

  return { membership, invite: accepted };
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
  return findInviteInInbox(workspaceDir, token);
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
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as MatterReplicaInvite;
      if (raw?.token?.toUpperCase() === token) {
        const existing = listInvites(workspaceDir, raw.matterId);
        if (!existing.some((i) => i.inviteId === raw.inviteId)) {
          fs.mkdirSync(replicaRoot(workspaceDir, raw.matterId), { recursive: true });
          appendJsonl(invitesJsonlPath(workspaceDir, raw.matterId), inviteSchema, raw);
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
export function exportInvitePack(invite: MatterReplicaInvite): string {
  return JSON.stringify(
    {
      kind: "lawmind.matter_replica.invite",
      version: 1,
      invite,
      shareHint: `在 LawMind「成员协作」中粘贴邀请码：${invite.token}`,
    },
    null,
    2,
  );
}
