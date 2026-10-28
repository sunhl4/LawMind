import { describe, expect, it } from "vitest";
import {
  applyProseSyndrome,
  emptyFactorState,
  ingestToolResult,
  recordReading,
} from "./factor-state.js";
import { planProseRepair } from "./prose-repair.js";

function withCompensation(): ReturnType<typeof emptyFactorState> {
  const state = emptyFactorState();
  ingestToolResult(state, "calculate", {
    op: "economic_compensation",
    value: 88000,
  });
  return state;
}

describe("same-turn amount repair", () => {
  it("bounces only the amount slot when the reply states a different number", () => {
    const state = withCompensation();
    const prose = "建议主张违法解除。经济补偿为 99999 元。";
    applyProseSyndrome(state, prose);
    const plan = planProseRepair(state, prose);
    expect(plan.action).toBe("bounce");
    if (plan.action !== "bounce") {
      return;
    }
    expect(plan.anchors).toEqual(["amount:economic_compensation"]);
    expect(plan.note).toContain("【因子修复】");
    expect(plan.note).toContain("amount:economic_compensation");
    expect(state.factors[0]?.repairs).toBe(1);
  });

  it("does nothing when the reply no longer contains the wrong number", () => {
    const state = withCompensation();
    applyProseSyndrome(state, "经济补偿为 99999 元。");
    const plan = planProseRepair(state, "经济补偿另行计算，先写争点。");
    expect(plan.action).toBe("none");
    expect(state.factors[0]?.repairs).toBe(0);
  });

  it("groups one wrong number reused in two amount slots through the decoder", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "wage", value: 15000 });
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
    const prose = "月工资 99999 元；经济补偿 99999 元。";
    applyProseSyndrome(state, prose);
    const plan = planProseRepair(state, prose);
    expect(plan.action).toBe("bounce");
    if (plan.action !== "bounce") {
      return;
    }
    expect(plan.anchors.toSorted()).toEqual(["amount:economic_compensation", "amount:wage"]);
    expect(plan.note).toContain("amount:economic_compensation");
    expect(plan.note).toContain("amount:wage");
    for (const anchor of plan.anchors) {
      expect(state.factors.find((factor) => factor.anchor === anchor)?.repairs).toBe(1);
    }
  });

  it("stops bouncing after the per-factor repair cap and marks the slot uncorrectable", () => {
    const state = withCompensation();
    const prose = "经济补偿为 99999 元。";
    applyProseSyndrome(state, prose);
    expect(planProseRepair(state, prose).action).toBe("bounce");
    expect(planProseRepair(state, prose).action).toBe("bounce");
    const capped = planProseRepair(state, prose);
    expect(capped.action).toBe("deliver");
    if (capped.action === "deliver") {
      expect(capped.pending).toContain("【待核实】");
    }
    expect(state.factors[0]?.flag).toBe("uncorrectable");
  });

  it("does not bounce when the ledger itself is mixed", () => {
    const state = emptyFactorState();
    recordReading(state, "amount:wage", "amount", "15000", true);
    const factor = state.factors[0];
    expect(factor).toBeDefined();
    if (factor) {
      factor.outcomes = [
        { id: "15000", mass: 0.5, grounded: true },
        { id: "16000", mass: 0.5, grounded: true },
      ];
      factor.flag = "conflict";
      factor.proposalId = "99999";
    }
    expect(planProseRepair(state, "月工资 99999 元。").action).toBe("none");
  });

  it("leaves citation conflicts to the same-turn citation gate", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "search_statute", {
      sourceIds: ["demo-1"],
      demoCorpus: true,
      hits: [{ title: "劳动合同法", snippet: "第三十六条 协商一致可以解除。" }],
    });
    const prose = "根据〔demo-1〕权威来源，可以解除。";
    applyProseSyndrome(state, prose);
    expect(planProseRepair(state, prose).action).toBe("none");
  });

  it("returns none for empty state or prose", () => {
    expect(planProseRepair(undefined, "经济补偿为 99999 元。").action).toBe("none");
    const state = withCompensation();
    expect(planProseRepair(state, "  ").action).toBe("none");
  });
});
