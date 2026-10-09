import { describe, expect, it } from "vitest";
import {
  ADIABATIC_MAX_STEPS,
  GAMMA_STAR,
  REJECTED_PROSE_MARKER,
  appendMechanicalNote,
  applyProseSyndrome,
  applyInverseEdits,
  beginTurnFactors,
  composeWorkerSystem,
  bodiesForNextRender,
  consumeRedlineRepair,
  correctionCone,
  bindSkeletonSlot,
  emptyFactorState,
  editContradictsGroundedAmount,
  extractSkeletonHeadings,
  formatMarginalBlock,
  fuseSharedAnchorLines,
  hopTruncation,
  ingestDefinedTerms,
  ingestDraftBody,
  ingestMaterialAmounts,
  ingestToolResult,
  linkNeighbors,
  renderEngineReadings,
  withholdFailedProse,
  lightConeAnchors,
  marginalFactors,
  rememberSkeleton,
  productMerge,
  projectAssistantProseForSampling,
  projectReading,
  projectToolResultForSampling,
  purity,
  mapEditsToFactorAnchors,
  recordBodySnapshot,
  recordInverseEdits,
  recordReading,
  restoreBodies,
  revertProposals,
  selectInverseEditsForCone,
  selectSkeleton,
  resolveKnownTemplateId,
  templateIdForInstruction,
  surgicalPayloadOutsideLightCone,
} from "./factor-state.js";
import type { AgentContext } from "./types.js";

describe("factor purity", () => {
  it("treats a peaked binary reading as definite and a split one as mixed", () => {
    expect(
      purity([
        { id: "a", mass: 0.9 },
        { id: "b", mass: 0.1 },
      ]),
    ).toBeGreaterThanOrEqual(GAMMA_STAR);
    expect(
      projectReading([
        { id: "a", mass: 0.9, grounded: true },
        { id: "b", mass: 0.1, grounded: true },
      ]),
    ).toEqual({
      kind: "definite",
      id: "a",
    });
    expect(
      projectReading([
        { id: "a", mass: 0.9 },
        { id: "b", mass: 0.1 },
      ]).kind,
    ).toBe("mixed");
    const split = projectReading([
      { id: "a", mass: 0.6, grounded: true },
      { id: "b", mass: 0.4, grounded: true },
    ]);
    expect(split.kind).toBe("mixed");
    if (split.kind === "mixed") {
      expect(split.ids).toEqual(["a", "b"]);
    }
  });

  it("keeps an ungrounded peaked reading mixed", () => {
    expect(projectReading([{ id: "乙方有权解除", mass: 1, grounded: false }])).toEqual({
      kind: "mixed",
      ids: ["乙方有权解除"],
    });
    expect(projectReading([{ id: "乙方有权解除", mass: 1 }]).kind).toBe("mixed");
  });

  it("does not argmax a mixed reading", () => {
    const reading = projectReading([
      { id: "pay", mass: 0.55 },
      { id: "refuse", mass: 0.45 },
    ]);
    expect(reading.kind).toBe("mixed");
  });
});

describe("product merge", () => {
  it("marks disjoint support as conflict", () => {
    const merged = productMerge(
      [{ id: "乙方有权解除", mass: 1 }],
      [{ id: "乙方无权解除", mass: 1 }],
    );
    expect(merged.conflict).toBe(true);
    expect(merged.outcomes).toEqual([]);
  });

  it("reinforces the same reading", () => {
    const merged = productMerge(
      [{ id: "应当支付", mass: 1, grounded: true }],
      [{ id: "应当支付", mass: 1, grounded: true }],
    );
    expect(merged.conflict).toBe(false);
    expect(projectReading(merged.outcomes)).toEqual({ kind: "definite", id: "应当支付" });
  });
});

describe("marginal and light cone", () => {
  it("keeps the named anchor and its one-hop neighbor only", () => {
    const state = emptyFactorState();
    state.factors.push(
      {
        anchor: "clause:解除",
        kind: "clause",
        outcomes: [{ id: "a", mass: 1 }],
        repairs: 0,
        flag: "ok",
        neighbors: ["amount:wage"],
      },
      {
        anchor: "amount:wage",
        kind: "amount",
        outcomes: [{ id: "88000", mass: 1 }],
        repairs: 0,
        flag: "ok",
        neighbors: [],
      },
      {
        anchor: "clause:管辖",
        kind: "clause",
        outcomes: [{ id: "仲裁", mass: 1 }],
        repairs: 0,
        flag: "ok",
        neighbors: ["clause:远"],
      },
    );
    expect(marginalFactors(state, ["clause:解除"]).map((factor) => factor.anchor)).toEqual([
      "clause:解除",
      "amount:wage",
    ]);
    expect(lightConeAnchors(state, ["clause:解除"])).toEqual(["clause:解除", "amount:wage"]);
    expect(hopTruncation(state, ["clause:解除"])).toEqual({
      hop1: ["clause:解除", "amount:wage"],
      longRange: [],
      isolated: ["clause:管辖"],
      mechanicalDropped: [],
    });
  });

  it("counts a 2-hop citation as mechanicalDropped and does not put it in the 1-hop block", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "提前通知解除", true);
    recordReading(state, "amount:wage", "amount", "15000", true);
    recordReading(state, "citation:labor-47", "citation", "live", true, "每满一年支付一个月工资");
    recordReading(state, "clause:管辖", "clause", "仲裁", true, "争议提交仲裁");
    linkNeighbors(state, "clause:解除", "amount:wage");
    linkNeighbors(state, "amount:wage", "citation:labor-47");
    const report = hopTruncation(state, ["clause:解除"]);
    expect(report.hop1).toEqual(["clause:解除", "amount:wage"]);
    expect(report.longRange).toEqual(["citation:labor-47"]);
    expect(report.mechanicalDropped).toEqual(["citation:labor-47"]);
    expect(report.isolated).toEqual(["clause:管辖"]);
    const block = formatMarginalBlock(marginalFactors(state, ["clause:解除"]));
    expect(block).toContain("amount:wage");
    expect(block).not.toContain("citation:labor-47");
    expect(block).not.toContain("clause:管辖");
    const system = composeWorkerSystem({
      instructions: "只写解除这一段。",
      marginal: block,
      parentTranscript: "PARENT_SECRET",
    });
    expect(system).not.toContain("PARENT_SECRET");
    expect(system).not.toContain("citation:labor-47");
  });

  it("keeps the losing reading as 未核 when purity picks one side", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "提前通知解除", true);
    const factor = state.factors[0];
    expect(factor).toBeDefined();
    factor.outcomes = [
      { id: "提前通知解除", mass: 0.9, grounded: true },
      { id: "随时解除", mass: 0.1, grounded: true },
    ];
    const block = formatMarginalBlock(marginalFactors(state, ["clause:解除"]));
    expect(block).toContain("提前通知解除");
    expect(block).toContain("未核：随时解除");
    expect(block).not.toContain("【机械核定】");
  });

  it("pulls the whole term group into the marginal without widening hopTruncation", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:生效日", "clause", "2024年3月1日", true);
    recordReading(state, "clause:到期日", "clause", "本合同有效期至生效日起五年。", true);
    const block = formatMarginalBlock(marginalFactors(state, ["clause:生效日"]));
    expect(block).toContain("clause:到期日");
    expect(block).toContain("本合同有效期至生效日起五年。");
    const report = hopTruncation(state, ["clause:生效日"]);
    expect(report.hop1).not.toContain("clause:到期日");
  });

  it("marks a long party span unchecked and does not spend an outline slot on clause presence", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:当事人", "clause", "甲方某某公司（以下简称甲方）。", true);
    const block = formatMarginalBlock(marginalFactors(state, ["clause:当事人"]));
    expect(block).toContain("未核：");
    expect(block).toContain("短片段");
    expect(bindSkeletonSlot(state, "clause:当事人")).toBe(true);
    expect(state.adiabaticStep).toBe(0);
    ingestToolResult(state, "calculate", { op: "wage", value: 15000 });
    expect(state.adiabaticStep).toBe(0);
  });

  it("drops parent transcript from the worker system text", () => {
    const system = composeWorkerSystem({
      instructions: "只写这一段。",
      marginal: "【约化因子】\n- clause:解除：a",
      parentTranscript: "PARENT_SECRET_HISTORY",
    });
    expect(system).toContain("clause:解除");
    expect(system).not.toContain("PARENT_SECRET_HISTORY");
  });

  it("uses the last surgical batch when the correction names nothing", () => {
    const state = emptyFactorState();
    state.lastSurgicalAnchors = ["task-a"];
    expect(correctionCone(state, [])).toEqual(["task-a"]);
    expect(surgicalPayloadOutsideLightCone(["task-a"], { task_id: "task-b", edits: [] })).toBe(
      true,
    );
    expect(surgicalPayloadOutsideLightCone(["task-a"], { task_id: "task-a" })).toBe(false);
    expect(surgicalPayloadOutsideLightCone([], { task_id: "task-b" })).toBe(false);
  });

  it("maps 仲裁 to 管辖 and zero-writes edits outside the factor cone", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "提前通知解除", true, "甲方有权提前通知解除");
    recordReading(state, "amount:wage", "amount", "88000", true);
    recordReading(state, "clause:管辖", "clause", "仲裁", true, "争议提交仲裁");
    linkNeighbors(state, "clause:解除", "amount:wage");
    const cone = correctionCone(state, ["clause:解除"]);
    expect(cone).toEqual(["clause:解除", "amount:wage"]);
    expect(mapEditsToFactorAnchors(state, [{ find: "仲裁", replace: "诉讼" }])).toContain(
      "clause:管辖",
    );
    expect(
      surgicalPayloadOutsideLightCone(
        cone,
        { task_id: "task-a", edits: [{ find: "仲裁", replace: "诉讼" }] },
        state,
      ),
    ).toBe(true);
    expect(
      surgicalPayloadOutsideLightCone(
        cone,
        { task_id: "task-a", edits: [{ find: "解除", replace: "协商解除" }] },
        state,
      ),
    ).toBe(false);
  });

  it("maps 甲方应向 to defined:甲方 even after a 甲/买 split", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, "甲方：上海示例科技有限公司");
    const original = [{ find: "甲方应向", replace: "买方应向" }];
    expect(mapEditsToFactorAnchors(state, original)).toContain("defined:甲方");
    expect(mapEditsToFactorAnchors(state, [{ find: "甲", replace: "买" }])).not.toContain(
      "defined:甲方",
    );
    recordInverseEdits(state, [{ find: "甲", replace: "买" }], "甲方应向乙方支付。", original);
    expect(state.inverseEdits?.[0]?.anchors).toContain("defined:甲方");
  });

  it("holds the correction cone so a later 管辖 edit is still outside", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, "甲方：上海示例科技有限公司");
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
    recordReading(state, "clause:管辖", "clause", "仲裁", true, "争议提交仲裁");
    state.lastSurgicalAnchors = ["t-cone-d5", "defined:甲方"];
    const cone = correctionCone(state, []);
    state.correctionLightCone = cone;
    expect(cone).toContain("defined:甲方");
    expect(cone).not.toContain("clause:管辖");
    expect(
      surgicalPayloadOutsideLightCone(
        state.correctionLightCone ?? [],
        { task_id: "t-cone-d5", edits: [{ find: "仲裁", replace: "诉讼" }] },
        state,
      ),
    ).toBe(true);
  });

  it("reverts only inverse patches inside the cone and leaves the amount slot", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, "甲方：上海示例科技有限公司");
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
    recordInverseEdits(state, [{ find: "甲方", replace: "买方" }], "甲方应支付经济补偿 88000 元。");
    recordReading(state, "clause:管辖", "clause", "仲裁", true, "争议提交仲裁");
    recordInverseEdits(state, [{ find: "仲裁", replace: "诉讼" }], "争议提交仲裁。");
    const cone = lightConeAnchors(state, ["defined:甲方"]);
    const scoped = selectInverseEditsForCone(state, cone);
    expect(scoped.apply.some((edit) => edit.replace === "甲方")).toBe(true);
    expect(scoped.apply.some((edit) => edit.replace === "仲裁")).toBe(false);
    const amount = state.factors.find((factor) => factor.anchor === "amount:economic_compensation");
    expect(amount?.outcomes[0]?.id).toBe("88000");
  });
});

describe("stabilizers", () => {
  it("records a demo citation written as authority without consuming repairs", () => {
    const state = beginTurnFactors(emptyFactorState());
    ingestToolResult(state, "search_statute", {
      sourceIds: ["npc-1"],
      demoCorpus: true,
    });
    expect(applyProseSyndrome(state, "根据权威来源〔npc-1〕，应当付款。").action).toBe("none");
    const citation = state.factors.find((factor) => factor.anchor === "citation:npc-1");
    expect(citation?.flag).toBe("mixed");
    expect(citation?.outcomes[0]?.grounded).toBe(false);
    expect(citation?.repairs).toBe(0);
    const spanned = beginTurnFactors(emptyFactorState());
    ingestToolResult(spanned, "search_statute", {
      sourceIds: ["npc-1"],
      demoCorpus: true,
      hits: [{ title: "npc-1", snippet: "当事人应当按照约定全面履行自己的义务。" }],
    });
    expect(applyProseSyndrome(spanned, "根据权威来源〔npc-1〕，应当付款。").action).toBe("none");
    expect(spanned.factors.find((factor) => factor.anchor === "citation:npc-1")?.flag).toBe(
      "conflict",
    );
  });

  it("accepts a demo citation labeled 演示语料", () => {
    const state = beginTurnFactors(emptyFactorState());
    ingestToolResult(state, "search_statute", { sourceIds: ["npc-1"], demoCorpus: true });
    expect(applyProseSyndrome(state, "演示语料〔npc-1〕，不是权威来源。").action).toBe("none");
  });

  it("records a conflicting amount without bouncing the closing turn", () => {
    const state = beginTurnFactors(emptyFactorState());
    ingestToolResult(state, "calculate", {
      op: "economic_compensation",
      value: 88000,
      formula: "n*wage",
    });
    expect(applyProseSyndrome(state, "经济补偿为 99999 元。").action).toBe("none");
    const amount = state.factors.find((factor) => factor.anchor === "amount:economic_compensation");
    expect(amount?.flag).toBe("conflict");
    expect(amount?.repairs).toBe(0);
    expect(applyProseSyndrome(state, "经济补偿为 88000 元。").action).toBe("none");
    expect(amount?.flag).toBe("ok");
  });

  it("repairs an empty redline at most twice", () => {
    const state = beginTurnFactors(emptyFactorState());
    ingestToolResult(state, "render_tracked_draft", { code: "xml_qa_no_tracks" });
    expect(consumeRedlineRepair(state).note).toContain("redline:xml_qa_no_tracks");
    ingestToolResult(state, "render_tracked_draft", { code: "xml_qa_no_tracks" });
    expect(consumeRedlineRepair(state).note).toContain("redline:xml_qa_no_tracks");
    ingestToolResult(state, "render_tracked_draft", { code: "xml_qa_no_tracks" });
    expect(consumeRedlineRepair(state).pending).toBe("【待核实】redline:xml_qa_no_tracks");
  });
});

describe("skeleton", () => {
  it("picks the document, a builtin template, or a marked free draft", () => {
    expect(selectSkeleton({ revisingDocument: true }).kind).toBe("document");
    expect(selectSkeleton({ templateId: "complaint" }).kind).toBe("template");
    expect(selectSkeleton({}).header).toContain("未从已验证骨架变形");
  });

  it("does not choose a complaint template from the utterance", () => {
    expect(templateIdForInstruction("请起草起诉状")).toBeUndefined();
    expect(resolveKnownTemplateId("not-a-template")).toBeUndefined();
    expect(resolveKnownTemplateId("word/legal-memo-default")).toBe("word/legal-memo-default");
    expect(resolveKnownTemplateId("complaint")).toBe("complaint");
  });

  it("keeps the model sentence, marks only the mechanical conflict, and treats headings as editable", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
    const prose = "补偿应为 99999 元，因为相对方履行不能。";
    applyProseSyndrome(state, prose);
    const voiced = appendMechanicalNote(prose, state);
    expect(voiced.startsWith(prose)).toBe(true);
    expect(voiced).toContain("88000");
    expect(voiced).toContain("【机械核定】");
    rememberSkeleton(state, extractSkeletonHeadings("第一条 付款\n第二条 违约"), "document");
    const readings = renderEngineReadings(state);
    expect(readings).toContain("第一条 付款");
    expect(readings).toContain("可改、可增、可删");
    expect(readings).not.toContain("必须逐句");
    const midWrite = ["买方与买方签订。"];
    expect(bodiesForNextRender(midWrite, ["甲方与甲方签订。"])).toEqual(["甲方与甲方签订。"]);
    expect(bodiesForNextRender(midWrite, undefined)).toEqual(midWrite);
  });

  it("keeps extra adiabatic binds under the step cap", () => {
    const state = beginTurnFactors(emptyFactorState());
    state.adiabaticStep = ADIABATIC_MAX_STEPS;
    ingestToolResult(state, "calculate", { op: "interest", value: 12, formula: "p*r" });
    expect(applyProseSyndrome(state, "利息另计。").action).toBe("none");
    expect(applyProseSyndrome(state, "利息为 99999 元。").action).toBe("none");
    expect(state.adiabaticStep).toBe(ADIABATIC_MAX_STEPS);
  });
});

describe("body snapshots", () => {
  it("keeps the latest body per draft and only then applies the cap of 8", () => {
    const state = emptyFactorState();
    for (let index = 0; index < 9; index += 1) {
      recordBodySnapshot(state, "task-a", [`v${index}`]);
    }
    expect(state.bodySnapshots).toEqual([{ taskId: "task-a", bodies: ["v8"] }]);
    for (let index = 0; index < 8; index += 1) {
      recordBodySnapshot(state, `task-${index}`, ["x"]);
    }
    expect(state.bodySnapshots?.some((shot) => shot.taskId === "task-a")).toBe(false);
    expect(state.bodySnapshots).toHaveLength(8);
    recordBodySnapshot(state, "task-a", ["kept"]);
    expect(state.bodySnapshots?.at(-1)).toEqual({ taskId: "task-a", bodies: ["kept"] });
    expect(state.bodySnapshots?.some((shot) => shot.taskId === "task-0")).toBe(false);
    expect(state.bodySnapshots).toHaveLength(8);
  });
});

describe("light cone gate", () => {
  it("returns before any write when the edit misses the cone", async () => {
    const { applySurgicalEdits } = await import("./tools/engine/apply-surgical-edits-tool.js");
    const result = await applySurgicalEdits.execute(
      {
        task_id: "task-b",
        edits: [{ find: "甲", replace: "乙" }],
        craft_check: { deferred: [] },
      },
      {
        workspaceDir: "/tmp/lawmind-factor-cone",
        sessionId: "s",
        actorId: "a",
        correctionLightCone: ["task-a"],
      } as AgentContext,
    );
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ code: "light_cone_zero_write", written: false });
  });

  it("returns before any write when the replacement contradicts a grounded amount", async () => {
    const { applySurgicalEdits } = await import("./tools/engine/apply-surgical-edits-tool.js");
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
    const result = await applySurgicalEdits.execute(
      {
        task_id: "task-a",
        edits: [{ find: "补偿 88000 元", replace: "补偿 99999 元" }],
        craft_check: { deferred: [] },
      },
      {
        workspaceDir: "/tmp/lawmind-factor-amount",
        sessionId: "s",
        actorId: "a",
        factorState: state,
      } as AgentContext,
    );
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({
      code: "grounded_amount_zero_write",
      anchor: "amount:economic_compensation",
      written: false,
    });
  });

  it("records an undefined role as mixed and does not refuse the sentence", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, "甲方：北京示例科技有限公司");
    expect(applyProseSyndrome(state, "买方应于三日内付款。").action).toBe("none");
    const party = state.factors.find((factor) => factor.anchor === "party:买方");
    expect(projectReading(party?.outcomes ?? []).kind).toBe("mixed");
    expect(applyProseSyndrome(state, "甲方应于三日内付款。").action).toBe("none");
  });
});

describe("shared anchor fusion", () => {
  it("collapses two wordings of one outcome id and still conflicts different ids", () => {
    expect(
      fuseSharedAnchorLines([
        {
          anchor: "clause:解除",
          outcomeId: "may_terminate",
          conclusion: "乙方有权解除",
          span: "第15条",
        },
        {
          anchor: "clause:解除",
          outcomeId: "may_terminate",
          conclusion: "乙方可以解除本合同",
          span: "第15条",
        },
      ]),
    ).toEqual(["共享锚 clause:解除：may_terminate"]);
    expect(
      fuseSharedAnchorLines([
        { anchor: "clause:解除", outcomeId: "may_terminate", conclusion: "乙方有权解除" },
        { anchor: "clause:解除", outcomeId: "may_not", conclusion: "乙方无权解除" },
      ]),
    ).toEqual(["【待核实】clause:解除：乙方有权解除；乙方无权解除"]);
  });

  it("writes an edge the worker named and refuses an ungrounded reading", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "draft_worker", {
      anchor: "clause:解除",
      outcomeId: "may_terminate",
      span: "第15条",
      binds: ["amount:wage"],
    });
    expect(marginalFactors(state, ["clause:解除"]).map((factor) => factor.anchor)).toEqual([
      "clause:解除",
      "amount:wage",
    ]);
    expect(projectReading(state.factors[0]?.outcomes ?? [])).toEqual({
      kind: "definite",
      id: "may_terminate",
    });
    const quoted = emptyFactorState();
    quoted.citationSpans = [{ id: "劳动合同法", text: "可以解除劳动合同" }];
    ingestToolResult(quoted, "draft_worker", {
      anchor: "clause:付款",
      outcomeId: "pay",
      span: "乙方应于三日内付款",
    });
    expect(projectReading(quoted.factors[0]?.outcomes ?? []).kind).toBe("definite");
    expect(quoted.factors[0]?.outcomes[0]?.span).toContain("付款");
    recordReading(state, "clause:管辖", "clause", "仲裁", false);
    const jurisdiction = state.factors.find((factor) => factor.anchor === "clause:管辖");
    expect(projectReading(jurisdiction?.outcomes ?? []).kind).toBe("mixed");
    const failed = { content: "乙方有权解除。", hiddenFromLawyer: false };
    withholdFailedProse(failed);
    expect(failed.content).toBe(REJECTED_PROSE_MARKER);
    expect(failed.content).not.toContain("乙方有权解除");
  });

  it("treats a contradictory number as a reversible proposal and drops the far anchor", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", {
      op: "economic_compensation",
      value: 88000,
      clauseAnchor: "clause:解除",
    });
    recordReading(state, "clause:管辖", "clause", "上海仲裁", true);
    expect(applyProseSyndrome(state, "经济补偿为 99999 元。").action).toBe("none");
    const amount = state.factors.find((factor) => factor.anchor === "amount:economic_compensation");
    expect(amount?.proposalId).toBe("99999");
    expect(amount?.flag).toBe("conflict");
    expect(amount?.outcomes[0]).toMatchObject({ id: "88000", grounded: true });
    const block = formatMarginalBlock(marginalFactors(state, ["amount:economic_compensation"]));
    expect(block).toContain("88000");
    expect(block).toContain("【待核实】");
    expect(block).not.toContain("上海仲裁");
    revertProposals(state, []);
    expect(amount?.proposalId).toBeUndefined();
    expect(projectReading(amount?.outcomes ?? [])).toEqual({ kind: "definite", id: "88000" });
    const kept = renderEngineReadings(state);
    expect(kept).toContain("【引擎核定】");
    expect(kept).toContain("88000");
    expect(kept).not.toContain("99999");
    expect(
      editContradictsGroundedAmount(state, [{ find: "补偿 88000 元", replace: "补偿 99999 元" }]),
    ).toBe("amount:economic_compensation");
    expect(
      editContradictsGroundedAmount(state, [{ find: "违约金", replace: "上限 100000 元" }]),
    ).toBeUndefined();
  });

  it("rejects an undefined role and inverts a written edit back to the original words", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, "甲方：北京示例科技有限公司");
    expect(applyProseSyndrome(state, "买方应于三日内付款。").action).toBe("none");
    const party = state.factors.find((factor) => factor.anchor === "party:买方");
    expect(projectReading(party?.outcomes ?? []).kind).toBe("mixed");
    expect(applyProseSyndrome(state, "甲方应于三日内付款。").action).toBe("none");
    const written = "甲方应于三日内付款。";
    recordInverseEdits(state, [{ find: "甲方", replace: "买方" }]);
    const forward = written.replace("甲方", "买方");
    expect(forward).toBe("买方应于三日内付款。");
    const restored = applyInverseEdits(forward, state.inverseEdits ?? []);
    expect(restored).toEqual({ text: written, applied: 1 });
    const duplicated = "甲方与甲方签订。";
    const both = duplicated.replaceAll("甲方", "买方");
    expect(applyInverseEdits(both, [{ find: "买方", replace: "甲方" }]).applied).toBe(0);
    expect(restoreBodies([both], [duplicated])).toEqual([duplicated]);
    ingestDefinedTerms(state, "北京示例科技有限公司（以下简称「公司」）");
    const block = formatMarginalBlock(marginalFactors(state, ["defined:公司"]));
    expect(block).toContain("北京示例科技有限公司");
    expect(block).toContain("defined:公司");
  });

  it("writes 【待核实】 for opposite conclusions on one anchor and leaves free text alone", () => {
    expect(
      fuseSharedAnchorLines([
        { anchor: "clause:解除", conclusion: "乙方有权解除" },
        { anchor: "clause:解除", conclusion: "乙方无权解除" },
      ]),
    ).toEqual(["【待核实】clause:解除：乙方有权解除；乙方无权解除"]);
    expect(
      fuseSharedAnchorLines([
        { anchor: "clause:解除", conclusion: "乙方有权解除" },
        { anchor: "clause:解除", conclusion: "乙方可以解除本合同" },
      ]),
    ).toEqual([]);
    expect(
      fuseSharedAnchorLines([
        { anchor: "clause:解除", outcomeId: "may_terminate", conclusion: "乙方有权解除" },
        { anchor: "clause:解除", outcomeId: "may_terminate", conclusion: "乙方可以解除本合同" },
      ]),
    ).toEqual(["【待核实】clause:解除：may_terminate"]);
    expect(
      fuseSharedAnchorLines([
        {
          anchor: "clause:解除",
          outcomeId: "may_terminate",
          conclusion: "乙方有权解除",
          span: "乙方有权解除",
        },
        {
          anchor: "clause:解除",
          outcomeId: "may_terminate",
          conclusion: "乙方有权解除",
          span: "乙方无权解除",
        },
      ]),
    ).toEqual(["【待核实】clause:解除：乙方有权解除"]);
  });

  it("drops rejected amounts from the sampling view and keeps the lawyer sentence", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
    applyProseSyndrome(state, "经济补偿为 99999 元。");
    const voiced = appendMechanicalNote("经济补偿为 99999 元。", state);
    expect(voiced).toContain("99999");
    expect(projectAssistantProseForSampling(voiced, state)).not.toContain("99999");
    expect(projectAssistantProseForSampling(voiced, state)).toContain("88000");
    const other = "权威来源支持解除。\n根据权威来源〔npc-1〕应当付款。";
    const cited = emptyFactorState();
    ingestToolResult(cited, "search_statute", { sourceIds: ["npc-1"], demoCorpus: true });
    applyProseSyndrome(cited, other);
    const sampled = projectAssistantProseForSampling(other, cited);
    expect(sampled.split("\n")[0]).toContain("权威来源支持解除");
    expect(sampled).toContain("演示语料〔npc-1〕");
  });

  it("checks statute citations and money figures lawyers actually write", () => {
    const bare = emptyFactorState();
    expect(applyProseSyndrome(bare, "依据《民法典》第577条，应当付款。").action).toBe("none");
    expect(bare.factors.some((factor) => factor.flag === "conflict")).toBe(false);

    const retrieved = emptyFactorState();
    ingestToolResult(retrieved, "search_statute", {
      sourceIds: ["labor-36"],
      hits: [
        { title: "劳动合同法", snippet: "第三十六条 用人单位与劳动者协商一致，可以解除劳动合同。" },
      ],
    });
    applyProseSyndrome(retrieved, "依据《劳动合同法》第36条，可以解除。");
    expect(retrieved.factors.some((factor) => factor.anchor.includes("第36条"))).toBe(false);

    applyProseSyndrome(retrieved, "依据《劳动合同法》第99条，可以解除。");
    expect(
      retrieved.factors.some((factor) => factor.anchor.includes("第99条") && factor.flag !== "ok"),
    ).toBe(true);

    const amount = emptyFactorState();
    ingestToolResult(amount, "calculate", { op: "economic_compensation", value: 88000 });
    applyProseSyndrome(amount, "经济补偿为 8.8万元。另有案件受理费 50 元。");
    expect(amount.factors.find((factor) => factor.anchor.startsWith("amount:"))?.flag).not.toBe(
      "conflict",
    );
    applyProseSyndrome(amount, "经济补偿为 88,000元。");
    expect(amount.factors.find((factor) => factor.anchor.startsWith("amount:"))?.flag).not.toBe(
      "conflict",
    );
    applyProseSyndrome(amount, "经济补偿为 9万元。");
    expect(amount.factors.find((factor) => factor.anchor.startsWith("amount:"))?.flag).toBe(
      "conflict",
    );
  });
});

describe("citation spans and definition cycles", () => {
  it("keeps the copied statute text and drops duplicate hit packaging from the sampling view", () => {
    const statute = "第三十六条 用人单位与劳动者协商一致，可以解除劳动合同。";
    const state = emptyFactorState();
    ingestToolResult(state, "search_statute", {
      hits: [{ title: "劳动合同法", snippet: statute }],
      workspaceHits: [{ snippet: "DUPLICATE-PACKAGING" }],
    });
    const readings = renderEngineReadings(state);
    expect(readings).toContain("【引用原文】");
    expect(readings).toContain(statute);
    const bulky = JSON.stringify({
      ok: true,
      data: {
        hits: [{ title: "劳动合同法", snippet: statute }],
        workspaceHits: [{ snippet: "DUPLICATE-PACKAGING" }],
        authorityHits: [{ snippet: statute }],
      },
    });
    const sampled = projectToolResultForSampling(bulky);
    expect(sampled).toContain(statute);
    expect(sampled).not.toContain("DUPLICATE-PACKAGING");
    expect(sampled).not.toContain("authorityHits");
  });

  it("marks a definition cycle and does not pick a side", () => {
    const conflicted = emptyFactorState();
    ingestDefinedTerms(
      conflicted,
      "甲方：北京示例科技有限公司（以下简称「公司」）\n买方：上海示例贸易有限公司（以下简称「公司」）",
    );
    const readings = renderEngineReadings(conflicted);
    expect(readings).toContain("【定义环】");
    expect(readings).toContain("不要选边");
    expect(readings).toContain("北京示例科技有限公司");
    expect(readings).toContain("上海示例贸易有限公司");

    const consistent = emptyFactorState();
    ingestDefinedTerms(consistent, "甲方：北京示例科技有限公司（以下简称「公司」）");
    expect(renderEngineReadings(consistent)).not.toContain("【定义环】");
  });
});

describe("diagonal observations stay local", () => {
  it("does not treat a nearby contract price as the calculated interest", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "interest", value: 4321 });
    const prose = [
      "本合同价款总计为人民币 1280000 元。",
      "逾期利息为 99999 元。",
      "两种路径都写进意见，由律师选。",
    ].join("\n");
    applyProseSyndrome(state, prose);
    const voiced = appendMechanicalNote(prose, state);
    const sampled = projectAssistantProseForSampling(voiced, state);
    expect(voiced).toContain("两种路径");
    expect(sampled).toContain("1280000");
    expect(sampled).not.toContain("99999");
    expect(sampled).toContain("4321");
  });

  it("does not overwrite a contract price when the damages figure is not restated", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "liquidated_damages", value: 18600 });
    const prose = "本合同价款总计为人民币 1280000 元。若已按期提交，则应同时主张工期顺延。";
    applyProseSyndrome(state, prose);
    const sampled = projectAssistantProseForSampling(prose, state);
    expect(
      state.factors.find((factor) => factor.anchor === "amount:liquidated_damages")?.flag,
    ).not.toBe("conflict");
    expect(sampled).toContain("1280000");
    expect(sampled).not.toContain("18600");
  });

  it("keeps an extra statute name in the next sample after a different retrieve", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "search_statute", {
      sourceIds: ["civil-577"],
      hits: [
        {
          title: "中华人民共和国民法典",
          snippet:
            "第五百七十七条 当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担继续履行。",
        },
      ],
    });
    const prose =
      "隐蔽验收宜对照《中华人民共和国民法典》第八百零七条，并与《中华人民共和国建筑法》第二十六条分开写。两种路径都写进意见。";
    applyProseSyndrome(state, prose);
    const voiced = appendMechanicalNote(prose, state);
    const sampled = projectAssistantProseForSampling(voiced, state);
    expect(voiced).toContain("八百零七条");
    expect(sampled).toContain("八百零七条");
    expect(sampled).toContain("建筑法");
  });

  it("does not mark a role that already appears in the ingested draft", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, "发包方（甲方）：普华基础软件股份有限公司\n承包方（乙方）：");
    const prose =
      "验收合格后发包人拒不签字的，仍可主张视为批准；若验收不合格，则不得隐蔽。两种路径都写进意见。";
    applyProseSyndrome(state, prose);
    expect(state.factors.some((factor) => factor.anchor.startsWith("party:"))).toBe(false);
    expect(appendMechanicalNote(prose, state)).toContain("两种路径");
  });

  it("does not treat a newly written foreign role as this draft's support", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, "甲方：北京示例科技有限公司");
    applyProseSyndrome(state, "买方应于三日内付款。");
    expect(state.factors.find((factor) => factor.anchor === "party:买方")?.flag).toBe("mixed");
    ingestDraftBody(state, "买方应于三日内付款。甲方：北京示例科技有限公司");
    expect(state.documentRoles ?? []).not.toContain("买方");
    applyProseSyndrome(state, "买方继续履行，管辖争点宜另段展开。");
    expect(state.factors.find((factor) => factor.anchor === "party:买方")?.flag).toBe("mixed");
    expect(appendMechanicalNote("买方继续履行。", state)).toContain("继续履行");
  });

  it("inverts a repeated role when the write recorded its multiplicity", () => {
    const original = "甲方与甲方签订。";
    const state = emptyFactorState();
    recordInverseEdits(state, [{ find: "甲方", replace: "买方" }], original);
    const forward = original.replaceAll("甲方", "买方");
    const restored = applyInverseEdits(forward, state.inverseEdits ?? []);
    expect(restored).toEqual({ text: original, applied: 2 });
    expect(applyInverseEdits(forward, [{ find: "买方", replace: "甲方" }]).applied).toBe(0);
  });

  it("reads numbered contract outlines as an editable skeleton", () => {
    const headings = extractSkeletonHeadings("1 工程概况\n1.1 工程名称\n1.2 工程地点\n2 工程质量");
    expect(headings).toEqual(["1 工程概况", "1.1 工程名称", "1.2 工程地点", "2 工程质量"]);
  });

  it("flags a local polarity collision without rewriting the lawyer sentence", () => {
    const state = emptyFactorState();
    const prose =
      "验收合格，发包方在验收记录上签字后，方可不得进行隐蔽和继续施工。可视为发包方不得视为已经批准。两种路径都写进意见。";
    ingestDraftBody(state, prose);
    const voiced = appendMechanicalNote(prose, state);
    const sampled = projectAssistantProseForSampling(voiced, state);
    expect(voiced).toContain("方可不得");
    expect(voiced).toContain("两种路径");
    expect(sampled).not.toContain("方可不得");
    expect(sampled).not.toContain("不得视为已经");
    expect(sampled).toContain("【待核实】");
    expect(sampled).toContain("进行隐蔽");
    expect(sampled).toContain("两种路径");
  });
});

describe("pointer basis and extract-time edges", () => {
  it("does not ground a search source id that has no excerpt", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "search_statute", { sourceIds: ["npc-bare"] });
    const citation = state.factors.find((factor) => factor.anchor === "citation:npc-bare");
    expect(projectReading(citation?.outcomes ?? []).kind).toBe("mixed");
    expect(citation?.outcomes[0]?.grounded).toBe(false);
  });

  it("grounds a search source id only when a hit excerpt is copied", () => {
    const statute = "第三十六条 用人单位与劳动者协商一致，可以解除劳动合同。";
    const state = emptyFactorState();
    ingestToolResult(state, "search_statute", {
      sourceIds: ["labor-36"],
      hits: [{ title: "劳动合同法", snippet: statute }],
    });
    const citation = state.factors.find((factor) => factor.anchor === "citation:labor-36");
    expect(projectReading(citation?.outcomes ?? [])).toEqual({ kind: "definite", id: "live" });
    expect(citation?.outcomes[0]?.span).toContain("可以解除");
    expect(renderEngineReadings(state)).toContain(statute);
  });

  it("keeps a worker span on the factor so a dropped history still has the quote", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "draft_worker", {
      anchor: "clause:解除",
      outcomeId: "may_terminate",
      span: "第十五条 乙方可以解除劳动合同",
    });
    const droppedHistory = "";
    expect(droppedHistory).not.toContain("第十五条");
    const factor = state.factors.find((item) => item.anchor === "clause:解除");
    expect(factor?.outcomes[0]?.span).toContain("第十五条");
    expect(projectReading(factor?.outcomes ?? []).kind).toBe("definite");
  });

  it("links defined terms to amount slots so 1-hop can carry the definition", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "wage", value: 88000 });
    ingestDefinedTerms(state, "甲方：北京示例科技有限公司");
    const block = formatMarginalBlock(marginalFactors(state, ["amount:wage"]));
    expect(block).toContain("88000");
    expect(block).toContain("defined:甲方");
    expect(block).toContain("北京示例科技有限公司");
  });
});

describe("stated material amounts", () => {
  it("grounds an amount from the lawyer text and keeps the span when the draft blanks it", () => {
    const state = beginTurnFactors(emptyFactorState());
    ingestMaterialAmounts(
      state,
      "船舶修理费用人民币480万元，另有停运损失。身份证号330102199001011234。",
    );
    const factor = state.factors.find((item) => item.anchor === "amount:stated:4800000");
    expect(factor?.outcomes[0]?.grounded).toBe(true);
    expect(factor?.outcomes[0]?.id).toBe("480万元");
    expect(renderEngineReadings(state)).toContain("480万元");
    expect(renderEngineReadings(state)).toContain("材料原句");
    expect(state.factors.some((item) => item.anchor.includes("330102199001011234"))).toBe(false);

    ingestDraftBody(state, "修理费用【待核实】。");
    expect(factor?.flag).toBe("conflict");
    const reading = renderEngineReadings(state);
    expect(reading).toContain("480万元");
    expect(reading).toContain("材料原句");
    expect(reading).toContain("待核实");
    expect(reading).not.toMatch(/【待核实】480万元/);
  });

  it("does not mark a conflict when the draft never takes up that amount", () => {
    const state = beginTurnFactors(emptyFactorState());
    ingestMaterialAmounts(state, "修理费用人民币480万元。");
    ingestDraftBody(state, "建议先核对合同主体，再决定是否起诉。");
    const factor = state.factors.find((item) => item.anchor === "amount:stated:4800000");
    expect(factor?.flag).not.toBe("conflict");
  });

  it("clears the drift once the draft uses the material amount", () => {
    const state = beginTurnFactors(emptyFactorState());
    ingestMaterialAmounts(state, "修理费用人民币480万元。");
    ingestDraftBody(state, "修理费用【待核实】。");
    ingestDraftBody(state, "修理费用主张480万元。");
    const factor = state.factors.find((item) => item.anchor === "amount:stated:4800000");
    expect(factor?.flag).toBe("ok");
  });

  it("leaves a statute the library did not return ungrounded", () => {
    const state = beginTurnFactors(emptyFactorState());
    ingestToolResult(state, "search_statute", {
      sourceIds: ["civil-577"],
      hits: [{ title: "民法典", snippet: "当事人一方不履行合同义务的，应当承担继续履行。" }],
    });
    applyProseSyndrome(state, "依据《泰国商事法》第三条，应当取得外商经营许可。");
    const foreign = state.factors.find((item) => item.anchor.includes("泰国"));
    expect(foreign?.outcomes.some((outcome) => outcome.grounded === true)).not.toBe(true);
    const reading = renderEngineReadings(state);
    expect(reading).not.toContain("泰国商事法：live");
  });
});
