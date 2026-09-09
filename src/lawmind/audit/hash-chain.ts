import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import type { AuditEvent } from "../types.js";
import { resolveAuditChainKey, resolveAuditChainKeys } from "./audit-key.js";

const lastHashByAuditFile = new Map<string, string>();

/** 链哈希算法标记：无字段 = legacy 纯 SHA-256（本次加固前的既有链）；新记录为 hmac-sha256。 */
export const AUDIT_HASH_ALG_HMAC = "hmac-sha256";

export type AuditEventWithIntegrity = AuditEvent & {
  previousHash?: string;
  eventHash?: string;
  hashAlg?: typeof AUDIT_HASH_ALG_HMAC;
};

function canonicalPayload(event: AuditEvent): string {
  return JSON.stringify({
    eventId: event.eventId,
    taskId: event.taskId,
    kind: event.kind,
    actor: event.actor,
    actorId: event.actorId ?? "",
    detail: event.detail ?? "",
    timestamp: event.timestamp,
  });
}

function legacySha256(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function hmacSha256(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

/** 续链恢复只读文件尾窗口；单条审计行远超该窗口时回退全量读。 */
const RECOVERY_TAIL_BYTES = 256 * 1024;

function readFileTail(filePath: string, maxBytes: number): string {
  const fd = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function lastChainHashInText(raw: string): string {
  const lines = raw.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? "").trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as { eventHash?: unknown };
      if (typeof parsed.eventHash === "string" && parsed.eventHash.length > 0) {
        return parsed.eventHash;
      }
    } catch {
      // skip bad line（尾窗口可能截断首行，JSON.parse 失败即跳过）
    }
  }
  return "";
}

/**
 * 进程重启/跨进程续链：从当日 jsonl 尾部向前找最后一条带 eventHash 的事件，
 * 以其 eventHash 作为下一条的 previousHash；与 verify 侧「只校验 chained 事件序列」一致。
 * 只读尾窗口；尾窗口内未找到且文件更大时回退全量读（防超长单行误判为起链）。
 */
function recoverPreviousHashFromFile(auditFilePath: string): string {
  let size: number;
  try {
    size = fs.statSync(auditFilePath).size;
  } catch {
    return "";
  }
  if (size === 0) {
    return "";
  }
  try {
    const tail = lastChainHashInText(readFileTail(auditFilePath, RECOVERY_TAIL_BYTES));
    if (tail || size <= RECOVERY_TAIL_BYTES) {
      return tail;
    }
    return lastChainHashInText(fs.readFileSync(auditFilePath, "utf8"));
  } catch {
    return "";
  }
}

let warnedKeyFallback = false;

/**
 * 为事件附加链完整性字段（HMAC-SHA256：key + previousHash + 规范化负载）。
 *
 * previousHash 选取：文件尾优先于内存缓存——跨进程续链时（调用方须在文件锁
 * 临界区内调用，见 audit/index.ts）文件是唯一真相，内存 Map 只覆盖
 * 「文件尚不存在」的起链场景，避免双进程各自按内存续链而分叉。
 *
 * 密钥不可用时降级 legacy 纯 SHA-256 并告警一次：审计追加是 best-effort，
 * 不因密钥面故障阻断业务事件落盘。
 */
export function attachHashChain(
  auditFilePath: string,
  event: AuditEvent,
  opts?: { key?: Buffer | null },
): AuditEventWithIntegrity {
  const fromFile = recoverPreviousHashFromFile(auditFilePath);
  const previousHash = fromFile || lastHashByAuditFile.get(auditFilePath) || "";
  const payload = `${previousHash}${canonicalPayload(event)}`;
  const key = opts?.key !== undefined ? opts.key : resolveAuditChainKey();
  if (!key) {
    if (!warnedKeyFallback) {
      warnedKeyFallback = true;
      console.warn("[LawMind] 审计链密钥不可用，本次起的事件降级为 legacy SHA-256 链。");
    }
    const eventHash = legacySha256(payload);
    lastHashByAuditFile.set(auditFilePath, eventHash);
    return { ...event, previousHash: previousHash || undefined, eventHash };
  }
  const eventHash = hmacSha256(key, payload);
  lastHashByAuditFile.set(auditFilePath, eventHash);
  return {
    ...event,
    previousHash: previousHash || undefined,
    eventHash,
    hashAlg: AUDIT_HASH_ALG_HMAC,
  };
}

export type AuditChainVerifyResult = {
  ok: boolean;
  brokenAt?: number;
  reason?: "chain_break" | "hash_mismatch" | "key_unavailable";
};

/**
 * 校验 chained 事件序列的连续性 + 每条哈希。
 * - hmac-sha256 事件用本机密钥逐一验证（接受 env / key 文件任一本机密钥，
 *   覆盖桌面 keychain 注入与 headless key 文件并存的多写入方机器）；
 * - 无 hashAlg 的 legacy 事件按纯 SHA-256 验证，既有审计文件保持可读可校验。
 */
export function verifyAuditHashChain(
  events: AuditEventWithIntegrity[],
  opts?: { key?: Buffer | null },
): AuditChainVerifyResult {
  const needsKey = events.some((e) => e.hashAlg === AUDIT_HASH_ALG_HMAC);
  const keys =
    opts?.key !== undefined
      ? opts.key
        ? [opts.key]
        : []
      : needsKey
        ? resolveAuditChainKeys({ create: false })
        : [];
  if (needsKey && keys.length === 0) {
    return { ok: false, reason: "key_unavailable" };
  }
  let prev = "";
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if ((e.previousHash ?? "") !== prev) {
      return { ok: false, brokenAt: i, reason: "chain_break" };
    }
    const payload = `${prev}${canonicalPayload(e)}`;
    const expected =
      e.hashAlg === AUDIT_HASH_ALG_HMAC
        ? keys.some((key) => hmacSha256(key, payload) === e.eventHash)
        : legacySha256(payload) === e.eventHash;
    if (!expected) {
      return { ok: false, brokenAt: i, reason: "hash_mismatch" };
    }
    prev = e.eventHash ?? "";
  }
  return { ok: true };
}

/** Test-only: reset in-memory chain state. */
export function resetAuditHashChainStateForTests(): void {
  lastHashByAuditFile.clear();
}

export type AuditIntegritySummary = {
  ok: boolean;
  eventCount: number;
  chainedCount: number;
  /** chained 中 hmac-sha256 条数（其余为 legacy 纯 SHA-256 段）。 */
  hmacCount: number;
  legacyCount: number;
  /** 校验所需密钥是否可用（纯 legacy 链无需密钥，视为可用）。 */
  keyAvailable: boolean;
  brokenAt?: number;
  reason?: AuditChainVerifyResult["reason"];
};

/** Verify hash-chain fields on audit events that include eventHash (unchained lines skipped). */
export function summarizeAuditIntegrity(
  events: AuditEventWithIntegrity[],
  opts?: { key?: Buffer | null },
): AuditIntegritySummary {
  const chained = events.filter((e) => typeof e.eventHash === "string" && e.eventHash.length > 0);
  const hmacCount = chained.filter((e) => e.hashAlg === AUDIT_HASH_ALG_HMAC).length;
  const legacyCount = chained.length - hmacCount;
  if (chained.length === 0) {
    return {
      ok: true,
      eventCount: events.length,
      chainedCount: 0,
      hmacCount: 0,
      legacyCount: 0,
      keyAvailable: true,
    };
  }
  const result = verifyAuditHashChain(chained, opts);
  return {
    ok: result.ok,
    eventCount: events.length,
    chainedCount: chained.length,
    hmacCount,
    legacyCount,
    keyAvailable: result.reason !== "key_unavailable",
    brokenAt: result.brokenAt,
    reason: result.reason,
  };
}
