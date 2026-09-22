/**
 * Compare benchmark run results against optional workspace policy gate.
 */

import type { BenchmarkResult } from "../types.js";
import type { LawMindWorkspacePolicy } from "./workspace-policy.js";

export type BenchmarkGateResult = {
  /** True when no gate configured, no results, or mean score meets threshold */
  ok: boolean;
  /** Arithmetic mean of result scores (0 if empty) */
  meanScore: number;
  /** Policy threshold when set */
  minRequired: number | undefined;
};

/**
 * If `policy.benchmarkGateMinScore` is set, require mean score >= threshold.
 */
export function evaluateBenchmarkGate(
  policy: LawMindWorkspacePolicy | null,
  results: BenchmarkResult[],
): BenchmarkGateResult {
  const minRequired = policy?.benchmarkGateMinScore;
  if (results.length === 0) {
    return { ok: true, meanScore: 0, minRequired };
  }
  const meanScore =
    Math.round((results.reduce((s, r) => s + r.score, 0) / results.length) * 1000) / 1000;
  if (minRequired === undefined || Number.isNaN(minRequired)) {
    return { ok: true, meanScore, minRequired: undefined };
  }
  return { ok: meanScore >= minRequired, meanScore, minRequired };
}
