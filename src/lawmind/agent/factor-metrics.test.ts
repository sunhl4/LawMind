import { describe, expect, it } from "vitest";
import type { FactorLedgerRecord } from "../adapters/factor-ledger/index.js";
import { buildCorrectionRecord } from "./correction-ledger.js";
import {
  emptyFactorLedgerDigest,
  renderFactorLedgerDigest,
  summarizeFactorLedger,
} from "./factor-metrics.js";

function record(
  kind: FactorLedgerRecord["kind"],
  payload: Record<string, unknown>,
): FactorLedgerRecord {
  return {
    v: 1,
    at: "2026-10-27T00:00:00.000Z",
    kind,
    sessionId: "s1",
    payload,
  };
}

describe("factor ledger metrics", () => {
  it("counts corrections, syndromes, and summary distances", () => {
    const correction = buildCorrectionRecord({
      sessionId: "s1",
      lawyerNote: "金额不对",
      namedAnchors: ["amount:wage"],
      reverts: [{ anchor: "amount:wage", ok: true }],
      readings: [
        {
          anchor: "amount:wage",
          reading: "15000",
          purity: 1,
          grounded: true,
          distance: 0,
        },
      ],
    });
    const records: FactorLedgerRecord[] = [
      record("correction", correction as unknown as Record<string, unknown>),
      record("syndrome", {
        bits: [{ stabilizer: "S2", anchor: "amount:wage" }],
        decoded: { kind: "unique" },
      }),
      record("syndrome", {
        bits: [
          { stabilizer: "S1", anchor: "citation:x" },
          { stabilizer: "S2", anchor: "amount:wage" },
        ],
        transient: [{ stabilizer: "S4", anchor: "party:买方" }],
        decoded: { kind: "ambiguous" },
      }),
      record("syndrome", {
        bits: [{ stabilizer: "S4", anchor: "party:买方" }],
        decoded: { kind: "uncorrectable" },
      }),
      record("repair", {
        action: "bounce",
        anchors: ["amount:wage"],
        note: "【因子修复】只重做这一处：amount:wage。",
      }),
      record("summary", {
        factors: 3,
        definite: 2,
        mixed: 1,
        redLights: 1,
        distances: [0, 1, 2],
      }),
    ];
    const digest = summarizeFactorLedger(records);
    expect(digest.total).toBe(6);
    expect(digest.byKind).toMatchObject({ correction: 1, syndrome: 3, repair: 1, summary: 1 });
    expect(digest.corrections).toMatchObject({
      total: 1,
      reverted: 1,
      partial: 0,
      kept: 0,
      withReadings: 1,
      zeroDistance: 1,
    });
    expect(digest.syndromes).toMatchObject({
      events: 3,
      uniqueAnchors: 3,
      decodedUnique: 1,
      ambiguous: 1,
      uncorrectable: 1,
      transientBits: 1,
    });
    expect(digest.repairs).toEqual({
      total: 1,
      bounced: 1,
      capped: 0,
      anchors: 1,
    });
    expect(digest.summaries).toMatchObject({
      turns: 1,
      factors: 3,
      definite: 2,
      mixed: 1,
      redLights: 1,
      maxDistance: 2,
      zeroDistance: 1,
    });
    expect(digest.summaries.meanDistance).toBe(1);
  });

  it("counts witness probes by base and persistent filters", () => {
    const digest = summarizeFactorLedger([
      record("witness", {
        probes: 2,
        verdict: "drift",
        source: "active",
        scores: [
          { anchor: "amount:wage", kind: "amount", verdict: "drift" },
          { anchor: "amount:wage", kind: "counterfactual", verdict: "pass" },
        ],
        filter: [
          {
            anchor: "amount:wage",
            channel: "witness:value",
            decision: { kind: "definite", id: "invented", logOdds: 2 },
          },
          {
            anchor: "amount:wage",
            channel: "witness:counterfactual",
            decision: { kind: "mixed", ids: [], reason: "单次读数太弱" },
          },
        ],
      }),
    ]);
    expect(digest.witness).toEqual({
      events: 1,
      probes: 2,
      pass: 1,
      drift: 1,
      activeProbes: 2,
      counterfactualProbes: 1,
      persistentObeyed: 0,
      persistentInvented: 1,
      channels: 2,
    });
    expect(renderFactorLedgerDigest(digest)).toContain("抽查 1 次 / 2 问");
  });

  it("returns an empty digest for no records", () => {
    const digest = summarizeFactorLedger([]);
    expect(digest).toEqual(emptyFactorLedgerDigest());
    expect(digest.total).toBe(0);
  });

  it("renders a compact internal digest", () => {
    const text = renderFactorLedgerDigest(
      summarizeFactorLedger([
        record("summary", { factors: 2, definite: 1, mixed: 1, redLights: 0, distances: [2, 2] }),
      ]),
    );
    expect(text).toContain("【因子账本】1 条记录");
    expect(text).toContain("平均距离 2.00");
  });
});
