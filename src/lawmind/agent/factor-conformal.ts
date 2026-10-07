/**
 * Split conformal gate for defect (3): write a definite sentence only when the
 * prediction set has size 1. Otherwise 【待核实】. Live projectReading stays on
 * uncalibrated γ; renderEngineReadings uses projectReadingGated once
 * FactorState has ≥ MIN_CONFORMAL_CALIBRATION scores. Offline-simulator arm
 * only. Not a lawyer-facing control.
 */

export const CONFORMAL_ALPHA = 0.1;

export function nonconformityDefinite(purity: number, grounded: boolean): number {
  if (!grounded) {
    return 1;
  }
  const mass = Number.isFinite(purity) ? Math.min(1, Math.max(0, purity)) : 0;
  return 1 - mass;
}

/** Split-conformal quantile: ceil((n+1)(1-α))/n order statistic, clamped. */
export function conformalQuantile(scores: readonly number[], alpha = CONFORMAL_ALPHA): number {
  const sorted = scores.filter((score) => Number.isFinite(score)).toSorted((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return 1;
  }
  const rank = Math.ceil((n + 1) * (1 - alpha));
  const index = Math.min(n - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 1;
}

export type ConformalCandidate = {
  id: string;
  purity: number;
  grounded: boolean;
};

export function conformalPredictionSet(
  candidates: readonly ConformalCandidate[],
  qhat: number,
): string[] {
  return candidates
    .filter(
      (row) =>
        row.id.trim() && row.grounded && nonconformityDefinite(row.purity, row.grounded) <= qhat,
    )
    .map((row) => row.id.trim());
}

export function conformalAllowsDefinite(set: readonly string[]): boolean {
  return set.length === 1;
}

export function conformalProject(
  candidates: readonly ConformalCandidate[],
  qhat: number,
): { kind: "definite"; id: string } | { kind: "mixed"; ids: string[] } {
  const set = conformalPredictionSet(candidates, qhat);
  if (conformalAllowsDefinite(set) && set[0]) {
    return { kind: "definite", id: set[0] };
  }
  return { kind: "mixed", ids: set };
}
