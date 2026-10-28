import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFactorLedgerRecords } from "../adapters/factor-ledger/index.js";
import { buildCorrectionRecord } from "./correction-ledger.js";
import {
  recordCorrectionObservation,
  recordFactorObservation,
  recordRepairObservation,
  recordSyndromeObservation,
} from "./observation-bus.js";
import type { SyndromeObservation } from "./syndrome-observer.js";

describe("factor observation bus", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-observation-bus-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("records a correction with session, matter, and turn metadata", () => {
    const correction = buildCorrectionRecord({
      sessionId: "s1",
      turnId: "t1",
      lawyerNote: "补偿金额不对",
      namedAnchors: ["amount:economic_compensation"],
      reverts: [{ anchor: "amount:economic_compensation", ok: true }],
    });
    recordCorrectionObservation(
      workspaceDir,
      { sessionId: "s1", matterId: "m1" },
      correction,
      "t1",
    );
    const rows = readFactorLedgerRecords(workspaceDir, { matterId: "m1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("correction");
    expect(rows[0]?.sessionId).toBe("s1");
    expect(rows[0]?.matterId).toBe("m1");
    expect(rows[0]?.turnId).toBe("t1");
    expect(rows[0]?.payload.outcome).toBe("reverted");
  });

  it("records a syndrome observation as a read-only payload", () => {
    const observation: SyndromeObservation = {
      bits: [{ stabilizer: "S2", anchor: "amount:wage" }],
      decoded: { kind: "uncorrectable", reason: "test", recheck: ["S2"] },
      note: "【译码无解】test",
    };
    recordSyndromeObservation(workspaceDir, { sessionId: "s1" }, observation, "t1");
    const rows = readFactorLedgerRecords(workspaceDir, { sessionId: "s1" });
    expect(rows[0]?.kind).toBe("syndrome");
    expect(rows[0]?.payload.bits).toEqual(observation.bits);
    expect(rows[0]?.payload.note).toContain("【译码无解】");
  });

  it("records a repair plan with its anchors", () => {
    recordRepairObservation(
      workspaceDir,
      { sessionId: "s1" },
      {
        action: "bounce",
        anchors: ["amount:wage", "amount:economic_compensation"],
        note: "【因子修复】同一处错数影响两个金额槽。",
      },
      "t1",
    );
    const rows = readFactorLedgerRecords(workspaceDir, { sessionId: "s1" });
    expect(rows[0]?.kind).toBe("repair");
    expect(rows[0]?.payload).toMatchObject({
      action: "bounce",
      anchors: ["amount:wage", "amount:economic_compensation"],
    });
  });

  it("rejects an empty session id without touching disk", () => {
    expect(
      recordFactorObservation(workspaceDir, { sessionId: "  " }, { kind: "summary", payload: {} }),
    ).toBeUndefined();
    expect(readFactorLedgerRecords(workspaceDir, { sessionId: "missing" })).toEqual([]);
  });

  it("swallows a write failure so observation cannot break a turn", () => {
    const blocked = path.join(workspaceDir, "blocked");
    fs.writeFileSync(blocked, "not a directory", "utf8");
    expect(
      recordFactorObservation(
        blocked,
        { sessionId: "s1" },
        { kind: "summary", payload: { factors: 1 } },
      ),
    ).toBeUndefined();
  });
});
