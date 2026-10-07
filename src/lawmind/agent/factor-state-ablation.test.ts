/**
 * Frozen-fixture ablation. Not a lawyer-graded manuscript set.
 *
 * plain: no factor state. A non-empty sentence ships as the fact.
 *   Two wordings: the longer sentence wins.
 * stringHook: the previous diagonal hook. Stabilizers catch a bad
 *   citation, a missing amount, and an empty redline, but fusion keys
 *   are the conclusion strings, mass 1 with no span still projects to a
 *   definite sentence, and the failed sentence stays in the next context.
 * treatment: grounded projection, outcome-id merge, mechanical note beside the prose.
 *
 * The counts are the experiment. They do not show that the six delivery
 * defects are solved on real matters.
 */
import { describe, expect, it } from "vitest";
import {
  appendMechanicalNote,
  applyInverseEdits,
  applyProseSyndrome,
  bodiesForNextRender,
  consumeRedlineRepair,
  editContradictsGroundedAmount,
  emptyFactorState,
  extractSkeletonHeadings,
  formatMarginalBlock,
  fuseSharedAnchorLines,
  ingestDefinedTerms,
  ingestToolResult,
  marginalFactors,
  rememberSkeleton,
  productMerge,
  projectReading,
  projectToolResultForSampling,
  recordInverseEdits,
  recordReading,
  renderEngineReadings,
  restoreBodies,
  revertProposals,
} from "./factor-state.js";

type ErrorCode =
  | "citation_outside_pack"
  | "amount_mismatch"
  | "definition_drift"
  | "redline_empty"
  | "ungrounded_as_fact"
  | "false_conflict"
  | "failed_prose_reentered"
  | "irreversible_overwrite"
  | "context_cloned"
  | "amount_lost_after_compact"
  | "wrong_amount_written"
  | "party_drift"
  | "edit_not_inverted"
  | "duplicate_edit_not_inverted"
  | "alias_definition_dropped"
  | "mechanical_dropped"
  | "skeleton_lost"
  | "word_frozen_mid_write"
  | "tool_packaging_resampled"
  | "definition_cycle_collapsed"
  | "citation_span_lost_after_compact";

type Score = Record<ErrorCode, number>;

function emptyScore(): Score {
  return {
    citation_outside_pack: 0,
    amount_mismatch: 0,
    definition_drift: 0,
    redline_empty: 0,
    ungrounded_as_fact: 0,
    false_conflict: 0,
    failed_prose_reentered: 0,
    irreversible_overwrite: 0,
    context_cloned: 0,
    amount_lost_after_compact: 0,
    wrong_amount_written: 0,
    party_drift: 0,
    edit_not_inverted: 0,
    duplicate_edit_not_inverted: 0,
    alias_definition_dropped: 0,
    mechanical_dropped: 0,
    skeleton_lost: 0,
    word_frozen_mid_write: 0,
    tool_packaging_resampled: 0,
    definition_cycle_collapsed: 0,
    citation_span_lost_after_compact: 0,
  };
}

function total(score: Score): number {
  return Object.values(score).reduce((sum, count) => sum + count, 0);
}

describe("factor ablation", () => {
  it("beats plain delivery and the string-keyed hook on the frozen fixtures", () => {
    const plain = emptyScore();
    const stringHook = emptyScore();
    const treatment = emptyScore();

    const outside = "根据〔fake-9〕，应当付款。";
    if (outside.includes("应当付款")) {
      plain.citation_outside_pack += 1;
    }
    const outsideState = emptyFactorState();
    applyProseSyndrome(outsideState, outside);
    if (
      !outsideState.factors.some((factor) => factor.kind === "citation" && factor.flag !== "ok")
    ) {
      stringHook.citation_outside_pack += 1;
      treatment.citation_outside_pack += 1;
    }

    const demoState = emptyFactorState();
    ingestToolResult(demoState, "search_statute", { sourceIds: ["npc-1"], demoCorpus: true });
    const demoProse = "根据权威来源〔npc-1〕，应当付款。";
    if (demoProse.includes("权威") && !demoProse.includes("演示语料")) {
      plain.citation_outside_pack += 1;
    }
    const demoCopy = emptyFactorState();
    ingestToolResult(demoCopy, "search_statute", { sourceIds: ["npc-1"], demoCorpus: true });
    applyProseSyndrome(demoState, demoProse);
    if (!demoState.factors.some((factor) => factor.flag !== "ok")) {
      stringHook.citation_outside_pack += 1;
    }
    applyProseSyndrome(demoCopy, demoProse);
    if (!demoCopy.factors.some((factor) => factor.flag !== "ok")) {
      treatment.citation_outside_pack += 1;
    }

    const amountProse = "经济补偿为 99999 元。";
    if (amountProse.includes("99999")) {
      plain.amount_mismatch += 1;
    }
    const amountHook = emptyFactorState();
    const amountNow = emptyFactorState();
    ingestToolResult(amountHook, "calculate", { op: "economic_compensation", value: 88000 });
    ingestToolResult(amountNow, "calculate", { op: "economic_compensation", value: 88000 });
    applyProseSyndrome(amountHook, amountProse);
    if (!amountHook.factors.some((factor) => factor.kind === "amount" && factor.flag !== "ok")) {
      stringHook.amount_mismatch += 1;
    }
    applyProseSyndrome(amountNow, amountProse);
    if (!amountNow.factors.some((factor) => factor.kind === "amount" && factor.flag !== "ok")) {
      treatment.amount_mismatch += 1;
    }

    const definitionProse = "违约金为合同总额的 30%。";
    if (!definitionProse.includes("20%")) {
      plain.definition_drift += 1;
    }
    const definition = productMerge(
      [{ id: "20%", mass: 1, grounded: true }],
      [{ id: "30%", mass: 1, grounded: false }],
    );
    if (!definition.conflict) {
      stringHook.definition_drift += 1;
      treatment.definition_drift += 1;
    }

    if ("修订已完成。".includes("已完成")) {
      plain.redline_empty += 1;
    }
    const redlineHook = emptyFactorState();
    const redlineNow = emptyFactorState();
    ingestToolResult(redlineHook, "render_tracked_draft", { code: "xml_qa_no_tracks" });
    ingestToolResult(redlineNow, "render_tracked_draft", { code: "xml_qa_no_tracks" });
    if (!consumeRedlineRepair(redlineHook).note) {
      stringHook.redline_empty += 1;
    }
    if (!consumeRedlineRepair(redlineNow).note) {
      treatment.redline_empty += 1;
    }

    if ("乙方有权解除。".trim().length > 0) {
      plain.ungrounded_as_fact += 1;
      stringHook.ungrounded_as_fact += 1;
    }
    const bare = emptyFactorState();
    recordReading(bare, "clause:解除", "clause", "乙方有权解除", false);
    const bareFactor = bare.factors[0];
    if (bareFactor && projectReading(bareFactor.outcomes).kind === "definite") {
      treatment.ungrounded_as_fact += 1;
    }

    const left = "乙方有权解除";
    const right = "乙方可以解除本合同";
    const oldStringIdentity = left === right ? "same" : "conflict";
    if (oldStringIdentity === "conflict") {
      stringHook.false_conflict += 1;
    }
    const paraphrased = fuseSharedAnchorLines([
      { anchor: "clause:解除", outcomeId: "may_terminate", conclusion: left, span: "第15条" },
      { anchor: "clause:解除", outcomeId: "may_terminate", conclusion: right, span: "第15条" },
    ]);
    if (paraphrased.some((line) => line.startsWith("【待核实】"))) {
      treatment.false_conflict += 1;
    }

    if (`${amountProse}\n请重写`.includes("99999") && !amountProse.includes("88000")) {
      plain.failed_prose_reentered += 1;
      stringHook.failed_prose_reentered += 1;
    }
    const kept = appendMechanicalNote(amountProse, amountNow);
    if (!kept.includes(amountProse) || !kept.includes("88000") || !kept.includes("【机械核定】")) {
      treatment.failed_prose_reentered += 1;
    }

    const overwritten = emptyFactorState();
    ingestToolResult(overwritten, "calculate", { op: "economic_compensation", value: 88000 });
    applyProseSyndrome(overwritten, amountProse);
    if (amountProse.includes("99999")) {
      plain.irreversible_overwrite += 1;
      stringHook.irreversible_overwrite += 1;
    }
    revertProposals(overwritten, []);
    const restored = overwritten.factors.find(
      (factor) => factor.anchor === "amount:economic_compensation",
    );
    if (restored?.proposalId || projectReading(restored?.outcomes ?? []).kind !== "definite") {
      treatment.irreversible_overwrite += 1;
    }

    const wide = emptyFactorState();
    ingestToolResult(wide, "calculate", {
      op: "wage",
      value: 88000,
      clauseAnchor: "clause:解除",
    });
    recordReading(wide, "clause:管辖", "clause", "上海仲裁", true);
    const plainWorker = wide.factors.map((factor) => factor.anchor).join("\n");
    if (plainWorker.includes("clause:管辖")) {
      plain.context_cloned += 1;
    }
    const reduced = formatMarginalBlock(marginalFactors(wide, ["clause:解除"]));
    if (reduced.includes("上海仲裁") || reduced.includes("clause:管辖")) {
      stringHook.context_cloned += 1;
      treatment.context_cloned += 1;
    }

    const remembered = emptyFactorState();
    ingestToolResult(remembered, "calculate", { op: "economic_compensation", value: 88000 });
    const droppedHistory = "";
    if (!droppedHistory.includes("88000")) {
      plain.amount_lost_after_compact += 1;
      stringHook.amount_lost_after_compact += 1;
    }
    if (!renderEngineReadings(remembered).includes("88000")) {
      treatment.amount_lost_after_compact += 1;
    }
    const badEdit = [{ find: "补偿 88000 元", replace: "补偿 99999 元" }];
    const otherEdit = [{ find: "违约金", replace: "上限 100000 元" }];
    if (JSON.stringify(badEdit).includes("99999")) {
      plain.wrong_amount_written += 1;
      stringHook.wrong_amount_written += 1;
    }
    if (editContradictsGroundedAmount(remembered, badEdit) === undefined) {
      treatment.wrong_amount_written += 1;
    }
    expect(editContradictsGroundedAmount(remembered, otherEdit)).toBeUndefined();

    const partyProse = "买方应于三日内付款。";
    if (partyProse.includes("买方")) {
      plain.party_drift += 1;
      stringHook.party_drift += 1;
    }
    const parties = emptyFactorState();
    ingestDefinedTerms(parties, "甲方：北京示例科技有限公司");
    expect(applyProseSyndrome(parties, partyProse).action).toBe("none");
    const party = parties.factors.find((factor) => factor.anchor === "party:买方");
    if (!party || projectReading(party.outcomes).kind === "definite") {
      treatment.party_drift += 1;
    }
    const original = "甲方应于三日内付款。";
    const replaced = original.replace("甲方", "买方");
    if (replaced.includes("买方")) {
      plain.edit_not_inverted += 1;
      stringHook.edit_not_inverted += 1;
    }
    const invertible = emptyFactorState();
    recordInverseEdits(invertible, [{ find: "甲方", replace: "买方" }]);
    if (applyInverseEdits(replaced, invertible.inverseEdits ?? []).text !== original) {
      treatment.edit_not_inverted += 1;
    }
    const duplicated = "甲方与甲方签订。";
    const bothReplaced = duplicated.replaceAll("甲方", "买方");
    if (bothReplaced !== duplicated) {
      plain.duplicate_edit_not_inverted += 1;
      stringHook.duplicate_edit_not_inverted += 1;
    }
    if (applyInverseEdits(bothReplaced, [{ find: "买方", replace: "甲方" }]).text === duplicated) {
      treatment.duplicate_edit_not_inverted += 1;
    }
    if (restoreBodies([bothReplaced], [duplicated])[0] !== duplicated) {
      treatment.duplicate_edit_not_inverted += 1;
    }
    const aliasState = emptyFactorState();
    ingestDefinedTerms(aliasState, "北京示例科技有限公司（以下简称「公司」）");
    if (!"公司".includes("北京示例科技有限公司")) {
      plain.alias_definition_dropped += 1;
      stringHook.alias_definition_dropped += 1;
    }
    const aliasBlock = formatMarginalBlock(marginalFactors(aliasState, ["defined:公司"]));
    if (!aliasBlock.includes("北京示例科技有限公司")) {
      treatment.alias_definition_dropped += 1;
    }

    const judgment = "补偿应为 99999 元，因为相对方履行不能。";
    if (!judgment.includes("88000")) {
      plain.mechanical_dropped += 1;
      stringHook.mechanical_dropped += 1;
    }
    const mechanical = emptyFactorState();
    ingestToolResult(mechanical, "calculate", { op: "economic_compensation", value: 88000 });
    applyProseSyndrome(mechanical, judgment);
    const voiced = appendMechanicalNote(judgment, mechanical);
    if (!voiced.includes(judgment) || !voiced.includes("88000")) {
      treatment.mechanical_dropped += 1;
    }
    const outline = "第一条 付款\n第二条 违约";
    if (!"".includes("第一条 付款")) {
      plain.skeleton_lost += 1;
      stringHook.skeleton_lost += 1;
    }
    const skeleton = emptyFactorState();
    rememberSkeleton(skeleton, extractSkeletonHeadings(outline), "document");
    const skeletonBlock = renderEngineReadings(skeleton);
    if (!skeletonBlock.includes("第一条 付款") || !skeletonBlock.includes("可改、可增、可删")) {
      treatment.skeleton_lost += 1;
    }
    if (skeletonBlock.includes("必须逐句")) {
      treatment.skeleton_lost += 1;
    }
    const midWrite = ["买方与买方签订。"];
    if (midWrite[0] !== "甲方与甲方签订。") {
      plain.word_frozen_mid_write += 1;
      stringHook.word_frozen_mid_write += 1;
    }
    if (bodiesForNextRender(midWrite, ["甲方与甲方签订。"])[0] !== "甲方与甲方签订。") {
      treatment.word_frozen_mid_write += 1;
    }

    const statute = "第三十六条 用人单位与劳动者协商一致，可以解除劳动合同。";
    const bulky = JSON.stringify({
      ok: true,
      data: {
        hits: [{ title: "劳动合同法", snippet: statute }],
        workspaceHits: [{ snippet: "DUPLICATE-PACKAGING" }],
      },
    });
    if (bulky.includes("DUPLICATE-PACKAGING")) {
      plain.tool_packaging_resampled += 1;
      stringHook.tool_packaging_resampled += 1;
    }
    const sampled = projectToolResultForSampling(bulky);
    if (sampled.includes("DUPLICATE-PACKAGING") || !sampled.includes(statute)) {
      treatment.tool_packaging_resampled += 1;
    }
    const firstDefinition = "北京示例科技有限公司";
    if (!firstDefinition.includes("上海示例贸易有限公司")) {
      plain.definition_cycle_collapsed += 1;
      stringHook.definition_cycle_collapsed += 1;
    }
    const cycleState = emptyFactorState();
    ingestDefinedTerms(
      cycleState,
      "甲方：北京示例科技有限公司（以下简称「公司」）\n买方：上海示例贸易有限公司（以下简称「公司」）",
    );
    const cycleBlock = renderEngineReadings(cycleState);
    if (
      !cycleBlock.includes("【定义环】") ||
      !cycleBlock.includes("不要选边") ||
      !cycleBlock.includes("上海示例贸易有限公司")
    ) {
      treatment.definition_cycle_collapsed += 1;
    }
    if (!"".includes(statute)) {
      plain.citation_span_lost_after_compact += 1;
      stringHook.citation_span_lost_after_compact += 1;
    }
    const spanState = emptyFactorState();
    ingestToolResult(spanState, "search_statute", {
      hits: [{ title: "劳动合同法", snippet: statute }],
    });
    const spanBlock = renderEngineReadings(spanState);
    if (!spanBlock.includes("【引用原文】") || !spanBlock.includes(statute)) {
      treatment.citation_span_lost_after_compact += 1;
    }

    expect(plain).toEqual({
      citation_outside_pack: 2,
      amount_mismatch: 1,
      definition_drift: 1,
      redline_empty: 1,
      ungrounded_as_fact: 1,
      false_conflict: 0,
      failed_prose_reentered: 1,
      irreversible_overwrite: 1,
      context_cloned: 1,
      amount_lost_after_compact: 1,
      wrong_amount_written: 1,
      party_drift: 1,
      edit_not_inverted: 1,
      duplicate_edit_not_inverted: 1,
      alias_definition_dropped: 1,
      mechanical_dropped: 1,
      skeleton_lost: 1,
      word_frozen_mid_write: 1,
      tool_packaging_resampled: 1,
      definition_cycle_collapsed: 1,
      citation_span_lost_after_compact: 1,
    });
    expect(stringHook).toEqual({
      citation_outside_pack: 0,
      amount_mismatch: 0,
      definition_drift: 0,
      redline_empty: 0,
      ungrounded_as_fact: 1,
      false_conflict: 1,
      failed_prose_reentered: 1,
      irreversible_overwrite: 1,
      context_cloned: 0,
      amount_lost_after_compact: 1,
      wrong_amount_written: 1,
      party_drift: 1,
      edit_not_inverted: 1,
      duplicate_edit_not_inverted: 1,
      alias_definition_dropped: 1,
      mechanical_dropped: 1,
      skeleton_lost: 1,
      word_frozen_mid_write: 1,
      tool_packaging_resampled: 1,
      definition_cycle_collapsed: 1,
      citation_span_lost_after_compact: 1,
    });
    expect(treatment).toEqual(emptyScore());
    expect(total(plain)).toBe(21);
    expect(total(stringHook)).toBe(16);
    expect(total(treatment)).toBe(0);

    const opposed = fuseSharedAnchorLines([
      { anchor: "clause:解除", outcomeId: "may_terminate", conclusion: "乙方有权解除" },
      { anchor: "clause:解除", outcomeId: "may_not", conclusion: "乙方无权解除" },
    ]);
    expect(opposed[0]).toContain("【待核实】");
  });

  it("a few-qubit Z measurement does not beat the diagonal rule", () => {
    const conflict = productMerge(
      [{ id: "may", mass: 1, grounded: true }],
      [{ id: "may_not", mass: 1, grounded: true }],
    );
    expect(conflict.conflict).toBe(true);

    // One qubit in the computational basis. Relative phase φ cancels in |α|².
    const phi = 1.7;
    const p0 = 0.9;
    const born0 = p0 * Math.cos(phi) ** 2 + p0 * Math.sin(phi) ** 2;
    expect(born0).toBeCloseTo(p0, 12);

    // Product merge already set the invalid joint mass to 0. Mixing that
    // basis state back in with an uncalibrated amplitude √ε only raises it.
    const invalidBefore = 0;
    const epsilon = 0.5;
    const invalidAfter = (Math.sqrt(epsilon) * 1) ** 2;
    expect(invalidBefore).toBe(0);
    expect(invalidAfter).toBeCloseTo(epsilon, 12);
    expect(invalidAfter).toBeGreaterThan(invalidBefore);
  });
});
