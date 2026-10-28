import { describe, expect, it } from "vitest";
import {
  buildFaultCandidates,
  decodeSyndrome,
  describeDecode,
  persistentSyndrome,
  syndromeKey,
  type Fault,
  type SyndromeBit,
  type SyndromeRound,
} from "./syndrome-decoder.js";

function bit(stabilizer: string, anchor: string, check?: string): SyndromeBit {
  return { stabilizer, anchor, ...(check ? { check } : {}) };
}

describe("minimum-weight syndrome decoder", () => {
  it("picks the cheaper proposal fault for a single amount syndrome", () => {
    const syndrome = [bit("S2", "amount:economic_compensation")];
    const result = decodeSyndrome(syndrome, buildFaultCandidates(syndrome));
    expect(result.kind).toBe("unique");
    if (result.kind !== "unique") {
      return;
    }
    expect(result.faults).toHaveLength(1);
    expect(result.faults[0]?.kind).toBe("proposal_wrong");
    expect(result.repairAnchors).toEqual(["amount:economic_compensation"]);
    expect(result.recheck).toEqual(["S2"]);
  });

  it("explains two red lights on one anchor with one root cause", () => {
    const syndrome = [
      bit("S2", "amount:economic_compensation", "value"),
      bit("S2", "amount:economic_compensation", "derived-interest"),
    ];
    const result = decodeSyndrome(syndrome, buildFaultCandidates(syndrome));
    expect(result.kind).toBe("unique");
    if (result.kind !== "unique") {
      return;
    }
    expect(result.faults).toHaveLength(1);
    expect(result.faults[0]?.kind).toBe("correlated_reuse");
    expect(result.repairAnchors).toEqual(["amount:economic_compensation"]);
  });

  it("keeps two independent anchors as two faults", () => {
    const syndrome = [bit("S2", "amount:wage"), bit("S1", "citation:labor-47")];
    const result = decodeSyndrome(syndrome, buildFaultCandidates(syndrome));
    expect(result.kind).toBe("unique");
    if (result.kind !== "unique") {
      return;
    }
    expect(result.faults).toHaveLength(2);
    expect(result.repairAnchors).toEqual(["amount:wage", "citation:labor-47"]);
    expect(result.recheck).toEqual(["S1", "S2"]);
  });

  it("picks the lower-weight explanation when both cover the syndrome", () => {
    const key = syndromeKey(bit("S2", "amount:wage"));
    const faults: Fault[] = [
      {
        id: "cheap",
        kind: "proposal_wrong",
        anchors: ["amount:wage"],
        explains: [key],
        weight: 1,
      },
      {
        id: "expensive",
        kind: "reading_wrong",
        anchors: ["amount:wage"],
        explains: [key],
        weight: 3,
      },
    ];
    const result = decodeSyndrome([bit("S2", "amount:wage")], faults);
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") {
      expect(result.faults.map((row) => row.id)).toEqual(["cheap"]);
      expect(result.cost).toBe(1);
    }
  });

  it("returns ambiguous instead of picking between equal-cost explanations", () => {
    const key = syndromeKey(bit("S2", "amount:wage"));
    const faults: Fault[] = [
      {
        id: "proposal",
        kind: "proposal_wrong",
        anchors: ["amount:wage"],
        explains: [key],
        weight: 1,
      },
      {
        id: "reading",
        kind: "reading_wrong",
        anchors: ["amount:wage"],
        explains: [key],
        weight: 1,
      },
    ];
    const result = decodeSyndrome([bit("S2", "amount:wage")], faults);
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") {
      return;
    }
    expect(result.candidates).toHaveLength(2);
    expect(result.repairAnchors).toEqual(["amount:wage"]);
    expect(describeDecode(result)).toContain("【译码待定】");
  });

  it("refuses a fault that would turn a green check red", () => {
    const key = syndromeKey(bit("S2", "amount:wage"));
    const green = "S1::citation:labor-47::";
    const faults: Fault[] = [
      {
        id: "dangerous",
        kind: "proposal_wrong",
        anchors: ["amount:wage"],
        explains: [key],
        breaks: [green],
        weight: 0.1,
      },
    ];
    const result = decodeSyndrome([bit("S2", "amount:wage")], faults, {
      greenChecks: [green],
    });
    expect(result.kind).toBe("uncorrectable");
  });

  it("reports uncorrectable when no candidate covers the syndrome", () => {
    const result = decodeSyndrome([bit("S9", "unknown")], []);
    expect(result.kind).toBe("uncorrectable");
    expect(describeDecode(result)).toContain("【译码无解】");
  });
});

describe("persistent syndrome", () => {
  it("drops a one-round blip and keeps a repeated red light", () => {
    const history: SyndromeRound[] = [
      { round: 1, bits: [bit("S2", "amount:wage")] },
      { round: 2, bits: [bit("S2", "amount:wage")] },
      { round: 3, bits: [bit("S1", "citation:x")] },
    ];
    const persistent = persistentSyndrome(history, { window: 3, minRounds: 2 });
    expect(persistent.map(syndromeKey)).toEqual([syndromeKey(bit("S2", "amount:wage"))]);
  });

  it("counts a bit once per round even if reported twice", () => {
    const history: SyndromeRound[] = [
      {
        round: 1,
        bits: [bit("S2", "amount:wage"), bit("S2", "amount:wage", "check")],
      },
      { round: 2, bits: [bit("S2", "amount:wage")] },
    ];
    const persistent = persistentSyndrome(history, { window: 2, minRounds: 2 });
    expect(persistent.map(syndromeKey)).toEqual([syndromeKey(bit("S2", "amount:wage"))]);
  });

  it("uses only the most recent window", () => {
    const history: SyndromeRound[] = [
      { round: 1, bits: [bit("S2", "amount:wage")] },
      { round: 2, bits: [bit("S1", "citation:x")] },
      { round: 3, bits: [bit("S1", "citation:x")] },
      { round: 4, bits: [bit("S1", "citation:x")] },
    ];
    const persistent = persistentSyndrome(history, { window: 2, minRounds: 2 });
    expect(persistent.map(syndromeKey)).toEqual([syndromeKey(bit("S1", "citation:x"))]);
  });
});
