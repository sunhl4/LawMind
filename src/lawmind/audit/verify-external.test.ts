import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "../types.js";
import { exportAuditSummaryToFile } from "./export-summary.js";
import {
  attachHashChain,
  resetAuditHashChainStateForTests,
  type AuditEventWithIntegrity,
} from "./hash-chain.js";
import { appendAuditRootAnchor } from "./root-anchor.js";
import { verifyExternalAuditAnchor, formatAuditExternalVerifyReport } from "./verify-external.js";

const tmpDirs: string[] = [];

function mkTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-verify-external-"));
  tmpDirs.push(dir);
  return dir;
}

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

function appendChained(
  auditDir: string,
  date: string,
  event: AuditEvent,
  key: Buffer,
): AuditEventWithIntegrity {
  const filePath = path.join(auditDir, `${date}.jsonl`);
  const stored = attachHashChain(filePath, event, { key });
  fs.appendFileSync(filePath, `${JSON.stringify(stored)}\n`, "utf8");
  if (stored.eventHash) {
    appendAuditRootAnchor(auditDir, { date, rootHash: stored.eventHash, eventId: stored.eventId });
  }
  return stored;
}

beforeEach(() => {
  resetAuditHashChainStateForTests();
});

afterEach(() => {
  resetAuditHashChainStateForTests();
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("verifyExternalAuditAnchor", () => {
  it("passes when chain and external anchor are intact", async () => {
    const auditDir = mkTmpDir();
    const outDir = mkTmpDir();
    const key = Buffer.from("ab".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);
    appendChained(auditDir, "2026-08-01", baseEvent(1), key);

    const anchorPath = path.join(outDir, "anchor.json");
    exportAuditSummaryToFile(auditDir, anchorPath, { key });

    const result = await verifyExternalAuditAnchor(auditDir, anchorPath, { key });
    expect(result.status).toBe("ok");
    expect(result.ok).toBe(true);
    expect(result.chainRootHash).toHaveLength(64);
    expect(result.chain.chainedCount).toBe(2);
    expect(result.externalSummary?.eventCount).toBe(2);
  });

  it("detects tail truncation by comparing chain root hash to external anchor", async () => {
    const auditDir = mkTmpDir();
    const outDir = mkTmpDir();
    const key = Buffer.from("cd".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);
    appendChained(auditDir, "2026-08-01", baseEvent(1), key);

    const anchorPath = path.join(outDir, "anchor.json");
    exportAuditSummaryToFile(auditDir, anchorPath, { key });

    // 截断链尾。
    const filePath = path.join(auditDir, "2026-08-01.jsonl");
    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(filePath, `${lines[0]}\n`, "utf8");

    const result = await verifyExternalAuditAnchor(auditDir, anchorPath, { key });
    expect(result.status).toBe("truncated");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("截断");
  });

  it("detects chain tampering", async () => {
    const auditDir = mkTmpDir();
    const outDir = mkTmpDir();
    const key = Buffer.from("ef".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);
    appendChained(auditDir, "2026-08-01", baseEvent(1), key);

    const anchorPath = path.join(outDir, "anchor.json");
    exportAuditSummaryToFile(auditDir, anchorPath, { key });

    const filePath = path.join(auditDir, "2026-08-01.jsonl");
    const events = fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditEventWithIntegrity);
    events[0] = { ...events[0], detail: "tampered" };
    fs.writeFileSync(filePath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");

    const result = await verifyExternalAuditAnchor(auditDir, anchorPath, { key });
    expect(result.status).toBe("tampered");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("篡改");
  });

  it("detects invalid external signature", async () => {
    const auditDir = mkTmpDir();
    const outDir = mkTmpDir();
    const key = Buffer.from("12".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);

    const anchorPath = path.join(outDir, "anchor.json");
    exportAuditSummaryToFile(auditDir, anchorPath, { key });

    const stored = JSON.parse(fs.readFileSync(anchorPath, "utf8")) as {
      summary: { eventCount: number };
      signature: string;
    };
    stored.summary.eventCount = 999;
    fs.writeFileSync(anchorPath, `${JSON.stringify(stored)}\n`, "utf8");

    const result = await verifyExternalAuditAnchor(auditDir, anchorPath, { key });
    expect(result.status).toBe("signature_invalid");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("签名");
  });

  it("reports missing external anchor", async () => {
    const auditDir = mkTmpDir();
    const key = Buffer.from("34".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);

    const result = await verifyExternalAuditAnchor(
      auditDir,
      path.join(mkTmpDir(), "missing.json"),
      { key },
    );
    expect(result.status).toBe("external_missing");
    expect(result.ok).toBe(false);
  });
});

describe("formatAuditExternalVerifyReport", () => {
  it("includes conclusion and chain stats", async () => {
    const auditDir = mkTmpDir();
    const outDir = mkTmpDir();
    const key = Buffer.from("56".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);
    const anchorPath = path.join(outDir, "anchor.json");
    exportAuditSummaryToFile(auditDir, anchorPath, { key });
    const result = await verifyExternalAuditAnchor(auditDir, anchorPath, { key });
    const report = formatAuditExternalVerifyReport(result);
    expect(report).toContain("结论：通过");
    expect(report).toContain("链统计");
    expect(report).toContain("外部锚摘要");
  });
});
