import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendFactorLedgerRecord } from "../adapters/factor-ledger/index.js";
import {
  applyCorrectionCalibration,
  applyLedgerCalibration,
  buildCalibrationRows,
  calibrationStatusFromRows,
  loadCorrectionRecords,
  renderCalibrationStatus,
  structuralNonconformity,
} from "./conformal-calibration.js";
import { buildCorrectionRecord, type CorrectionRecord } from "./correction-ledger.js";
import { emptyFactorState } from "./factor-state.js";

function correction(
  index: number,
  options: { purity?: number; distance?: number; grounded?: boolean; provenance?: boolean } = {},
): CorrectionRecord {
  const anchor = `amount:test-${index}`;
  return buildCorrectionRecord({
    sessionId: "s1",
    turnId: `t${index}`,
    lawyerNote: "不对",
    namedAnchors: [anchor],
    reverts: [{ anchor, ok: true }],
    readings: [
      {
        anchor,
        reading: "100",
        purity: options.purity ?? 0.6,
        distance: options.distance ?? 1,
        grounded: options.grounded ?? true,
        provenance: options.provenance ?? true,
      },
    ],
  });
}

function corrections(
  count: number,
  options?: { purity?: number; distance?: number },
): CorrectionRecord[] {
  return Array.from({ length: count }, (_, index) => correction(index, options));
}

describe("conformal calibration from correction history", () => {
  it("scores a single-source high-purity reading above a two-source reading", () => {
    const single = structuralNonconformity({ purity: 1, grounded: true, distance: 1 });
    const double = structuralNonconformity({ purity: 1, grounded: true, distance: 2 });
    const ungrounded = structuralNonconformity({ purity: 1, grounded: false, distance: 2 });
    expect(single).toBeGreaterThan(double);
    expect(double).toBe(0);
    expect(ungrounded).toBe(1);
  });

  it("does not treat a missing provenance root as two-source support", () => {
    const withoutProvenance = structuralNonconformity({
      purity: 1,
      grounded: true,
      distance: 2,
      provenance: false,
    });
    const withProvenance = structuralNonconformity({
      purity: 1,
      grounded: true,
      distance: 2,
      provenance: true,
    });
    expect(withoutProvenance).toBe(0.5);
    expect(withProvenance).toBe(0);
  });

  it("marks a reading reverted by the lawyer as reverted, not kept", () => {
    const rows = buildCalibrationRows([correction(1)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gold).toBe("reverted");
    expect(rows[0]?.score).toBeGreaterThan(0);
  });

  it("stays insufficient below the minimum number of rows", () => {
    const status = calibrationStatusFromRows(buildCalibrationRows(corrections(7)));
    expect(status.status).toBe("insufficient");
    expect(status.scores).toEqual([]);
  });

  it("is ready when enough informative rows exist", () => {
    const records = corrections(8);
    const status = calibrationStatusFromRows(buildCalibrationRows(records));
    expect(status.status).toBe("ready");
    expect(status.scores).toHaveLength(8);
    expect(status.informative).toBe(8);
  });

  it("refuses to enable the gate on uninformative all-two-source rows", () => {
    const status = calibrationStatusFromRows(
      buildCalibrationRows(corrections(8, { purity: 1, distance: 2 })),
    );
    expect(status.status).toBe("uninformative");
    expect(status.scores).toEqual([]);
  });

  it("writes scores into FactorState only when ready", () => {
    const state = emptyFactorState();
    expect(applyCorrectionCalibration(state, corrections(7)).status).toBe("insufficient");
    expect(state.conformalScores).toEqual([]);
    expect(applyCorrectionCalibration(state, corrections(8)).status).toBe("ready");
    expect(state.conformalScores).toHaveLength(8);
  });

  it("loads only correction records and skips malformed payloads", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-conformal-"));
    try {
      appendFactorLedgerRecord(workspaceDir, {
        v: 1,
        at: "2026-10-27T00:00:00.000Z",
        kind: "summary",
        sessionId: "s1",
        payload: { factors: 1 },
      });
      for (const record of corrections(2)) {
        appendFactorLedgerRecord(workspaceDir, {
          v: 1,
          at: record.at,
          kind: "correction",
          sessionId: "s1",
          payload: record as unknown as Record<string, unknown>,
        });
      }
      appendFactorLedgerRecord(workspaceDir, {
        v: 1,
        at: "2026-10-27T00:00:00.000Z",
        kind: "correction",
        sessionId: "s1",
        payload: { not: "a correction" },
      });
      const records = loadCorrectionRecords(workspaceDir, { sessionId: "s1" });
      expect(records).toHaveLength(2);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("enables the gate from the ledger once enough history exists", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-conformal-apply-"));
    try {
      for (const record of corrections(8)) {
        appendFactorLedgerRecord(workspaceDir, {
          v: 1,
          at: record.at,
          kind: "correction",
          sessionId: "s1",
          payload: record as unknown as Record<string, unknown>,
        });
      }
      const state = emptyFactorState();
      const status = applyLedgerCalibration(workspaceDir, {
        sessionId: "s1",
        factorState: state,
      });
      expect(status.status).toBe("ready");
      expect(state.conformalScores).toHaveLength(8);
      expect(renderCalibrationStatus(status)).toContain("保形门已启用");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
