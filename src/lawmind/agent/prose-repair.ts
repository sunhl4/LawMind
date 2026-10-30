/**
 * 同回合金额修复计划。
 *
 * 只处理一种最机械、最可判定的冲突：账本有工具核定的金额，模型在最终回复里
 * 写成了另一个数。计划用最小权重译码把「同一处错数出现在多个金额槽」归成
 * 一个根因，然后只重做这些槽；法律判断和其余段落不动。
 *
 * 刻意不处理：
 * - 引用冲突（交给 same-turn verify 的引用门）；
 * - 没有工具读数、只是「未核实」的金额；
 * - 模型没有在当前回复里写出来的旧冲突（重采样修不到）。
 *
 * 返回动作只给 turn-loop 策略消费；本模块不写历史、不调用模型。
 */

import {
  advanceRepair,
  proposalSupported,
  projectReading,
  type FactorState,
} from "./factor-state.js";
import {
  buildFaultCandidates,
  decodeSyndrome,
  syndromeKey,
  type Fault,
  type SyndromeBit,
} from "./syndrome-decoder.js";

export type ProseRepairPlan =
  | { action: "none"; reason?: string }
  | { action: "bounce"; note: string; anchors: string[] }
  | { action: "deliver"; pending: string; anchors: string[] };

type AmountConflict = {
  bits: SyndromeBit[];
  proposals: Map<string, string[]>;
};

function collectAmountConflicts(state: FactorState, prose: string): AmountConflict {
  const bits: SyndromeBit[] = [];
  const proposals = new Map<string, string[]>();
  for (const factor of state.factors) {
    if (factor.kind !== "amount" || factor.flag !== "conflict") {
      continue;
    }
    if (factor.proposalId && !proposalSupported(factor, state.turnEpoch)) {
      continue;
    }
    const proposal = factor.proposalId?.trim();
    if (!proposal || !prose.includes(proposal)) {
      continue;
    }
    // Only bounce when the ledger has one definite value to write back.
    if (projectReading(factor.outcomes).kind !== "definite") {
      continue;
    }
    bits.push({
      stabilizer: "S2",
      anchor: factor.anchor,
      check: "value",
    });
    const anchors = proposals.get(proposal) ?? [];
    if (!anchors.includes(factor.anchor)) {
      anchors.push(factor.anchor);
    }
    proposals.set(proposal, anchors);
  }
  return { bits, proposals };
}

function proposalFaults(
  bits: readonly SyndromeBit[],
  proposals: ReadonlyMap<string, readonly string[]>,
): Fault[] {
  const faults: Fault[] = [];
  for (const [proposal, anchors] of proposals) {
    if (anchors.length < 2) {
      continue;
    }
    faults.push({
      id: `correlated_reuse:proposal:${proposal}`,
      kind: "correlated_reuse",
      anchors: [...anchors],
      explains: bits.filter((bit) => anchors.includes(bit.anchor)).map((bit) => syndromeKey(bit)),
      weight: Math.min(1.5, 0.55 * anchors.length),
      note: `同一处错数「${proposal}」同时出现在 ${anchors.length} 个金额槽`,
    });
  }
  return faults;
}

/**
 * 只有译码唯一解才反弹；同价/无解一律不动，避免把「不确定」变成一次
 * 没有根据的重采样。
 */
export function planProseRepair(state: FactorState | undefined, prose: string): ProseRepairPlan {
  if (!state || !prose.trim()) {
    return { action: "none" };
  }
  const { bits, proposals } = collectAmountConflicts(state, prose);
  if (bits.length === 0) {
    return { action: "none" };
  }
  const faults = [...buildFaultCandidates(bits), ...proposalFaults(bits, proposals)];
  const decoded = decodeSyndrome(bits, faults);
  if (decoded.kind !== "unique") {
    return { action: "none", reason: `decoder_${decoded.kind}` };
  }
  const known = new Set(bits.map((bit) => bit.anchor));
  const anchors = decoded.repairAnchors.filter((anchor) => known.has(anchor));
  if (anchors.length === 0) {
    return { action: "none", reason: "decoder_no_known_anchor" };
  }
  const selectedFaults = decoded.faults;
  state.pendingRepairCalibration = {
    faultKinds: selectedFaults.map((fault) => fault.kind),
    anchors,
  };
  const decisions = anchors.map((anchor) => ({
    anchor,
    decision: advanceRepair(state, anchor, "S2"),
  }));
  const capped = decisions.find((row) => row.decision.action === "deliver");
  if (capped?.decision.action === "deliver") {
    return { action: "deliver", pending: capped.decision.pending, anchors };
  }
  const notes = decisions.flatMap((row) =>
    row.decision.action === "bounce" ? [row.decision.note] : [],
  );
  const note =
    anchors.length === 1
      ? (notes[0] ?? `【因子修复】只重做这一处：${anchors[0]}。不要改其他锚。`)
      : `【因子修复】同一处错数影响这些金额槽：${anchors.join("、")}。只重做这些，不要改其他锚。`;
  return { action: "bounce", note, anchors };
}
