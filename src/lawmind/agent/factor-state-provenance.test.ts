import { describe, expect, it } from "vitest";
import {
  decisionDistance,
  independentSupport,
  type EvidenceChannel,
} from "./evidence-provenance.js";
import {
  emptyFactorState,
  fuseSharedAnchorLines,
  productMerge,
  projectReading,
  recordReading,
  type FactorOutcome,
} from "./factor-state.js";

function span(id: string): EvidenceChannel {
  return { kind: "span", id };
}

function outcome(id: string, channels: readonly EvidenceChannel[]): FactorOutcome {
  return { id, mass: 1, grounded: true, channels };
}

describe("factor-state provenance integration", () => {
  it("keeps independent spans as two channels and still projects definite", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true, "第15条", [
      span("contract#p1"),
    ]);
    const factor = state.factors[0];
    expect(factor).toBeDefined();
    const merged = productMerge(factor?.outcomes ?? [], [
      outcome("may_terminate", [span("statute#p2")]),
    ]);
    expect(merged.conflict).toBe(false);
    expect(projectReading(merged.outcomes)).toEqual({
      kind: "definite",
      id: "may_terminate",
    });
    expect(independentSupport(merged.outcomes[0] ?? { id: "", mass: 0 })).toBe(2);
    expect(decisionDistance(merged.outcomes).distance).toBe(2);
  });

  it("does not let the same span count twice", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true, "第15条", [
      span("contract#p1"),
    ]);
    const factor = state.factors[0];
    const merged = productMerge(factor?.outcomes ?? [], [
      outcome("may_terminate", [span("contract#p1")]),
    ]);
    expect(merged.conflict).toBe(false);
    expect(independentSupport(merged.outcomes[0] ?? { id: "", mass: 0 })).toBe(1);
    expect(decisionDistance(merged.outcomes).distance).toBe(1);
  });

  it("conflicts when one span is offered for two incompatible readings", () => {
    const merged = productMerge(
      [outcome("may_terminate", [span("contract#p1")])],
      [outcome("may_not", [span("contract#p1")])],
    );
    expect(merged.conflict).toBe(true);
    expect(merged.outcomes).toEqual([]);
  });

  it("marks one span reused for two worker ids as 待核实", () => {
    expect(
      fuseSharedAnchorLines([
        {
          anchor: "clause:解除",
          outcomeId: "may_terminate",
          conclusion: "乙方有权解除",
          span: "第15条 乙方有权解除",
        },
        {
          anchor: "clause:解除",
          outcomeId: "may_not",
          conclusion: "乙方无权解除",
          span: "第15条 乙方有权解除",
        },
      ]),
    ).toEqual(["【待核实】clause:解除：乙方有权解除；乙方无权解除"]);
  });

  it("keeps legacy behavior when provenance is absent", () => {
    const merged = productMerge(
      [{ id: "may_terminate", mass: 1, grounded: true }],
      [{ id: "may_terminate", mass: 1, grounded: true }],
    );
    expect(merged.conflict).toBe(false);
    expect(merged.outcomes[0]?.mass).toBe(1);
    expect(merged.outcomes[0]?.channels).toBeUndefined();
  });
});
