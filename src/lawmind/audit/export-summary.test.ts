import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetLocalKeyStoreCacheForTests } from "../platform/local-key-store.js";
import type { AuditEvent } from "../types.js";
import { AUDIT_CHAIN_KEY_ENV } from "./audit-key.js";
import {
  AUDIT_EXTERNAL_ANCHOR_URL_ENV,
  buildAuditExportSummary,
  buildSignedAuditExportSummary,
  exportAuditSummaryToFile,
  formatAuditSummaryPlainText,
  signAuditSummary,
  verifyAuditSummarySignature,
} from "./export-summary.js";
import {
  attachHashChain,
  resetAuditHashChainStateForTests,
  type AuditEventWithIntegrity,
} from "./hash-chain.js";
import { appendAuditRootAnchor } from "./root-anchor.js";

const tmpDirs: string[] = [];

function mkAuditDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-export-summary-"));
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
  resetLocalKeyStoreCacheForTests();
  delete process.env[AUDIT_CHAIN_KEY_ENV];
  delete process.env[AUDIT_EXTERNAL_ANCHOR_URL_ENV];
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("buildAuditExportSummary", () => {
  it("summarizes a single-day audit chain", () => {
    const auditDir = mkAuditDir();
    const key = Buffer.from("ab".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);
    appendChained(auditDir, "2026-08-01", baseEvent(1), key);

    const summary = buildAuditExportSummary(auditDir);
    expect(summary.eventCount).toBe(2);
    expect(summary.hashAlg).toBe("hmac-sha256");
    expect(summary.rootHash).toHaveLength(64);
    expect(summary.tailAnchor).not.toBeNull();
    expect(summary.tailAnchor?.date).toBe("2026-08-01");
    expect(summary.tailAnchor?.rootHash).toBe(summary.rootHash);
    expect(summary.dateRange.from).toBe("2026-05-20T10:00:00.000Z");
    expect(summary.dateRange.to).toBe("2026-05-20T10:00:01.000Z");
  });

  it("handles a single audit file path", () => {
    const auditDir = mkAuditDir();
    const key = Buffer.from("ab".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);
    const filePath = path.join(auditDir, "2026-08-01.jsonl");
    const summary = buildAuditExportSummary(filePath);
    expect(summary.eventCount).toBe(1);
    expect(summary.tailAnchor?.date).toBe("2026-08-01");
  });

  it("returns empty summary for missing path", () => {
    const summary = buildAuditExportSummary(path.join(os.tmpdir(), "does-not-exist"));
    expect(summary.eventCount).toBe(0);
    expect(summary.rootHash).toBe("");
    expect(summary.tailAnchor).toBeNull();
  });
});

describe("signAuditSummary", () => {
  it("signs and verifies with explicit key", () => {
    const auditDir = mkAuditDir();
    const key = Buffer.from("cd".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);
    const summary = buildAuditExportSummary(auditDir);

    const signed = signAuditSummary(summary, { key, hmacKeyId: "my-key" });
    expect(signed).not.toBeNull();
    expect(signed?.signature).toHaveLength(64);
    expect(signed?.summary.hmacKeyId).toBe("my-key");
    expect(verifyAuditSummarySignature(signed!.summary, signed!.signature, { key })).toBe(true);
  });

  it("detects tampered summary after signing", () => {
    const auditDir = mkAuditDir();
    const key = Buffer.from("cd".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);
    const summary = buildAuditExportSummary(auditDir);
    const signed = signAuditSummary(summary, { key })!;

    const tampered = { ...signed.summary, eventCount: 999 };
    expect(verifyAuditSummarySignature(tampered, signed.signature, { key })).toBe(false);
  });

  it("returns null when no key is available", () => {
    const summary = buildAuditExportSummary(mkAuditDir());
    expect(signAuditSummary(summary, { key: null })).toBeNull();
  });
});

describe("buildSignedAuditExportSummary default keys", () => {
  it("uses env key when available", () => {
    const envKey = "ef".repeat(32);
    process.env[AUDIT_CHAIN_KEY_ENV] = envKey;

    const auditDir = mkAuditDir();
    const key = Buffer.from(envKey, "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);

    const result = buildSignedAuditExportSummary(auditDir);
    expect(result.signature).toHaveLength(64);
    expect(result.hmacKeyId).toBe("audit-chain");
    expect(verifyAuditSummarySignature(result.summary, result.signature!)).toBe(true);
  });
});

describe("exportAuditSummaryToFile", () => {
  it("writes signed JSON summary and reads it back", () => {
    const auditDir = mkAuditDir();
    const outDir = mkAuditDir();
    const key = Buffer.from("12".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);

    const { writtenPath, signature } = exportAuditSummaryToFile(
      auditDir,
      path.join(outDir, "summary.json"),
      { key },
    );
    expect(fs.existsSync(writtenPath)).toBe(true);
    expect(signature).toHaveLength(64);

    const raw = JSON.parse(fs.readFileSync(writtenPath, "utf8")) as {
      schemaVersion: number;
      summary: ReturnType<typeof buildAuditExportSummary>;
      signature: string;
    };
    expect(raw.schemaVersion).toBe(1);
    expect(raw.signature).toBe(signature);
    expect(raw.summary.eventCount).toBe(1);
  });
});

describe("formatAuditSummaryPlainText", () => {
  it("includes human-readable fields and signature", () => {
    const auditDir = mkAuditDir();
    const key = Buffer.from("34".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);
    const summary = buildAuditExportSummary(auditDir);
    const signed = signAuditSummary(summary, { key })!;
    const text = formatAuditSummaryPlainText(signed.summary, signed.signature);
    expect(text).toContain("LawMind Audit Summary");
    expect(text).toContain(`Events: ${summary.eventCount}`);
    expect(text).toContain(`Root Hash: ${summary.rootHash}`);
    expect(text).toContain(`Signature: ${signed.signature}`);
    expect(text).toContain("HMAC Key ID: audit-chain");
  });
});
