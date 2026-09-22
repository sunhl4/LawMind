import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import type { AuditEvent } from "../types.js";
import {
  attachHashChain,
  AUDIT_HASH_ALG_HMAC,
  resetAuditHashChainStateForTests,
  summarizeAuditIntegrity,
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
    expect(verifyAuditHashChain([e0, tampered])).toEqual({
      ok: false,
      brokenAt: 1,
      reason: "hash_mismatch",
    });
  });

  it("recovers chain from file tail after simulated process restart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-hash-chain-"));
    const filePath = path.join(dir, "2026-08-01.jsonl");
    try {
      // 进程 A：写两条链上事件。
      const e0 = attachHashChain(filePath, baseEvent(0));
      const e1 = attachHashChain(filePath, baseEvent(1));
      fs.writeFileSync(filePath, `${JSON.stringify(e0)}\n${JSON.stringify(e1)}\n`, "utf8");

      // 模拟进程重启：清空内存链状态。
      resetAuditHashChainStateForTests();

      // 进程 B：继续写第三条——应从文件尾部恢复 previousHash，而不是另起新链。
      const e2 = attachHashChain(filePath, baseEvent(2));
      expect(e2.previousHash).toBe(e1.eventHash);
      fs.appendFileSync(filePath, `${JSON.stringify(e2)}\n`, "utf8");

      const stored = fs
        .readFileSync(filePath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEventWithIntegrity);
      expect(verifyAuditHashChain(stored)).toEqual({ ok: true });
      expect(summarizeAuditIntegrity(stored).ok).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recovers past trailing legacy lines without eventHash", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-hash-chain-"));
    const filePath = path.join(dir, "2026-08-01.jsonl");
    try {
      const e0 = attachHashChain(filePath, baseEvent(0));
      fs.writeFileSync(
        filePath,
        `${JSON.stringify(e0)}\n${JSON.stringify(baseEvent(9))}\n`,
        "utf8",
      );
      resetAuditHashChainStateForTests();
      const e1 = attachHashChain(filePath, baseEvent(1));
      expect(e1.previousHash).toBe(e0.eventHash);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("audit hash chain HMAC", () => {
  beforeEach(() => {
    resetAuditHashChainStateForTests();
  });

  it("marks new events as hmac-sha256 and verifies with the local key", () => {
    const file = "/tmp/test-audit-hmac.jsonl";
    const e0 = attachHashChain(file, baseEvent(0));
    expect(e0.hashAlg).toBe(AUDIT_HASH_ALG_HMAC);
    expect(verifyAuditHashChain([e0])).toEqual({ ok: true });
    const summary = summarizeAuditIntegrity([e0]);
    expect(summary.ok).toBe(true);
    expect(summary.hmacCount).toBe(1);
    expect(summary.legacyCount).toBe(0);
    expect(summary.keyAvailable).toBe(true);
  });

  it("detects payload tampering (keyed hash cannot be recomputed without key)", () => {
    const file = "/tmp/test-audit-hmac.jsonl";
    const e0 = attachHashChain(file, baseEvent(0));
    const e1 = attachHashChain(file, baseEvent(1));
    const tampered = { ...e1, detail: "已篡改" };
    const result = verifyAuditHashChain([e0, tampered]);
    expect(result).toEqual({ ok: false, brokenAt: 1, reason: "hash_mismatch" });
  });

  it("rejects verification under a wrong key", () => {
    const file = "/tmp/test-audit-hmac.jsonl";
    const e0 = attachHashChain(file, baseEvent(0));
    const wrongKey = randomBytes(32);
    expect(verifyAuditHashChain([e0], { key: wrongKey })).toEqual({
      ok: false,
      brokenAt: 0,
      reason: "hash_mismatch",
    });
  });

  it("reports key_unavailable when hmac events exist but no key is provided", () => {
    const file = "/tmp/test-audit-hmac.jsonl";
    const e0 = attachHashChain(file, baseEvent(0));
    expect(verifyAuditHashChain([e0], { key: null })).toEqual({
      ok: false,
      reason: "key_unavailable",
    });
    const summary = summarizeAuditIntegrity([e0], { key: null });
    expect(summary.ok).toBe(false);
    expect(summary.keyAvailable).toBe(false);
  });

  it("verifies legacy plain-SHA256 events without a key", () => {
    const file = "/tmp/test-audit-legacy.jsonl";
    // key:null 强制 legacy 降级路径，产出与加固前格式一致的链记录。
    const e0 = attachHashChain(file, baseEvent(0), { key: null });
    const e1 = attachHashChain(file, baseEvent(1), { key: null });
    expect(e0.hashAlg).toBeUndefined();
    expect(verifyAuditHashChain([e0, e1], { key: null })).toEqual({ ok: true });
    const summary = summarizeAuditIntegrity([e0, e1], { key: null });
    expect(summary.ok).toBe(true);
    expect(summary.legacyCount).toBe(2);
  });

  it("verifies a mixed legacy → hmac chain (migration boundary stays readable)", () => {
    const file = "/tmp/test-audit-mixed.jsonl";
    const legacy0 = attachHashChain(file, baseEvent(0), { key: null });
    const legacy1 = attachHashChain(file, baseEvent(1), { key: null });
    const hmac2 = attachHashChain(file, baseEvent(2));
    expect(hmac2.previousHash).toBe(legacy1.eventHash);
    const chain = [legacy0, legacy1, hmac2];
    expect(verifyAuditHashChain(chain)).toEqual({ ok: true });
    const summary = summarizeAuditIntegrity(chain);
    expect(summary.ok).toBe(true);
    expect(summary.legacyCount).toBe(2);
    expect(summary.hmacCount).toBe(1);
  });

  it("detects continuity break in a mixed chain", () => {
    const file = "/tmp/test-audit-mixed.jsonl";
    const legacy0 = attachHashChain(file, baseEvent(0), { key: null });
    const hmac1 = attachHashChain(file, baseEvent(1));
    const broken = { ...hmac1, previousHash: "0".repeat(64) };
    expect(verifyAuditHashChain([legacy0, broken])).toEqual({
      ok: false,
      brokenAt: 1,
      reason: "chain_break",
    });
  });
});
