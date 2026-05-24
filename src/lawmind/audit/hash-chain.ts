import { createHash } from "node:crypto";
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

export function attachHashChain(auditFilePath: string, event: AuditEvent): AuditEventWithIntegrity {
  const previousHash = lastHashByAuditFile.get(auditFilePath) ?? "";
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
