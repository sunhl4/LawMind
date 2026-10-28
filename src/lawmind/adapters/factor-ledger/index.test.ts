import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendFactorLedgerRecord,
  factorLedgerPath,
  readFactorLedgerRecords,
  type FactorLedgerRecord,
} from "./index.js";

function record(overrides: Partial<FactorLedgerRecord> = {}): FactorLedgerRecord {
  return {
    v: 1,
    at: "2026-10-27T00:00:00.000Z",
    kind: "summary",
    sessionId: "s1",
    payload: { factors: 1 },
    ...overrides,
  };
}

describe("factor ledger io", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-factor-ledger-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("writes a session ledger when no matter is attached", () => {
    appendFactorLedgerRecord(workspaceDir, record());
    expect(factorLedgerPath(workspaceDir, { sessionId: "s1" })).toBe(
      path.join(workspaceDir, "sessions", "s1.factor-ledger.jsonl"),
    );
    expect(readFactorLedgerRecords(workspaceDir, { sessionId: "s1" })).toEqual([record()]);
  });

  it("prefers the case ledger when a matter id exists", () => {
    appendFactorLedgerRecord(workspaceDir, record({ matterId: "m1" }));
    expect(factorLedgerPath(workspaceDir, { matterId: "m1" })).toBe(
      path.join(workspaceDir, "matters", "m1", "factor-ledger.jsonl"),
    );
    expect(readFactorLedgerRecords(workspaceDir, { matterId: "m1" })).toHaveLength(1);
    expect(readFactorLedgerRecords(workspaceDir, { sessionId: "s1" })).toEqual([]);
  });

  it("skips malformed lines and keeps valid rows", () => {
    const file = factorLedgerPath(workspaceDir, { sessionId: "s1" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"not":"a-record"}\nnot-json\n', "utf8");
    appendFactorLedgerRecord(workspaceDir, record());
    expect(readFactorLedgerRecords(workspaceDir, { sessionId: "s1" })).toEqual([record()]);
  });

  it("returns only the last N rows when a limit is given", () => {
    appendFactorLedgerRecord(workspaceDir, record({ payload: { n: 1 } }));
    appendFactorLedgerRecord(workspaceDir, record({ payload: { n: 2 } }));
    appendFactorLedgerRecord(workspaceDir, record({ payload: { n: 3 } }));
    const rows = readFactorLedgerRecords(workspaceDir, { sessionId: "s1" }, { limit: 2 });
    expect(rows.map((row) => row.payload.n)).toEqual([2, 3]);
  });

  it("rejects an unknown kind at the write boundary", () => {
    expect(() =>
      appendFactorLedgerRecord(workspaceDir, {
        ...record(),
        kind: "unknown" as FactorLedgerRecord["kind"],
      }),
    ).toThrow();
  });

  it("requires a session or matter scope for reads", () => {
    expect(() => factorLedgerPath(workspaceDir, {})).toThrow();
  });
});
