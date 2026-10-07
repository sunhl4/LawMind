import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  conformalProject,
  conformalQuantile,
  nonconformityDefinite,
} from "../agent/factor-conformal.js";
import {
  composeWorkerSystem,
  emptyFactorState,
  hopTruncation,
  linkNeighbors,
  recordReading,
} from "../agent/factor-state.js";
import {
  PHASE_BRIER_WIN_MARGIN,
  TOY_ANCHORS,
  TOY_FORBIDDEN,
  diagonalProb,
  exactPairwiseMarginals,
  runOfflineDiagonalSimulator,
} from "./offline-diagonal-simulator.js";

describe("§9.5 offline diagonal simulator", () => {
  it("stays within 16 anchors and does not import runTurn", () => {
    expect(TOY_ANCHORS.length).toBeGreaterThan(0);
    expect(TOY_ANCHORS.length).toBeLessThanOrEqual(16);
    const src = readFileSync(new URL("./offline-diagonal-simulator.ts", import.meta.url), "utf8");
    expect(src).not.toContain("turn-orchestrator");
    expect(src).not.toMatch(/from ["'].*turn-orchestrator/);
  });

  it("matches unaries without pairwise constraints; phase does not enter the product", () => {
    const unconstrained = exactPairwiseMarginals(TOY_ANCHORS, []);
    for (const row of TOY_ANCHORS) {
      expect(unconstrained[row.id]).toBeCloseTo(row.p1, 9);
    }
    const report = runOfflineDiagonalSimulator();
    expect(report.anchors).toBe(TOY_ANCHORS.length);
    expect(report.junctionMatchesDiagonal).toBe(true);
    const diagonal = report.arms.find((arm) => arm.name === "diagonal");
    const junction = report.arms.find((arm) => arm.name === "junction_tree");
    const phase = report.arms.find((arm) => arm.name === "phase");
    expect(diagonal).toBeDefined();
    expect(junction).toBeDefined();
    expect(phase).toBeDefined();
    expect(phase?.brier ?? 0).toBeGreaterThan((diagonal?.brier ?? 0) - PHASE_BRIER_WIN_MARGIN);
    expect(report.phaseEntersProduct).toBe(false);
    expect(TOY_FORBIDDEN).toHaveLength(1);
  });

  it("zeros the forbidden 11 cell so mae and 管辖 cannot both be on", () => {
    const joints = exactPairwiseMarginals(TOY_ANCHORS, TOY_FORBIDDEN);
    const mae = TOY_ANCHORS.find((row) => row.id === "clause:mae");
    const forum = TOY_ANCHORS.find((row) => row.id === "clause:管辖");
    expect(mae && forum).toBeTruthy();
    if (!mae || !forum) {
      return;
    }
    expect((joints["clause:mae"] ?? 0) * (joints["clause:管辖"] ?? 0)).toBeLessThan(
      mae.p1 * forum.p1,
    );
  });

  it("keeps conformal definite only on singleton sets for the toy gold", () => {
    const scores = TOY_ANCHORS.map((row) => nonconformityDefinite(row.p1 * row.p1, row.grounded));
    const qhat = conformalQuantile(scores);
    for (const row of TOY_ANCHORS) {
      const projected = conformalProject(
        [
          {
            id: row.id,
            purity: row.p1 * row.p1 + (1 - row.p1) * (1 - row.p1),
            grounded: row.grounded,
          },
        ],
        qhat,
      );
      if (row.gold === 1 && row.grounded) {
        expect(projected.kind).toBe("definite");
      }
      if (!row.grounded) {
        expect(projected.kind).toBe("mixed");
      }
    }
  });

  it("still isolates 管辖 on a 1-hop seed and drops parent history", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "有权解除", true);
    recordReading(state, "amount:wage", "amount", "15000", true);
    recordReading(state, "citation:labor-47", "citation", "live", true);
    recordReading(state, "clause:管辖", "clause", "仲裁", true);
    linkNeighbors(state, "clause:解除", "amount:wage");
    linkNeighbors(state, "amount:wage", "citation:labor-47");
    const report = hopTruncation(state, ["clause:解除"]);
    expect(report.isolated).toContain("clause:管辖");
    expect(report.mechanicalDropped).toContain("citation:labor-47");
    expect(
      composeWorkerSystem({
        instructions: "只写解除。",
        parentTranscript: "PARENT_SECRET",
      }),
    ).not.toContain("PARENT_SECRET");
  });

  it("records a worse noise violation rate on the phase arm than on diagonal", () => {
    const report = runOfflineDiagonalSimulator();
    const diagonal = report.arms.find((arm) => arm.name === "diagonal");
    const phase = report.arms.find((arm) => arm.name === "phase");
    expect(phase?.noiseViolationRate ?? 0).toBeGreaterThanOrEqual(
      diagonal?.noiseViolationRate ?? 0,
    );
    expect(Number.isFinite(diagonal?.logLoss)).toBe(true);
    expect(Number.isFinite(phase?.logLoss)).toBe(true);
    expect(phase?.brier ?? 0).toBeGreaterThan(diagonal?.brier ?? 0);
  });

  it("refuses more than 16 anchors and enumerates an empty graph as empty", () => {
    expect(exactPairwiseMarginals([], [])).toEqual({});
    const tooMany = Array.from({ length: 17 }, (_, i) => ({
      id: `a${i}`,
      p1: 0.9,
      grounded: true as const,
      gold: 1 as const,
    }));
    expect(exactPairwiseMarginals(tooMany, [])).toEqual({});
    expect(() => runOfflineDiagonalSimulator(tooMany)).toThrow(/16/);
  });

  it("sets the constrained pairwise marginal to 1/3 on a balanced forbidden pair", () => {
    const pair = [
      { id: "a", p1: 0.5, grounded: true as const, gold: 1 as const },
      { id: "b", p1: 0.5, grounded: true as const, gold: 1 as const },
    ];
    const joints = exactPairwiseMarginals(pair, [{ a: "a", b: "b" }]);
    expect(joints.a).toBeCloseTo(1 / 3, 9);
    expect(joints.b).toBeCloseTo(1 / 3, 9);
  });

  it("maps ungrounded toy rows to diagonal probability 0", () => {
    const row = TOY_ANCHORS.find((item) => !item.grounded);
    expect(row).toBeTruthy();
    if (row) {
      expect(diagonalProb(row)).toBe(0);
    }
  });
});
