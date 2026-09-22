/**
 * Per-matter AES key for replica blob envelopes (local only; never published).
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { assertSafeMatterId } from "../adapters/matter-storage/paths.js";
import { replicaRoot } from "./paths.js";

export type MatterReplicaKey = {
  version: 1;
  keyId: string;
  /** base64 of 32 raw bytes */
  keyB64: string;
  createdAt: string;
  /**
   * 钥匙的来源。用于判断「能不能被对端分发来的钥匙覆盖」：
   * - `generated`：本机自行生成（例如刚开案、或非成员时的兜底）—— 分发来的可覆盖
   * - `invite`：由邀请码解出 —— 接受邀请时写入
   * - `rotation`：由 `matter_key.rotate` 轮换而来 —— **不可**被旧邀请降级覆盖
   */
  source?: "generated" | "invite" | "rotation";
};

export function matterKeyPath(workspaceDir: string, matterId: string): string {
  return path.join(replicaRoot(workspaceDir, assertSafeMatterId(matterId)), "matter-key.json");
}

export function readMatterKey(workspaceDir: string, matterId: string): MatterReplicaKey | null {
  const p = matterKeyPath(workspaceDir, matterId);
  try {
    if (!fs.existsSync(p)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<MatterReplicaKey>;
    if (raw?.version !== 1 || typeof raw.keyB64 !== "string" || typeof raw.keyId !== "string") {
      return null;
    }
    const source =
      raw.source === "generated" || raw.source === "invite" || raw.source === "rotation"
        ? raw.source
        : undefined;
    return {
      version: 1,
      keyId: raw.keyId,
      keyB64: raw.keyB64,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      source,
    };
  } catch {
    return null;
  }
}

export function ensureMatterKey(workspaceDir: string, matterId: string): MatterReplicaKey {
  const existing = readMatterKey(workspaceDir, matterId);
  if (existing) {
    return existing;
  }
  const mid = assertSafeMatterId(matterId);
  const key: MatterReplicaKey = {
    version: 1,
    keyId: `mk_${randomBytes(6).toString("hex")}`,
    keyB64: randomBytes(32).toString("base64"),
    createdAt: new Date().toISOString(),
    source: "generated",
  };
  fs.mkdirSync(replicaRoot(workspaceDir, mid), { recursive: true });
  writeJsonAtomic(matterKeyPath(workspaceDir, mid), key);
  return key;
}

export function matterKeyBytes(key: MatterReplicaKey): Buffer {
  const buf = Buffer.from(key.keyB64, "base64");
  if (buf.length !== 32) {
    throw new Error("invalid matter key length");
  }
  return buf;
}

/**
 * 轮换案件密钥（撤销成员 / 邀请后调用）。
 *
 * 返回新密钥；调用方负责把它逐人封装并发布 `matter_key.rotate`。
 * 旧密钥不再被任何新内容使用 —— 被移出的人即使还握着它，也读不了之后的密文。
 */
export function rotateMatterKey(workspaceDir: string, matterId: string): MatterReplicaKey {
  const mid = assertSafeMatterId(matterId);
  const next: MatterReplicaKey = {
    version: 1,
    keyId: `mk_${randomBytes(6).toString("hex")}`,
    keyB64: randomBytes(32).toString("base64"),
    createdAt: new Date().toISOString(),
    source: "rotation",
  };
  fs.mkdirSync(replicaRoot(workspaceDir, mid), { recursive: true });
  writeJsonAtomic(matterKeyPath(workspaceDir, mid), next);
  return next;
}

/** 无条件安装（轮换必须能覆盖旧密钥，与 ensure 的「已有就返回」不同）。 */
export function installMatterKey(
  workspaceDir: string,
  matterId: string,
  key: MatterReplicaKey,
  source?: MatterReplicaKey["source"],
): void {
  const mid = assertSafeMatterId(matterId);
  if (key.version !== 1 || typeof key.keyB64 !== "string" || typeof key.keyId !== "string") {
    throw new Error("invalid matter key");
  }
  fs.mkdirSync(replicaRoot(workspaceDir, mid), { recursive: true });
  writeJsonAtomic(matterKeyPath(workspaceDir, mid), source ? { ...key, source } : key);
}
