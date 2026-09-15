/**
 * Per-matter membership store (主办 / 协办 / …).
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { assertSafeMatterId } from "../adapters/matter-storage/paths.js";
import { membershipPath, replicaRoot } from "./paths.js";
import {
  MATTER_REPLICA_ROLES,
  type MatterReplicaMember,
  type MatterReplicaMembership,
  type MatterReplicaRole,
} from "./types.js";
import { roleHasCapability } from "./types.js";

function isRole(value: unknown): value is MatterReplicaRole {
  return typeof value === "string" && (MATTER_REPLICA_ROLES as readonly string[]).includes(value);
}

export function emptyMembership(
  matterId: string,
  matterTitle: string,
  owner: MatterReplicaMember,
): MatterReplicaMembership {
  const mid = assertSafeMatterId(matterId);
  return {
    version: 1,
    matterId: mid,
    matterTitle: matterTitle.trim() || mid,
    replicaKey: mid,
    members: [owner],
    updatedAt: new Date().toISOString(),
    updatedBy: owner.lawyerId,
  };
}

export function readMembership(
  workspaceDir: string,
  matterId: string,
): MatterReplicaMembership | null {
  const p = membershipPath(workspaceDir, matterId);
  try {
    if (!fs.existsSync(p)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<MatterReplicaMembership>;
    if (raw?.version !== 1 || typeof raw.matterId !== "string" || !Array.isArray(raw.members)) {
      return null;
    }
    const members: MatterReplicaMember[] = [];
    for (const m of raw.members) {
      if (
        !m ||
        typeof m.lawyerId !== "string" ||
        typeof m.displayName !== "string" ||
        !isRole(m.role) ||
        (m.status !== "active" && m.status !== "revoked")
      ) {
        continue;
      }
      members.push({
        lawyerId: m.lawyerId.trim(),
        displayName: m.displayName.trim(),
        email: typeof m.email === "string" ? m.email.trim() : undefined,
        role: m.role,
        status: m.status,
        joinedAt: typeof m.joinedAt === "string" ? m.joinedAt : new Date().toISOString(),
        invitedBy: typeof m.invitedBy === "string" ? m.invitedBy : undefined,
      });
    }
    return {
      version: 1,
      matterId: raw.matterId,
      matterTitle: typeof raw.matterTitle === "string" ? raw.matterTitle : raw.matterId,
      replicaKey: typeof raw.replicaKey === "string" ? raw.replicaKey : raw.matterId,
      members,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
      updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : "system",
    };
  } catch {
    return null;
  }
}

export function writeMembership(
  workspaceDir: string,
  membership: MatterReplicaMembership,
): MatterReplicaMembership {
  const mid = assertSafeMatterId(membership.matterId);
  const next: MatterReplicaMembership = {
    ...membership,
    version: 1,
    matterId: mid,
    updatedAt: new Date().toISOString(),
  };
  const dir = replicaRoot(workspaceDir, mid);
  fs.mkdirSync(dir, { recursive: true });
  writeJsonAtomic(membershipPath(workspaceDir, mid), next);
  return next;
}

export function ensureMembershipWithOwner(
  workspaceDir: string,
  input: {
    matterId: string;
    matterTitle: string;
    ownerLawyerId: string;
    ownerDisplayName: string;
    ownerEmail?: string;
  },
): MatterReplicaMembership {
  const existing = readMembership(workspaceDir, input.matterId);
  if (existing) {
    return existing;
  }
  const owner: MatterReplicaMember = {
    lawyerId: input.ownerLawyerId,
    displayName: input.ownerDisplayName,
    email: input.ownerEmail,
    role: "owner",
    status: "active",
    joinedAt: new Date().toISOString(),
  };
  return writeMembership(workspaceDir, emptyMembership(input.matterId, input.matterTitle, owner));
}

export function findActiveMember(
  membership: MatterReplicaMembership,
  lawyerId: string,
): MatterReplicaMember | undefined {
  return membership.members.find((m) => m.lawyerId === lawyerId && m.status === "active");
}

export function assertMemberCapability(
  membership: MatterReplicaMembership,
  lawyerId: string,
  capability: Parameters<typeof roleHasCapability>[1],
): MatterReplicaMember {
  const member = findActiveMember(membership, lawyerId);
  if (!member) {
    throw new Error("你不是本案成员，无法执行此操作");
  }
  if (!roleHasCapability(member.role, capability)) {
    throw new Error(`当前角色（${member.role}）无权执行此操作`);
  }
  return member;
}

export function upsertMember(
  membership: MatterReplicaMembership,
  member: MatterReplicaMember,
  updatedBy: string,
): MatterReplicaMembership {
  const others = membership.members.filter((m) => m.lawyerId !== member.lawyerId);
  return {
    ...membership,
    members: [...others, member],
    updatedBy,
    updatedAt: new Date().toISOString(),
  };
}

export function revokeMember(
  membership: MatterReplicaMembership,
  lawyerId: string,
  updatedBy: string,
): MatterReplicaMembership {
  const target = membership.members.find((m) => m.lawyerId === lawyerId);
  if (!target) {
    throw new Error("成员不存在");
  }
  if (target.role === "owner") {
    const owners = membership.members.filter((m) => m.role === "owner" && m.status === "active");
    if (owners.length <= 1) {
      throw new Error("不能移除唯一主办");
    }
  }
  return upsertMember(membership, { ...target, status: "revoked" }, updatedBy);
}

export function listActiveMembers(membership: MatterReplicaMembership): MatterReplicaMember[] {
  return membership.members.filter((m) => m.status === "active");
}

/** Soft import path helper for tests / diagnostics. */
export function membershipExists(workspaceDir: string, matterId: string): boolean {
  return fs.existsSync(membershipPath(workspaceDir, matterId));
}

export function membershipRelDir(matterId: string): string {
  return path.join("matters", assertSafeMatterId(matterId), "replica");
}
