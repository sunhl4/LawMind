import { describe, expect, it } from "vitest";
import {
  boundaryNamedAnchors,
  emptyFactorState,
  formatFactorReadingLine,
  formatMarginalBoundary,
  hopTruncation,
  linkNeighbors,
  MARGINAL_BOUNDARY_NAME_BUDGET,
  marginalBoundary,
  marginalScopeReport,
  recordReading,
} from "./factor-state.js";

describe("quantum-inspired marginal boundary", () => {
  it("exposes dropped mechanical anchors without exposing their readings", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true, "第15条");
    recordReading(state, "amount:wage", "amount", "15000", true);
    recordReading(state, "citation:labor-47", "citation", "live", true, "第47条");
    linkNeighbors(state, "clause:解除", "amount:wage");
    linkNeighbors(state, "amount:wage", "citation:labor-47");
    const boundary = marginalBoundary(state, ["clause:解除"]);
    expect(boundary.mechanicalDropped).toEqual(["citation:labor-47"]);
    const rendered = formatMarginalBoundary(boundary);
    expect(rendered).toContain("【约化边界】");
    expect(rendered).toContain("citation:labor-47");
    expect(rendered).not.toContain("live");
    expect(rendered).not.toContain("第47条");
  });

  it("names connected long-range anchors that are not mechanical", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true);
    recordReading(state, "clause:违约金", "clause", "过高可调减", true);
    recordReading(state, "clause:管辖", "clause", "仲裁", true);
    linkNeighbors(state, "clause:解除", "clause:违约金");
    linkNeighbors(state, "clause:违约金", "clause:管辖");
    const boundary = marginalBoundary(state, ["clause:解除"]);
    expect(boundary.longRange).toEqual(["clause:管辖"]);
    const rendered = formatMarginalBoundary(boundary);
    expect(rendered).toContain("长程关联项：clause:管辖");
  });

  it("withholds the names of anchors with no evidence path", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true);
    recordReading(state, "clause:远端", "clause", "unknown", true);
    recordReading(state, "amount:wage", "amount", "15000", true);
    linkNeighbors(state, "clause:解除", "amount:wage");
    const report = hopTruncation(state, ["clause:解除"]);
    expect(report.longRange).toEqual([]);
    expect(report.isolated).toEqual(["clause:远端"]);
    const boundary = marginalBoundary(state, ["clause:解除"]);
    expect(boundary.isolated).toEqual(["clause:远端"]);
    // Zero-evidence anchors are diagnostic only: they produce no block at all.
    expect(formatMarginalBoundary(boundary)).toBe("");
  });

  it("caps named anchors at the budget, mechanical first and nearest first", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true);
    recordReading(state, "clause:hub", "clause", "hub", true);
    linkNeighbors(state, "clause:解除", "clause:hub");
    recordReading(state, "clause:mid", "clause", "mid", true);
    linkNeighbors(state, "clause:hub", "clause:mid");
    // Insert the farthest mechanical anchor first so hop distance, not insertion
    // order, decides the line.
    recordReading(state, "amount:far", "amount", "3000", true);
    linkNeighbors(state, "clause:mid", "amount:far");
    for (let index = 0; index < 30; index += 1) {
      recordReading(state, `amount:near-${index}`, "amount", String(1000 + index), true);
      linkNeighbors(state, "clause:hub", `amount:near-${index}`);
    }
    const boundary = marginalBoundary(state, ["clause:解除"]);
    expect(boundary.mechanicalDropped.at(-1)).toBe("amount:far");
    const rendered = formatMarginalBoundary(boundary);
    expect(rendered).toContain("amount:near-0");
    expect(rendered).toContain("amount:near-23");
    expect(rendered).not.toContain("amount:near-24");
    expect(rendered).not.toContain("amount:far");
    expect(rendered).not.toContain("长程关联项");
    expect(rendered).toContain("其余 8 项未列出");
    // Extra zero-evidence anchors, still under the engine's 64-factor cap,
    // must not change the block: no count line, no prompt churn.
    for (let index = 0; index < 20; index += 1) {
      recordReading(state, `clause:unrelated-${index}`, "clause", "unrelated", true);
    }
    const afterUnrelated = formatMarginalBoundary(marginalBoundary(state, ["clause:解除"]));
    expect(afterUnrelated).toBe(rendered);
    expect(afterUnrelated).not.toContain("unrelated");
    expect(afterUnrelated.length).toBeLessThan(700);
  });

  it("exposes the capped named anchors for on-demand reads", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true);
    recordReading(state, "clause:hub", "clause", "hub", true);
    linkNeighbors(state, "clause:解除", "clause:hub");
    for (let index = 0; index < 30; index += 1) {
      recordReading(state, `amount:near-${index}`, "amount", String(1000 + index), true);
      linkNeighbors(state, "clause:hub", `amount:near-${index}`);
    }
    const boundary = marginalBoundary(state, ["clause:解除"]);
    const named = boundaryNamedAnchors(boundary);
    expect(named).toHaveLength(MARGINAL_BOUNDARY_NAME_BUDGET);
    expect(named[0]).toBe("amount:near-0");
    expect(named.at(-1)).toBe(`amount:near-${MARGINAL_BOUNDARY_NAME_BUDGET - 1}`);
  });

  it("reports the worker scope as counts only", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true);
    recordReading(state, "amount:wage", "amount", "15000", true);
    recordReading(state, "citation:labor-47", "citation", "live", true);
    recordReading(state, "clause:远端", "clause", "unknown", true);
    linkNeighbors(state, "clause:解除", "amount:wage");
    linkNeighbors(state, "amount:wage", "citation:labor-47");
    const report = marginalScopeReport(state, ["clause:解除"]);
    expect(report).toEqual({ seen: 2, mechanical: 1, longRange: 0, isolated: 1 });
    expect(JSON.stringify(report)).not.toContain("citation:labor-47");
    expect(JSON.stringify(report)).not.toContain("clause:远端");
  });

  it("counts a connected semantic anchor as long range", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true);
    recordReading(state, "clause:违约金", "clause", "过高可调减", true);
    recordReading(state, "clause:管辖", "clause", "仲裁", true);
    linkNeighbors(state, "clause:解除", "clause:违约金");
    linkNeighbors(state, "clause:违约金", "clause:管辖");
    expect(marginalScopeReport(state, ["clause:解除"])).toEqual({
      seen: 2,
      mechanical: 0,
      longRange: 1,
      isolated: 0,
    });
  });

  it("renders one anchor line for an on-demand read", () => {
    const state = emptyFactorState();
    recordReading(state, "citation:labor-47", "citation", "live", true, "第47条");
    const line = formatFactorReadingLine(state, "citation:labor-47");
    expect(line).toContain("citation:labor-47");
    expect(formatFactorReadingLine(state, "citation:missing")).toBeUndefined();
    expect(formatFactorReadingLine(state, "  ")).toBeUndefined();
  });

  it("returns no boundary block when no seed exists in the factor state", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true);
    recordReading(state, "clause:管辖", "clause", "仲裁", true);
    const boundary = marginalBoundary(state, ["clause:不存在"]);
    expect(boundary.groundedSeeds).toEqual([]);
    expect(formatMarginalBoundary(boundary)).toBe("");
  });

  it("does not treat the term-group widening as dropped", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:生效日", "clause", "2024年3月1日", true);
    recordReading(state, "clause:到期日", "clause", "2029年3月1日", true);
    const boundary = marginalBoundary(state, ["clause:生效日"]);
    expect(boundary.isolated).toEqual([]);
    expect(formatMarginalBoundary(boundary)).toBe("");
  });

  it("returns no boundary block when every factor is inside the marginal", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true);
    expect(formatMarginalBoundary(marginalBoundary(state, ["clause:解除"]))).toBe("");
  });
});
