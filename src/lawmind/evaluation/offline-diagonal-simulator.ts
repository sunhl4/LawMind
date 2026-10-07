/**
 * §9.5 offline toy experiment. Does not enter the delivery turn. No vendor quantum cloud.
 * Frozen ≤16 binary anchors, original Chinese labels, not CUAD copies.
 *
 * Arms: diagonal product (engine); exact pairwise marginals (junction-tree
 * gold on this small graph); a phase mix that reintroduces a forbidden joint.
 * Phase enters the product only if it beats diagonal Brier by PHASE_BRIER_WIN_MARGIN.
 */
import {
  CONFORMAL_ALPHA,
  conformalQuantile,
  nonconformityDefinite,
} from "../agent/factor-conformal.js";
import { projectReading, type FactorOutcome } from "../agent/factor-state.js";

/** Pre-stated margin. Phase must beat diagonal by this much Brier (lower is better). */
export const PHASE_BRIER_WIN_MARGIN = 0.02;

export const ILLEGAL_MIX = 0.08;

export type BinaryAnchor = {
  id: string;
  /** P(outcome = 1) on the diagonal. */
  p1: number;
  grounded: boolean;
  /** Gold: 1 means the definite positive reading is true. */
  gold: 0 | 1;
};

export type ForbiddenPair = {
  a: string;
  b: string;
};

export const TOY_ANCHORS: readonly BinaryAnchor[] = [
  { id: "clause:解除", p1: 0.92, grounded: true, gold: 1 },
  { id: "amount:wage", p1: 1, grounded: true, gold: 1 },
  { id: "citation:labor-47", p1: 0.88, grounded: true, gold: 1 },
  { id: "defined:甲方", p1: 0.95, grounded: true, gold: 1 },
  { id: "clause:竞业", p1: 0.8, grounded: true, gold: 1 },
  { id: "clause:违约金", p1: 0.7, grounded: true, gold: 1 },
  { id: "clause:管辖", p1: 0.55, grounded: false, gold: 0 },
  { id: "clause:mae", p1: 0.51, grounded: false, gold: 0 },
];

export const TOY_FORBIDDEN: readonly ForbiddenPair[] = [{ a: "clause:mae", b: "clause:管辖" }];

export type ArmScores = {
  name: "diagonal" | "junction_tree" | "phase";
  brier: number;
  logLoss: number;
  noiseViolationRate: number;
};

export type SimulatorReport = {
  anchors: number;
  alpha: number;
  qhat: number;
  arms: ArmScores[];
  junctionMatchesDiagonal: boolean;
  phaseEntersProduct: boolean;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function brier(p: number, y: 0 | 1): number {
  const gap = clamp01(p) - y;
  return gap * gap;
}

function logLoss(p: number, y: 0 | 1): number {
  const q = Math.min(1 - 1e-12, Math.max(1e-12, clamp01(p)));
  return -(y === 1 ? Math.log(q) : Math.log(1 - q));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

export function diagonalProb(anchor: BinaryAnchor): number {
  const outcomes: FactorOutcome[] = [
    { id: "yes", mass: anchor.p1, grounded: anchor.grounded },
    { id: "no", mass: 1 - anchor.p1, grounded: anchor.grounded },
  ];
  const reading = projectReading(outcomes);
  if (reading.kind === "definite" && reading.id === "yes") {
    return 1;
  }
  return 0;
}

/**
 * Exact enumeration of a pairwise-constrained product (junction-tree gold
 * for n ≤ 16). Forbidden pairs zero the 11 cell.
 */
export function exactPairwiseMarginals(
  unaries: readonly BinaryAnchor[],
  forbidden: readonly ForbiddenPair[],
): Record<string, number> {
  const n = unaries.length;
  if (n === 0 || n > 16) {
    return {};
  }
  const index = new Map(unaries.map((row, i) => [row.id, i]));
  const mass = Array.from({ length: n }, () => 0);
  let partition = 0;
  const limit = 1 << n;
  for (let bits = 0; bits < limit; bits += 1) {
    let weight = 1;
    for (let i = 0; i < n; i += 1) {
      const p1 = unaries[i]?.p1 ?? 0.5;
      weight *= bits & (1 << i) ? p1 : 1 - p1;
    }
    for (const pair of forbidden) {
      const left = index.get(pair.a);
      const right = index.get(pair.b);
      if (left === undefined || right === undefined) {
        continue;
      }
      const aOn = (bits & (1 << left)) !== 0;
      const bOn = (bits & (1 << right)) !== 0;
      if (aOn && bOn) {
        weight = 0;
        break;
      }
    }
    if (weight <= 0) {
      continue;
    }
    partition += weight;
    for (let i = 0; i < n; i += 1) {
      if (bits & (1 << i)) {
        mass[i] = (mass[i] ?? 0) + weight;
      }
    }
  }
  const out: Record<string, number> = {};
  for (let i = 0; i < n; i += 1) {
    const row = unaries[i];
    if (!row) {
      continue;
    }
    out[row.id] = partition > 0 ? (mass[i] ?? 0) / partition : row.p1;
  }
  return out;
}

/** Single-qubit relative phase cancels. Two-bit illegal mix raises P(11). */
export function phaseProb(anchor: BinaryAnchor, mixedIllegal: number): number {
  if (anchor.gold === 0) {
    return clamp01(diagonalProb(anchor) + mixedIllegal);
  }
  return diagonalProb(anchor);
}

export function noiseViolationRate(
  anchors: readonly BinaryAnchor[],
  predict: (row: BinaryAnchor) => number,
  dropRate: number,
  rounds: number,
  seed: number,
): number {
  let violations = 0;
  let total = 0;
  let rng = seed || 1;
  const next = (): number => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 0x100000000;
  };
  for (let round = 0; round < rounds; round += 1) {
    for (const row of anchors) {
      total += 1;
      const dropped = next() < dropRate;
      const probe = dropped ? { ...row, grounded: false, p1: row.p1 } : row;
      const p = predict(probe);
      if (p >= 0.5 && !probe.grounded) {
        violations += 1;
      }
    }
  }
  return total === 0 ? 0 : violations / total;
}

export function scoreArm(
  name: ArmScores["name"],
  anchors: readonly BinaryAnchor[],
  predict: (row: BinaryAnchor) => number,
): ArmScores {
  const briers: number[] = [];
  const losses: number[] = [];
  for (const row of anchors) {
    const p = predict(row);
    briers.push(brier(p, row.gold));
    losses.push(logLoss(p, row.gold));
  }
  return {
    name,
    brier: mean(briers),
    logLoss: mean(losses),
    noiseViolationRate: noiseViolationRate(anchors, predict, 0.3, 8, 7),
  };
}

export function runOfflineDiagonalSimulator(
  anchors: readonly BinaryAnchor[] = TOY_ANCHORS,
  forbidden: readonly ForbiddenPair[] = TOY_FORBIDDEN,
): SimulatorReport {
  if (anchors.length > 16) {
    throw new Error("toy case must stay at ≤16 binary anchors");
  }
  const calScores = anchors.map((row) =>
    nonconformityDefinite(row.p1 * row.p1 + (1 - row.p1) * (1 - row.p1), row.grounded),
  );
  const qhat = conformalQuantile(calScores, CONFORMAL_ALPHA);
  const diagonal = scoreArm("diagonal", anchors, diagonalProb);
  const unconstrained = exactPairwiseMarginals(anchors, []);
  const joints = exactPairwiseMarginals(anchors, forbidden);
  const junction = scoreArm("junction_tree", anchors, (row) => {
    const p1 = joints[row.id] ?? row.p1;
    return diagonalProb({ ...row, p1 });
  });
  const phase = scoreArm("phase", anchors, (row) => phaseProb(row, ILLEGAL_MIX));
  const unconstrainedDelta = Math.max(
    0,
    ...anchors.map((row) => Math.abs((unconstrained[row.id] ?? row.p1) - row.p1)),
  );
  return {
    anchors: anchors.length,
    alpha: CONFORMAL_ALPHA,
    qhat,
    arms: [diagonal, junction, phase],
    junctionMatchesDiagonal: unconstrainedDelta < 1e-9,
    phaseEntersProduct: phase.brier + PHASE_BRIER_WIN_MARGIN <= diagonal.brier,
  };
}
