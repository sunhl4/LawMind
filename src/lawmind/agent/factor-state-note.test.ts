import { describe, expect, it } from "vitest";
import {
  appendMechanicalNote,
  applyProseSyndrome,
  emptyFactorState,
  ingestToolResult,
} from "./factor-state.js";

describe("mechanical note root-cause grouping", () => {
  it("tells the lawyer when one wrong figure appears in two amount slots", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "wage", value: 15000 });
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
    applyProseSyndrome(state, "月工资 99999 元；经济补偿 99999 元。");
    const voiced = appendMechanicalNote("建议主张继续履行。", state);
    expect(voiced).toContain("继续履行");
    expect(voiced).toContain("【同一处错数】99999");
    expect(voiced).toContain("amount:wage");
    expect(voiced).toContain("amount:economic_compensation");
  });

  it("does not add a grouping line for a single amount conflict", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
    applyProseSyndrome(state, "经济补偿为 99999 元。");
    const voiced = appendMechanicalNote("建议主张继续履行。", state);
    expect(voiced).toContain("99999");
    expect(voiced).not.toContain("【同一处错数】");
  });
});
