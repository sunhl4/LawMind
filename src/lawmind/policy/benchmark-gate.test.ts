import { describe, expect, it } from "vitest";
import type { BenchmarkResult } from "../types.js";
import { evaluateBenchmarkGate } from "./benchmark-gate.js";
import type { LawMindWorkspacePolicy } from "./workspace-policy.js";

function result(score: number, id = "bm-1"): BenchmarkResult {
  return {
    benchmarkId: id,
    runId: "r1",
    ranAt: new Date().toISOString(),
    taskCompleted: true,
    kindMatched: true,
    keywordHitRate: 1,
    riskLevelMatched: true,
    reviewGateMatched: true,
    sourceCount: 1,
    claimCount: 1,
    latencyMs: 100,
    score,
  };
}

describe("evaluateBenchmarkGate", () => {
  it("ok when no policy gate", () => {
    const r = evaluateBenchmarkGate(null, [result(0.5), result(0.9)]);
    expect(r.ok).toBe(true);
    expect(r.meanScore).toBeCloseTo(0.7, 2);
    expect(r.minRequired).toBeUndefined();
  });

  it("ok when mean meets threshold", () => {
    const policy: LawMindWorkspacePolicy = { schemaVersion: 1, benchmarkGateMinScore: 0.7 };
    const r = evaluateBenchmarkGate(policy, [result(0.8), result(0.8)]);
    expect(r.ok).toBe(true);
    expect(r.meanScore).toBe(0.8);
  });

  it("fails when mean below threshold", () => {
    const policy: LawMindWorkspacePolicy = { schemaVersion: 1, benchmarkGateMinScore: 0.9 };
    const r = evaluateBenchmarkGate(policy, [result(0.5), result(0.5)]);
    expect(r.ok).toBe(false);
    expect(r.minRequired).toBe(0.9);
  });

  it("empty results ok with gate set", () => {
    const policy: LawMindWorkspacePolicy = { schemaVersion: 1, benchmarkGateMinScore: 0.99 };
    const r = evaluateBenchmarkGate(policy, []);
    expect(r.ok).toBe(true);
    expect(r.meanScore).toBe(0);
  });
});
