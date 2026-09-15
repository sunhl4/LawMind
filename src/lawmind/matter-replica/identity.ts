/**
 * Lawyer identity for matter-replica attribution (commercial: real names, not lawyer:desktop).
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { lawyerIdentityPath } from "./paths.js";
import type { LawyerIdentity } from "./types.js";

function newLawyerId(): string {
  return `lawyer_${randomBytes(6).toString("hex")}`;
}

export function readLawyerIdentity(workspaceDir: string): LawyerIdentity | null {
  const p = lawyerIdentityPath(workspaceDir);
  try {
    if (!fs.existsSync(p)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<LawyerIdentity>;
    if (
      raw?.version !== 1 ||
      typeof raw.lawyerId !== "string" ||
      typeof raw.displayName !== "string"
    ) {
      return null;
    }
    const displayName = raw.displayName.trim();
    const lawyerId = raw.lawyerId.trim();
    if (!displayName || !lawyerId) {
      return null;
    }
    return {
      version: 1,
      lawyerId,
      displayName,
      email: typeof raw.email === "string" && raw.email.trim() ? raw.email.trim() : undefined,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function upsertLawyerIdentity(
  workspaceDir: string,
  input: { displayName: string; email?: string; lawyerId?: string },
): LawyerIdentity {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80) {
    throw new Error("请填写 1–80 字的显示姓名");
  }
  const email = input.email?.trim() || undefined;
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("邮箱格式不正确");
  }
  const existing = readLawyerIdentity(workspaceDir);
  const next: LawyerIdentity = {
    version: 1,
    lawyerId: (input.lawyerId?.trim() || existing?.lawyerId || newLawyerId()).slice(0, 64),
    displayName,
    email,
    updatedAt: new Date().toISOString(),
  };
  const p = lawyerIdentityPath(workspaceDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeJsonAtomic(p, next);
  return next;
}

/**
 * Resolve actor for replica ops: identity file → env → generated ephemeral (not persisted).
 */
export function resolveReplicaActor(workspaceDir: string): {
  lawyerId: string;
  displayName: string;
  email?: string;
  source: "identity" | "env" | "ephemeral";
} {
  const id = readLawyerIdentity(workspaceDir);
  if (id) {
    return {
      lawyerId: id.lawyerId,
      displayName: id.displayName,
      email: id.email,
      source: "identity",
    };
  }
  const envId = process.env.LAWMIND_DESKTOP_ACTOR_ID?.trim();
  if (envId) {
    return { lawyerId: envId, displayName: envId.replace(/^lawyer:/, ""), source: "env" };
  }
  return {
    lawyerId: `lawyer_ephemeral_${randomBytes(4).toString("hex")}`,
    displayName: "未命名律师",
    source: "ephemeral",
  };
}
