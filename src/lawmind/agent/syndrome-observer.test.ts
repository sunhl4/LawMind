import { describe, expect, it } from "vitest";
import {
  applyProseSyndrome,
  emptyFactorState,
  ingestDefinedTerms,
  ingestToolResult,
} from "./factor-state.js";
import { observeSyndrome, syndromeFromState } from "./syndrome-observer.js";

describe("syndrome observer", () => {
  it("reads a conflicting amount as one S2 red light and decodes it", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", {
      op: "economic_compensation",
      value: 88000,
    });
    applyProseSyndrome(state, "经济补偿为 99999 元。");
    const bits = syndromeFromState(state);
    expect(bits).toEqual([
      expect.objectContaining({
        stabilizer: "S2",
        anchor: "amount:economic_compensation",
      }),
    ]);
    const observation = observeSyndrome(state);
    expect(observation.decoded.kind).toBe("unique");
    if (observation.decoded.kind === "unique") {
      expect(observation.decoded.repairAnchors).toEqual(["amount:economic_compensation"]);
    }
    expect(observation.note).toContain("【译码】");
  });

  it("reads an undefined role as S4 and keeps it mixed", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, "甲方：北京示例科技有限公司");
    applyProseSyndrome(state, "买方应于三日内付款。");
    const bits = syndromeFromState(state);
    expect(bits.some((bit) => bit.stabilizer === "S4" && bit.anchor === "party:买方")).toBe(true);
    const observation = observeSyndrome(state);
    expect(observation.decoded.kind).toBe("unique");
  });

  it("reports no red light on a clean state", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "wage", value: 15000 });
    expect(syndromeFromState(state)).toEqual([]);
    const observation = observeSyndrome(state);
    expect(observation.decoded.kind).toBe("uncorrectable");
    expect(observation.note).toContain("【译码无解】");
  });
});
