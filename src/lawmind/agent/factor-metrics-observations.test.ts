import { describe, expect, it } from "vitest";
import type { FactorLedgerRecord } from "../adapters/factor-ledger/index.js";
import { summarizeFactorLedger } from "./factor-metrics.js";

function record(
  kind: FactorLedgerRecord["kind"],
  payload: Record<string, unknown>,
): FactorLedgerRecord {
  return {
    v: 1,
    at: "2026-10-28T00:00:00.000Z",
    kind,
    sessionId: "s1",
    payload,
  };
}

describe("factor metrics observation kinds", () => {
  it("counts witness, relation, and review observations", () => {
    const digest = summarizeFactorLedger([
      record("witness", { verdict: "drift", driftAnchors: ["amount:wage"] }),
      record("relation", { conflicts: [{ anchors: ["defined:甲方", "defined:公司"] }] }),
      record("review", { accepted: [{ anchor: "clause:解除" }], rejected: [] }),
    ]);
    expect(digest.byKind).toMatchObject({ witness: 1, relation: 1, review: 1 });
    expect(digest.total).toBe(3);
  });
});
