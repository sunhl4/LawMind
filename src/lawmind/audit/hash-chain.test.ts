import { describe, expect, it, beforeEach } from "vitest";
import type { AuditEvent } from "../types.js";
import {
  attachHashChain,
  resetAuditHashChainStateForTests,
  verifyAuditHashChain,
  type AuditEventWithIntegrity,
} from "./hash-chain.js";

function baseEvent(i: number): AuditEvent {
  return {
    eventId: `e${i}`,
    taskId: `t${i}`,
    kind: "task.created",
    actor: "system",
    timestamp: `2026-05-20T10:00:0${i}.000Z`,
    detail: `detail-${i}`,
  };
}

describe("audit hash chain", () => {
  const file = "/tmp/test-audit.jsonl";

  beforeEach(() => {
    resetAuditHashChainStateForTests();
  });

  it("chains three events and verifies ok", () => {
    const e0 = attachHashChain(file, baseEvent(0));
    const e1 = attachHashChain(file, baseEvent(1));
    const e2 = attachHashChain(file, baseEvent(2));
    const chain: AuditEventWithIntegrity[] = [e0, e1, e2];
    expect(verifyAuditHashChain(chain)).toEqual({ ok: true });
    expect(e0.previousHash).toBeUndefined();
    expect(e1.previousHash).toBe(e0.eventHash);
    expect(e2.previousHash).toBe(e1.eventHash);
  });

  it("detects tampered eventHash", () => {
    const e0 = attachHashChain(file, baseEvent(0));
    const e1 = attachHashChain(file, baseEvent(1));
    const tampered = { ...e1, eventHash: "deadbeef" };
    expect(verifyAuditHashChain([e0, tampered])).toEqual({ ok: false, brokenAt: 1 });
  });
});
