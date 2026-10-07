import { describe, expect, it } from "vitest";
import {
  CONFORMAL_ALPHA,
  conformalAllowsDefinite,
  conformalPredictionSet,
  conformalProject,
  conformalQuantile,
  nonconformityDefinite,
} from "./factor-conformal.js";
import {
  GAMMA_STAR,
  MIN_CONFORMAL_CALIBRATION,
  conformalQhatFor,
  emptyFactorState,
  projectReading,
  projectReadingGated,
  purity,
  renderEngineReadings,
  setConformalCalibration,
} from "./factor-state.js";

describe("split conformal definite gate", () => {
  it("returns a singleton set for a peaked grounded reading and mixed when ungrounded", () => {
    const peaked = [
      { id: "yes", mass: 0.95, grounded: true },
      { id: "no", mass: 0.05, grounded: true },
    ];
    const gamma = purity(peaked);
    expect(gamma).toBeGreaterThanOrEqual(GAMMA_STAR);
    const cal = Array.from({ length: 20 }, () => nonconformityDefinite(gamma, true));
    const qhat = conformalQuantile(cal, CONFORMAL_ALPHA);
    const set = conformalPredictionSet(
      [{ id: "提前通知解除", purity: gamma, grounded: true }],
      qhat,
    );
    expect(conformalAllowsDefinite(set)).toBe(true);
    expect(
      conformalProject([{ id: "提前通知解除", purity: gamma, grounded: true }], qhat).kind,
    ).toBe("definite");
    const bare = conformalProject([{ id: "提前通知解除", purity: 1, grounded: false }], qhat);
    expect(bare.kind).toBe("mixed");
    expect(projectReading([{ id: "提前通知解除", mass: 1, grounded: false }]).kind).toBe("mixed");
  });

  it("covers the calibration labels at least 1-alpha on this frozen set", () => {
    const rows = [
      ...Array.from({ length: 18 }, () => ({ purity: 0.94, grounded: true as const, gold: "in" })),
      { purity: 0.4, grounded: true as const, gold: "out" },
      { purity: 0.99, grounded: false as const, gold: "out" },
    ];
    const scores = rows.map((row) => nonconformityDefinite(row.purity, row.grounded));
    const qhat = conformalQuantile(scores, CONFORMAL_ALPHA);
    const positives = rows.filter((row) => row.gold === "in");
    let covered = 0;
    for (const row of positives) {
      const set = conformalPredictionSet(
        [{ id: "yes", purity: row.purity, grounded: row.grounded }],
        qhat,
      );
      if (conformalAllowsDefinite(set)) {
        covered += 1;
      }
    }
    expect(covered / positives.length).toBeGreaterThanOrEqual(1 - CONFORMAL_ALPHA);
    expect(conformalProject([{ id: "yes", purity: 0.99, grounded: false }], qhat).kind).toBe(
      "mixed",
    );
  });

  it("never puts an ungrounded row in the prediction set, even at purity 1", () => {
    const set = conformalPredictionSet([{ id: "提前通知解除", purity: 1, grounded: false }], 1);
    expect(set).toEqual([]);
    expect(conformalAllowsDefinite(set)).toBe(false);
    expect(nonconformityDefinite(1, false)).toBe(1);
  });

  it("is mixed when two grounded labels both sit under qhat", () => {
    const qhat = 0.2;
    const set = conformalPredictionSet(
      [
        { id: "yes", purity: 0.9, grounded: true },
        { id: "no", purity: 0.85, grounded: true },
      ],
      qhat,
    );
    expect(set).toEqual(["yes", "no"]);
    expect(conformalAllowsDefinite(set)).toBe(false);
    expect(
      conformalProject(
        [
          { id: "yes", purity: 0.9, grounded: true },
          { id: "no", purity: 0.85, grounded: true },
        ],
        qhat,
      ).kind,
    ).toBe("mixed");
  });

  it("keeps a peaked pair as a singleton when the loser is above qhat", () => {
    const set = conformalPredictionSet(
      [
        { id: "yes", purity: 0.95, grounded: true },
        { id: "no", purity: 0.05, grounded: true },
      ],
      0.2,
    );
    expect(set).toEqual(["yes"]);
    expect(conformalAllowsDefinite(set)).toBe(true);
  });

  it("uses the split-conformal order statistic and ignores non-finite scores", () => {
    expect(conformalQuantile([], CONFORMAL_ALPHA)).toBe(1);
    expect(conformalQuantile([0.1], CONFORMAL_ALPHA)).toBe(0.1);
    expect(conformalQuantile([Number.NaN, 0.2, Number.POSITIVE_INFINITY], 0.1)).toBe(0.2);
    const ten = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09];
    // n=10, α=0.1 → ceil(11×0.9)=10 → last order statistic
    expect(conformalQuantile(ten, 0.1)).toBe(0.09);
  });

  it("leaves live γ projection unchanged until enough calibration scores exist", () => {
    const outcomes = [
      { id: "提前通知解除", mass: 0.88, grounded: true },
      { id: "无权解除", mass: 0.12, grounded: true },
    ];
    expect(purity(outcomes)).toBeGreaterThanOrEqual(GAMMA_STAR);
    expect(projectReading(outcomes).kind).toBe("definite");
    expect(projectReadingGated(outcomes).kind).toBe("definite");
    const short = emptyFactorState();
    setConformalCalibration(
      short,
      Array.from({ length: MIN_CONFORMAL_CALIBRATION - 1 }, () => 0.05),
    );
    expect(conformalQhatFor(short)).toBeUndefined();
    expect(projectReadingGated(outcomes, conformalQhatFor(short)).kind).toBe("definite");
  });

  it("downgrades a barely-peaked γ definite reading when qhat is tighter than 1-p", () => {
    const outcomes = [
      { id: "提前通知解除", mass: 0.88, grounded: true },
      { id: "无权解除", mass: 0.12, grounded: true },
    ];
    expect(projectReading(outcomes)).toEqual({ kind: "definite", id: "提前通知解除" });
    const cal = Array.from({ length: 20 }, () => nonconformityDefinite(0.95, true));
    const qhat = conformalQuantile(cal, CONFORMAL_ALPHA);
    expect(qhat).toBeLessThan(1 - 0.88);
    expect(projectReadingGated(outcomes, qhat).kind).toBe("mixed");
    const state = emptyFactorState();
    state.factors.push({
      anchor: "clause:解除",
      kind: "clause",
      outcomes,
      repairs: 0,
      flag: "ok",
      neighbors: [],
    });
    expect(renderEngineReadings(state)).toContain("- clause:解除：提前通知解除");
    expect(renderEngineReadings(state)).not.toContain("【待核实】");
    setConformalCalibration(state, cal);
    expect(conformalQhatFor(state)).toBeDefined();
    expect(renderEngineReadings(state)).toContain("- clause:解除：【待核实】提前通知解除");
  });

  it("does not upgrade an ungrounded mixed γ reading even with a loose qhat", () => {
    const outcomes = [{ id: "提前通知解除", mass: 1, grounded: false }];
    expect(projectReading(outcomes).kind).toBe("mixed");
    expect(projectReadingGated(outcomes, 1).kind).toBe("mixed");
  });
});
