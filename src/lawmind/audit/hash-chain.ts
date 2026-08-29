import { createHash } from "node:crypto";
import fs from "node:fs";
import type { AuditEvent } from "../types.js";

const lastHashByAuditFile = new Map<string, string>();

export type AuditEventWithIntegrity = AuditEvent & {
  previousHash?: string;
  eventHash?: string;
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

/**
 * 进程重启续链：内存 Map 为空时，从当日 jsonl 尾部向前找最后一条带 eventHash 的事件，
 * 以其 eventHash 作为下一条的 previousHash；与 verify 侧「只校验 chained 事件序列」一致。
 */
function recoverPreviousHashFromFile(auditFilePath: string): string {
  let raw: string;
  try {
    raw = fs.readFileSync(auditFilePath, "utf8");
  } catch {
    return "";
  }
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
      // skip bad line
    }
  }
  return "";
}

export function attachHashChain(auditFilePath: string, event: AuditEvent): AuditEventWithIntegrity {
  let previousHash = lastHashByAuditFile.get(auditFilePath);
  if (previousHash === undefined) {
    previousHash = recoverPreviousHashFromFile(auditFilePath);
  }
  const payload = `${previousHash}${canonicalPayload(event)}`;
  const eventHash = createHash("sha256").update(payload, "utf8").digest("hex");
  lastHashByAuditFile.set(auditFilePath, eventHash);
  return { ...event, previousHash: previousHash || undefined, eventHash };
}

export function verifyAuditHashChain(events: AuditEventWithIntegrity[]): {
  ok: boolean;
  brokenAt?: number;
} {
  let prev = "";
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const expectedPrev = prev || undefined;
    if ((e.previousHash ?? "") !== (expectedPrev ?? "")) {
      return { ok: false, brokenAt: i };
    }
    const payload = `${prev}${canonicalPayload(e)}`;
    const expected = createHash("sha256").update(payload, "utf8").digest("hex");
    if (e.eventHash !== expected) {
      return { ok: false, brokenAt: i };
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
  brokenAt?: number;
};

/** Verify hash-chain fields on audit events that include eventHash (legacy lines skipped). */
export function summarizeAuditIntegrity(events: AuditEventWithIntegrity[]): AuditIntegritySummary {
  const chained = events.filter((e) => typeof e.eventHash === "string" && e.eventHash.length > 0);
  if (chained.length === 0) {
    return { ok: true, eventCount: events.length, chainedCount: 0 };
  }
  const result = verifyAuditHashChain(chained);
  return {
    ok: result.ok,
    eventCount: events.length,
    chainedCount: chained.length,
    brokenAt: result.brokenAt,
  };
}
