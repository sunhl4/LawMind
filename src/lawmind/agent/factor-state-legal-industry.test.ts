/**
 * Lawyer-industry kernel suite.
 *
 * Task TYPES and metrics come from public legal NLP benches; fixtures are
 * original Chinese employment / sales / NDA / license snippets, not copies of
 * those corpora. This is not a lawyer-graded manuscript gate.
 *
 * Provenance (protocols only):
 * - LegalBench / CUAD (Hendrycks et al. 2021; Guha et al. 2023): clause
 *   presence + span containment. Exact-match style: the excerpt must attest
 *   the outcome id. https://github.com/HazyResearch/legalbench
 * - ContractNLI (Koreeda & Manning 2021): entailment / contradiction /
 *   not-mentioned. Contradiction → 【待核实】, not argmax.
 * - MAUD (Wang et al. 2023): mixed closing conditions stay mixed.
 * - SARA numeric / LawBench 3-7 (LAIC2021 damages): exact match on
 *   calculateLegal. https://github.com/open-compass/LawBench
 * - LawBench 2-5 / 2-6: reading-comprehension span in source; NER of
 *   parties and defined terms from the instrument itself.
 *
 * Engine under test is factor-state (pointer basis, 1-hop, inverses).
 * Fake sentences. Do not conflate with factor-state-lawyer-suite.
 */
import { describe, expect, it } from "vitest";
import { compensationMonthsFromYears } from "../labor/economic-compensation.js";
import {
  CUAD_CLAUSES,
  LABOR_47_SNIPPET,
  LABOR_CONTRACT,
  LABOR_JUDGMENT_PROSE,
  LAW_BENCH_COMPENSATION,
  MAUD_MAE,
  NDA,
  NLI_CONTRADICTION,
  NLI_ENTAILMENT,
  NLI_NOT_MENTIONED,
  ingestClause,
} from "./factor-state-legal-industry-fixtures.js";
import {
  applyInverseEdits,
  applyProseSyndrome,
  composeWorkerSystem,
  emptyFactorState,
  formatMarginalBlock,
  fuseSharedAnchorLines,
  hopTruncation,
  ingestDefinedTerms,
  ingestToolResult,
  lightConeAnchors,
  marginalFactors,
  projectReading,
  recordInverseEdits,
  recordReading,
  renderEngineReadings,
  spanAttestsOutcome,
  surgicalPayloadOutsideLightCone,
} from "./factor-state.js";
import { calculateLegal } from "./tools/legal/calculate-lib.js";

describe("LegalBench / CUAD clause span extraction", () => {
  it.each(CUAD_CLAUSES.map((row) => [row.label, row] as const))(
    "%s: excerpt that contains the outcome is definite; a different clause is mixed",
    (_label, row) => {
      expect(spanAttestsOutcome(row.excerpt, row.outcome)).toBe(true);
      expect(spanAttestsOutcome(row.absent, row.outcome)).toBe(false);
      const hit = ingestClause(row.anchor, row.outcome, row.excerpt);
      const factor = hit.factors.find((item) => item.anchor === row.anchor);
      expect(projectReading(factor?.outcomes ?? []).kind).toBe("definite");
      expect(factor?.outcomes[0]?.grounded).toBe(true);
      expect(factor?.outcomes[0]?.span).toContain(row.outcome);
      const miss = ingestClause(row.anchor, row.outcome, row.absent);
      expect(
        projectReading(miss.factors.find((item) => item.anchor === row.anchor)?.outcomes ?? [])
          .kind,
      ).toBe("mixed");
    },
  );

  it("does not treat a source id without a hit excerpt as a definite live citation", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "search_statute", { sourceIds: ["npc-bare"] });
    const citation = state.factors.find((factor) => factor.anchor === "citation:npc-bare");
    expect(citation?.outcomes[0]?.grounded).toBe(false);
    expect(projectReading(citation?.outcomes ?? []).kind).toBe("mixed");
  });
});

describe("ContractNLI three-way on an original NDA", () => {
  it("entailment: survival of confidentiality is grounded from the instrument", () => {
    const state = ingestClause(NLI_ENTAILMENT.anchor, NLI_ENTAILMENT.outcome, NLI_ENTAILMENT.span);
    expect(projectReading(state.factors[0]?.outcomes ?? [])).toEqual({
      kind: "definite",
      id: "终止后三年内继续有效",
    });
  });

  it("contradiction: opposite spans on one outcome stay 【待核实】", () => {
    expect(fuseSharedAnchorLines([...NLI_CONTRADICTION])).toEqual([
      "【待核实】clause:反向工程：接收方不得反向工程",
    ]);
  });

  it("not mentioned: a hypothesis with no instrument span stays mixed", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, NDA);
    recordReading(state, NLI_NOT_MENTIONED.anchor, "clause", NLI_NOT_MENTIONED.outcome, false);
    expect(
      projectReading(
        state.factors.find((factor) => factor.anchor === NLI_NOT_MENTIONED.anchor)?.outcomes ?? [],
      ).kind,
    ).toBe("mixed");
  });
});

describe("MAUD-style mixed closing conditions", () => {
  it("does not argmax an MAE carveout against a general MAE", () => {
    const lines = fuseSharedAnchorLines([...MAUD_MAE]);
    expect(lines.some((line) => line.startsWith("【待核实】"))).toBe(true);
    expect(lines.some((line) => line.startsWith("共享锚"))).toBe(false);
  });
});

describe("LawBench 3-7 / SARA numeric: labor and contract math", () => {
  it("matches 劳动合同法第47条 month steps used by calculateLegal", () => {
    expect(compensationMonthsFromYears(0.4)).toBe(0.5);
    expect(compensationMonthsFromYears(0.6)).toBe(1);
    expect(compensationMonthsFromYears(3)).toBe(3);
    expect(compensationMonthsFromYears(3.6)).toBe(4);
  });

  it.each([...LAW_BENCH_COMPENSATION])(
    "$id exact-matches calculateLegal and grounds the factor",
    ({ inputs, expected }) => {
      const computed = calculateLegal("economic_compensation", inputs);
      expect(computed.ok).toBe(true);
      if (!computed.ok) {
        return;
      }
      expect(computed.result.value).toBe(expected);
      const state = emptyFactorState();
      ingestToolResult(state, "calculate", {
        op: computed.result.op,
        value: computed.result.value,
        formula: computed.result.formula,
        inputs: computed.result.inputs,
      });
      applyProseSyndrome(state, `经济补偿为 ${expected + 9999} 元。`);
      const amount = state.factors.find(
        (factor) => factor.anchor === "amount:economic_compensation",
      );
      expect(amount?.outcomes[0]).toMatchObject({ id: String(expected), grounded: true });
      expect(amount?.flag).toBe("conflict");
      expect(renderEngineReadings(state)).toContain(String(expected));
    },
  );

  it("grounds 违约金 from the calculator, not from a guessed ratio", () => {
    const computed = calculateLegal("liquidated_damages", { base: 200_000, ratio: 0.0005 * 30 });
    expect(computed.ok).toBe(true);
    if (!computed.ok) {
      return;
    }
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", {
      op: "liquidated_damages",
      value: computed.result.value,
    });
    const amount = state.factors.find((factor) => factor.anchor === "amount:liquidated_damages");
    expect(amount?.outcomes[0]?.grounded).toBe(true);
    expect(projectReading(amount?.outcomes ?? []).kind).toBe("definite");
  });
});

describe("LawBench 2-6 NER / definition extraction from the instrument", () => {
  it("grounds 甲方 and 公司 from the labor contract and keeps the proving span", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, LABOR_CONTRACT);
    const party = state.factors.find((factor) => factor.anchor === "defined:甲方");
    expect(party?.outcomes[0]?.grounded).toBe(true);
    expect(party?.outcomes[0]?.id).toContain("上海示例科技有限公司");
    expect(party?.outcomes[0]?.span).toContain("上海示例科技有限公司");
    const alias = state.factors.find((factor) => factor.anchor === "defined:公司");
    expect(alias?.outcomes[0]?.grounded).toBe(true);
    expect(renderEngineReadings(state)).toContain("上海示例科技有限公司");
  });

  it("1-hop from 公司 reaches the wage slot without the parent transcript", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, LABOR_CONTRACT);
    ingestToolResult(state, "calculate", { op: "wage", value: 15000 });
    const block = formatMarginalBlock(marginalFactors(state, ["defined:公司"]));
    expect(block).toContain("amount:wage");
    expect(block).toContain("15000");
    expect(block).toContain("【约化因子】");
    expect(block).not.toContain("PARENT_SECRET");
  });
});

describe("LawBench 2-5 reading comprehension: span must live in the source", () => {
  it("grounds a statute citation only when the hit excerpt covers the id", () => {
    const bare = emptyFactorState();
    ingestToolResult(bare, "search_statute", { sourceIds: ["labor-47"] });
    expect(projectReading(bare.factors[0]?.outcomes ?? []).kind).toBe("mixed");
    const covered = emptyFactorState();
    ingestToolResult(covered, "search_statute", {
      sourceIds: ["labor-47"],
      hits: [{ title: "labor-47", snippet: LABOR_47_SNIPPET }],
    });
    const citation = covered.factors.find((factor) => factor.anchor === "citation:labor-47");
    expect(citation?.outcomes[0]?.grounded).toBe(true);
    expect(renderEngineReadings(covered)).toContain(LABOR_47_SNIPPET);
  });

  it("binds a retrieved article to the only clause being reviewed", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "draft_worker", {
      anchor: "clause:解除",
      outcomeId: "提前三十日书面通知解除",
      span: "甲方有权提前三十日书面通知解除本合同，且无需说明理由。",
    });
    ingestToolResult(state, "search_statute", {
      sourceIds: ["labor-47"],
      hits: [
        {
          title: "labor-47",
          snippet: "第四十七条 经济补偿按劳动者在本单位工作的年限，每满一年支付一个月工资。",
        },
      ],
    });
    const hops = lightConeAnchors(state, ["clause:解除"]);
    expect(hops).toContain("citation:labor-47");
    expect(hops).not.toContain("clause:管辖");
    expect(hopTruncation(state, ["clause:解除"]).mechanicalDropped).toEqual([]);
  });
});

describe("§9.6 step 8: 1-hop long-range drop on the labor fixture", () => {
  it("isolates 管辖 and reports a 2-hop statute behind wage as mechanicalDropped", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "draft_worker", {
      anchor: "clause:解除",
      outcomeId: "提前三十日书面通知解除",
      span: "甲方有权提前三十日书面通知解除本合同，且无需说明理由。",
    });
    ingestToolResult(state, "draft_worker", {
      anchor: "clause:管辖",
      outcomeId: "仲裁",
      span: "争议提交仲裁。",
    });
    ingestToolResult(state, "calculate", {
      op: "wage",
      value: 15000,
      clauseAnchor: "clause:解除",
    });
    ingestToolResult(state, "search_statute", {
      sourceIds: ["labor-47"],
      binds: ["amount:wage"],
      hits: [{ title: "labor-47", snippet: LABOR_47_SNIPPET }],
    });
    const report = hopTruncation(state, ["clause:解除"]);
    expect(report.hop1).toContain("clause:解除");
    expect(report.hop1).toContain("amount:wage");
    expect(report.isolated).toContain("clause:管辖");
    expect(report.mechanicalDropped).toEqual(["citation:labor-47"]);
    const block = formatMarginalBlock(marginalFactors(state, ["clause:解除"]));
    expect(block).toContain("15000");
    expect(block).not.toContain("clause:管辖");
    expect(block).not.toContain("labor-47");
    expect(
      composeWorkerSystem({
        instructions: "只写解除。",
        marginal: block,
        parentTranscript: "PARENT_SECRET",
      }),
    ).not.toContain("PARENT_SECRET");
  });
});

describe("§9.6 step 5 light cone as dependency closure", () => {
  it("zero-writes a payload that names an anchor outside the cone", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "提前三十日书面通知解除", true);
    recordReading(state, "amount:wage", "amount", "15000", true);
    recordReading(state, "clause:管辖", "clause", "仲裁", true, "争议提交仲裁");
    const cone = ["clause:解除", "amount:wage"];
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

  it("restores 甲方 after a correction using the inverse patch", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, LABOR_CONTRACT);
    const original = "甲方应向乙方支付经济补偿。";
    recordInverseEdits(state, [{ find: "甲方", replace: "买方" }], original);
    const written = original.replace("甲方", "买方");
    expect(written).toContain("买方");
    const restored = applyInverseEdits(written, state.inverseEdits ?? []);
    expect(restored.applied).toBeGreaterThan(0);
    expect(restored.text).toContain("甲方");
    expect(restored.text).not.toContain("买方");
  });
});

describe("judgment stays free on a labor brief (LegalBench rule-application)", () => {
  it("does not mark 继续履行 / 两种路径 as a mechanical conflict", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 45000 });
    expect(applyProseSyndrome(state, LABOR_JUDGMENT_PROSE).action).toBe("none");
    expect(LABOR_JUDGMENT_PROSE).toContain("继续履行");
    expect(
      state.factors.find((factor) => factor.anchor === "amount:economic_compensation")?.flag,
    ).not.toBe("conflict");
  });
});
