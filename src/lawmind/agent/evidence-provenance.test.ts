import { describe, expect, it } from "vitest";
import {
  canFuseByProvenance,
  channelRoot,
  decisionDistance,
  fuseProvenancedOutcomes,
  independentSupport,
  sharedEvidenceRoots,
  type EvidenceChannel,
} from "./evidence-provenance.js";

function model(id: string): EvidenceChannel {
  return { kind: "model", id };
}

function span(id: string): EvidenceChannel {
  return { kind: "span", id };
}

describe("provenance-aware fusion", () => {
  it("does not double-count the same model turn repeated by two workers", () => {
    const fused = fuseProvenancedOutcomes(
      [
        {
          id: "may_terminate",
          mass: 1,
          grounded: true,
          channels: [model("m1:turn-1")],
        },
      ],
      [
        {
          id: "may_terminate",
          mass: 1,
          grounded: true,
          channels: [model("m1:turn-1")],
        },
      ],
    );
    expect(fused.conflict).toBe(false);
    expect(fused.outcomes).toHaveLength(1);
    expect(fused.outcomes[0]?.mass).toBe(1);
    expect(independentSupport(fused.outcomes[0] ?? { id: "", mass: 0 })).toBe(1);
    expect(decisionDistance(fused.outcomes)).toEqual({
      id: "may_terminate",
      distance: 1,
      roots: ["model:m1:turn-1"],
    });
  });

  it("counts two genuinely independent spans as two channels", () => {
    const fused = fuseProvenancedOutcomes(
      [
        {
          id: "may_terminate",
          mass: 1,
          grounded: true,
          channels: [span("contract#p1")],
        },
      ],
      [
        {
          id: "may_terminate",
          mass: 1,
          grounded: true,
          channels: [span("statute#p2")],
        },
      ],
    );
    expect(fused.outcomes[0]?.mass).toBe(1);
    expect(independentSupport(fused.outcomes[0] ?? { id: "", mass: 0 })).toBe(2);
    expect(decisionDistance(fused.outcomes)).toEqual({
      id: "may_terminate",
      distance: 2,
      roots: ["span:contract#p1", "span:statute#p2"],
    });
  });

  it("refuses to let one span support two incompatible readings", () => {
    const shared = span("contract#p1");
    const left = [{ id: "may_terminate", mass: 1, grounded: true, channels: [shared] }];
    const right = [{ id: "may_not", mass: 1, grounded: true, channels: [shared] }];
    expect(sharedEvidenceRoots(left, right)).toEqual(["span:contract#p1"]);
    const fused = fuseProvenancedOutcomes(left, right);
    expect(fused.conflict).toBe(true);
    expect(fused.outcomes).toEqual([]);
    expect(fused.sharedRoots).toEqual(["span:contract#p1"]);
  });

  it("treats two subagents on the same model turn as correlated, not independent", () => {
    const fused = fuseProvenancedOutcomes(
      [{ id: "a", mass: 1, grounded: true, channels: [model("m1:turn-7")] }],
      [{ id: "b", mass: 1, grounded: true, channels: [model("m1:turn-7")] }],
    );
    expect(fused.conflict).toBe(true);
    expect(fused.sharedRoots).toEqual(["model:m1:turn-7"]);
    expect(fused.outcomes).toEqual([]);
  });

  it("keeps the legacy path when provenance is missing", () => {
    expect(canFuseByProvenance([{ id: "a", mass: 1 }], [{ id: "a", mass: 1 }])).toBe(false);
    expect(
      canFuseByProvenance(
        [{ id: "a", mass: 1, channels: [span("s1")] }],
        [{ id: "a", mass: 1, channels: [span("s2")] }],
      ),
    ).toBe(true);
  });

  it("never counts a duplicated channel inside one outcome twice", () => {
    const fused = fuseProvenancedOutcomes(
      [
        {
          id: "a",
          mass: 1,
          grounded: true,
          channels: [span("s1"), span("s1"), model("m1:turn-1")],
        },
      ],
      [],
    );
    expect(independentSupport(fused.outcomes[0] ?? { id: "", mass: 0 })).toBe(2);
    expect(fused.usedRoots.a).toEqual(["model:m1:turn-1", "span:s1"]);
  });

  it("defaults a channel root to kind:id and ignores empty ids", () => {
    expect(channelRoot({ kind: "tool", id: "calculate:1" })).toBe("tool:calculate:1");
    expect(channelRoot({ kind: "tool", id: "  " })).toBe("");
    expect(
      canFuseByProvenance([{ id: "a", mass: 1, channels: [{ kind: "tool", id: "" }] }], []),
    ).toBe(false);
  });

  it("does not call it a conflict when only one side keeps independent support", () => {
    const fused = fuseProvenancedOutcomes(
      [{ id: "a", mass: 1, grounded: true, channels: [span("s1")] }],
      [{ id: "b", mass: 1, grounded: true, channels: [span("s1"), span("s2")] }],
    );
    expect(fused.sharedRoots).toEqual(["span:s1"]);
    expect(fused.outcomes.map((row) => row.id)).toEqual(["b"]);
    expect(fused.conflict).toBe(false);
  });

  it("reports no decision distance when two readings tie", () => {
    expect(
      decisionDistance([
        { id: "a", mass: 0.5, channels: [span("s1")] },
        { id: "b", mass: 0.5, channels: [span("s2")] },
      ]),
    ).toEqual({ id: "", distance: 0, roots: [] });
  });
});
