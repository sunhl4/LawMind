/**
 * 从现有因子账本读出综合征，并交给译码器。
 *
 * 只读：不写 FactorState、不改稿、不触发重采样。存在的意义是让「译码器」
 * 先对着真实账本跑出可比较的报告，等第三批消融通过后再接修复回路。
 */

import { proposalSupported, type FactorKind, type FactorState } from "./factor-state.js";
import {
  buildFaultCandidates,
  decodeSyndrome,
  describeDecode,
  syndromeKey,
  type DecodeResult,
  type FaultWeightTable,
  type SyndromeBit,
  type SyndromeRound,
} from "./syndrome-decoder.js";

export type SyndromeObservation = {
  bits: SyndromeBit[];
  decoded: DecodeResult;
  note: string;
  /** Bits seen this round but not persistent yet. Diagnostics only. */
  transient?: SyndromeBit[];
  /** Round index that produced the persistent bits. */
  round?: number;
};

const STABILIZER_BY_KIND: Record<FactorKind, string> = {
  citation: "S1",
  amount: "S2",
  redline: "S3",
  clause: "S4",
};

/** 账本上非 ok 的因子就是红灯；空锚不参与。 */
export function syndromeFromState(state: FactorState): SyndromeBit[] {
  const bits: SyndromeBit[] = [];
  const seen = new Set<string>();
  const push = (bit: SyndromeBit) => {
    if (!bit.anchor.trim()) {
      return;
    }
    const key = syndromeKey(bit);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    bits.push(bit);
  };
  for (const factor of state.factors) {
    if (factor.flag === "ok") {
      continue;
    }
    if (factor.proposalId && !proposalSupported(factor, state.turnEpoch)) {
      continue;
    }
    push({
      stabilizer: STABILIZER_BY_KIND[factor.kind] ?? "S4",
      anchor: factor.anchor,
      detail: factor.flag,
    });
  }
  for (const code of state.redlineFailures) {
    push({ stabilizer: "S3", anchor: `redline:${code}`, detail: code });
  }
  return bits;
}

/** Keep at most one entry per model round; replace the round when a later tool call adds bits. */
export function upsertSyndromeRound(
  history: readonly SyndromeRound[] | undefined,
  round: number,
  bits: readonly SyndromeBit[],
  keepRounds = 8,
): SyndromeRound[] {
  const next = (history ?? []).filter((row) => row.round !== round);
  next.push({ round, bits: [...bits] });
  return next.toSorted((left, right) => left.round - right.round).slice(-Math.max(1, keepRounds));
}

/** Bits present this round but not yet persistent; kept in the ledger for diagnostics. */
export function transientSyndromeBits(
  current: readonly SyndromeBit[],
  persistent: readonly SyndromeBit[],
): SyndromeBit[] {
  const keys = new Set(persistent.map(syndromeKey));
  return current.filter((bit) => !keys.has(syndromeKey(bit)));
}

export function observeSyndromeBits(
  bits: readonly SyndromeBit[],
  options: { weights?: FaultWeightTable; maxFaults?: number } = {},
): SyndromeObservation {
  const rows = [...bits];
  const decoded = decodeSyndrome(rows, buildFaultCandidates(rows, { weights: options.weights }), {
    maxFaults: options.maxFaults,
  });
  return { bits: rows, decoded, note: describeDecode(decoded) };
}

export function observeSyndrome(
  state: FactorState,
  options: { weights?: FaultWeightTable; maxFaults?: number } = {},
): SyndromeObservation {
  return observeSyndromeBits(syndromeFromState(state), options);
}
