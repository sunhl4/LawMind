import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import type { AuditEvent } from "../types.js";
import {
  attachHashChain,
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
    expect(verifyAuditHashChain([e0, tampered])).toEqual({ ok: false, brokenAt: 1 });
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
