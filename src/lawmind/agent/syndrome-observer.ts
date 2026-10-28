/**
 * 从现有因子账本读出综合征，并交给译码器。
 *
 * 只读：不写 FactorState、不改稿、不触发重采样。存在的意义是让「译码器」
 * 先对着真实账本跑出可比较的报告，等第三批消融通过后再接修复回路。
 */

import type { FactorKind, FactorState } from "./factor-state.js";
import {
  buildFaultCandidates,
  decodeSyndrome,
  describeDecode,
  syndromeKey,
  type DecodeResult,
  type FaultWeightTable,
  type SyndromeBit,
} from "./syndrome-decoder.js";

export type SyndromeObservation = {
  bits: SyndromeBit[];
  decoded: DecodeResult;
  note: string;
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

export function observeSyndrome(
  state: FactorState,
  options: { weights?: FaultWeightTable; maxFaults?: number } = {},
): SyndromeObservation {
  const bits = syndromeFromState(state);
  const decoded = decodeSyndrome(bits, buildFaultCandidates(bits, { weights: options.weights }), {
    maxFaults: options.maxFaults,
  });
  return { bits, decoded, note: describeDecode(decoded) };
}
