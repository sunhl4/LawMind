import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendFactorLedgerRecord,
  cleanupFactorLedger,
  factorLedgerPath,
  readFactorLedgerRecords,
} from "./index.js";
import type { FactorLedgerRecord } from "./schema.js";

function record(index: number, at = "2026-10-28T00:00:00.000Z"): FactorLedgerRecord {
  return {
    v: 1,
    at,
    kind: "summary",
    sessionId: "s1",
    payload: { index, text: "x".repeat(index + 1) },
  };
}

describe("factor ledger retention", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-factor-retention-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("keeps the newest records under the record cap", () => {
    for (let index = 0; index < 5; index += 1) {
      appendFactorLedgerRecord(workspaceDir, record(index));
    }
    const report = cleanupFactorLedger(workspaceDir, { sessionId: "s1" }, { maxRecords: 2 });
    expect(report.reason).toBe("records");
    expect(report.beforeRecords).toBe(5);
    expect(report.afterRecords).toBe(2);
    expect(
      readFactorLedgerRecords(workspaceDir, { sessionId: "s1" }).map((row) => row.payload.index),
    ).toEqual([3, 4]);
  });

  it("drops old rows only when maxAgeMs is explicitly supplied", () => {
    appendFactorLedgerRecord(workspaceDir, record(1, "2026-10-01T00:00:00.000Z"));
    appendFactorLedgerRecord(workspaceDir, record(2, "2026-10-27T00:00:00.000Z"));
    const noAge = cleanupFactorLedger(
      workspaceDir,
      { sessionId: "s1" },
      { nowMs: Date.parse("2026-10-28T00:00:00.000Z") },
    );
    expect(noAge.droppedRecords).toBe(0);
    const aged = cleanupFactorLedger(
      workspaceDir,
      { sessionId: "s1" },
      { maxAgeMs: 2 * 24 * 60 * 60 * 1000, nowMs: Date.parse("2026-10-28T00:00:00.000Z") },
    );
    expect(aged.reason).toBe("age");
    expect(
      readFactorLedgerRecords(workspaceDir, { sessionId: "s1" }).map((row) => row.payload.index),
    ).toEqual([2]);
  });

  it("keeps the newest valid row even when maxBytes is smaller than one row", () => {
    appendFactorLedgerRecord(workspaceDir, record(1));
    appendFactorLedgerRecord(workspaceDir, record(2));
    const report = cleanupFactorLedger(workspaceDir, { sessionId: "s1" }, { maxBytes: 1 });
    expect(report.afterRecords).toBe(1);
    expect(readFactorLedgerRecords(workspaceDir, { sessionId: "s1" })[0]?.payload.index).toBe(2);
  });

  it("skips corrupt lines while cleaning and rewrites only valid rows", () => {
    const file = factorLedgerPath(workspaceDir, { sessionId: "s1" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not-json\n", "utf8");
    appendFactorLedgerRecord(workspaceDir, record(1));
    const report = cleanupFactorLedger(workspaceDir, { sessionId: "s1" }, { maxRecords: 1 });
    expect(report.beforeRecords).toBe(1);
    expect(report.afterRecords).toBe(1);
    expect(fs.readFileSync(file, "utf8")).not.toContain("not-json");
  });

  it("uses the same lock contract as other storage rewrites", () => {
    appendFactorLedgerRecord(workspaceDir, record(1));
    const file = factorLedgerPath(workspaceDir, { sessionId: "s1" });
    fs.writeFileSync(
      `${file}.lock`,
      JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
      "utf8",
    );
    expect(() => cleanupFactorLedger(workspaceDir, { sessionId: "s1" }, { maxRecords: 1 })).toThrow(
      /file_lock_timeout/,
    );
    fs.rmSync(`${file}.lock`, { force: true });
  });
});
