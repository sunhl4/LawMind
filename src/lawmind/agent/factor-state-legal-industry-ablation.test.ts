/**
 * §9.3 five-error ablation on the lawyer-industry fixtures.
 *
 * Control: dropped history, only re-inject five invariants; a non-empty
 * sentence ships as the fact (plain).
 * Treatment: factor-state used in this engine.
 *
 * Same CUAD / LawBench / ContractNLI / MAUD snippets as
 * factor-state-legal-industry.test.ts. Not official CUAD scores, not
 * lawyer-graded manuscripts. Do not conflate with lawyer-suite.
 */
import { describe, expect, it } from "vitest";
import {
  CUAD_CLAUSES,
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
  appendMechanicalNote,
  applyProseSyndrome,
  consumeRedlineRepair,
  emptyFactorState,
  fuseSharedAnchorLines,
  ingestDefinedTerms,
  ingestToolResult,
  projectAssistantProseForSampling,
  projectReading,
  recordReading,
  renderEngineReadings,
  spanAttestsOutcome,
} from "./factor-state.js";
import { calculateLegal } from "./tools/legal/calculate-lib.js";

type Five = {
  citation_outside_pack: number;
  amount_mismatch: number;
  definition_or_party: number;
  redline_empty: number;
  ungrounded_as_fact: number;
};

function emptyFive(): Five {
  return {
    citation_outside_pack: 0,
    amount_mismatch: 0,
    definition_or_party: 0,
    redline_empty: 0,
    ungrounded_as_fact: 0,
  };
}

function total(score: Five): number {
  return Object.values(score).reduce((sum, count) => sum + count, 0);
}

function readingKind(state: ReturnType<typeof emptyFactorState>, anchor: string) {
  return projectReading(state.factors.find((factor) => factor.anchor === anchor)?.outcomes ?? [])
    .kind;
}

const REINJECTION =
  "引用标识必须落在来源包；金额须等于计算器；定义与称谓不得漂移；空修订不算完成；没有出处不得写成事实。";

describe("industry five-error ablation (§9.3 / §9.6 step 7)", () => {
  it("beats prompt reinjection on CUAD, LawBench, ContractNLI, and MAUD fixtures", () => {
    const control = emptyFive();
    const treatment = emptyFive();
    const droppedHistory = "";
    const controlPrompt = `${droppedHistory}\n${REINJECTION}`;

    for (const row of CUAD_CLAUSES) {
      if (row.absent.trim().length > 0) {
        control.ungrounded_as_fact += 1;
      }
      if (
        !spanAttestsOutcome(row.excerpt, row.outcome) ||
        spanAttestsOutcome(row.absent, row.outcome)
      ) {
        treatment.ungrounded_as_fact += 1;
      }
      const hit = ingestClause(row.anchor, row.outcome, row.excerpt);
      const factor = hit.factors.find((item) => item.anchor === row.anchor);
      if (
        projectReading(factor?.outcomes ?? []).kind !== "definite" ||
        factor?.outcomes[0]?.grounded !== true ||
        !factor.outcomes[0]?.span?.includes(row.outcome)
      ) {
        treatment.ungrounded_as_fact += 1;
      }
      const miss = ingestClause(row.anchor, row.outcome, row.absent);
      if (readingKind(miss, row.anchor) === "definite") {
        treatment.ungrounded_as_fact += 1;
      }
    }

    const entailed = ingestClause(
      NLI_ENTAILMENT.anchor,
      NLI_ENTAILMENT.outcome,
      NLI_ENTAILMENT.span,
    );
    if (readingKind(entailed, NLI_ENTAILMENT.anchor) !== "definite") {
      treatment.ungrounded_as_fact += 1;
    }

    if (NLI_CONTRADICTION[0].span.trim().length > 0) {
      control.ungrounded_as_fact += 1;
    }
    const nliLines = fuseSharedAnchorLines([...NLI_CONTRADICTION]);
    if (
      !nliLines.some((line) => line.startsWith("【待核实】")) ||
      nliLines.some((line) => line.startsWith("共享锚"))
    ) {
      treatment.ungrounded_as_fact += 1;
    }

    if (NLI_NOT_MENTIONED.outcome.trim().length > 0) {
      control.ungrounded_as_fact += 1;
    }
    const unspoken = emptyFactorState();
    ingestDefinedTerms(unspoken, NDA);
    recordReading(unspoken, NLI_NOT_MENTIONED.anchor, "clause", NLI_NOT_MENTIONED.outcome, false);
    if (readingKind(unspoken, NLI_NOT_MENTIONED.anchor) === "definite") {
      treatment.ungrounded_as_fact += 1;
    }

    if (MAUD_MAE[0].span.trim().length > 0) {
      control.ungrounded_as_fact += 1;
    }
    const maudLines = fuseSharedAnchorLines([...MAUD_MAE]);
    if (
      !maudLines.some((line) => line.startsWith("【待核实】")) ||
      maudLines.some((line) => line.startsWith("共享锚"))
    ) {
      treatment.ungrounded_as_fact += 1;
    }

    for (const row of LAW_BENCH_COMPENSATION) {
      const wrong = `经济补偿为 ${row.expected + 9999} 元。`;
      if (
        wrong.includes(String(row.expected + 9999)) &&
        !controlPrompt.includes(String(row.expected))
      ) {
        control.amount_mismatch += 1;
      }
      const computed = calculateLegal("economic_compensation", row.inputs);
      if (!computed.ok || computed.result.value !== row.expected) {
        treatment.amount_mismatch += 1;
        continue;
      }
      const state = emptyFactorState();
      ingestToolResult(state, "calculate", {
        op: computed.result.op,
        value: computed.result.value,
        formula: computed.result.formula,
        inputs: computed.result.inputs,
      });
      applyProseSyndrome(state, wrong);
      const amount = state.factors.find(
        (factor) => factor.anchor === "amount:economic_compensation",
      );
      const voiced = appendMechanicalNote(wrong, state);
      if (amount?.flag !== "conflict" || amount.outcomes[0]?.id !== String(row.expected)) {
        treatment.amount_mismatch += 1;
      }
      if (!voiced.includes(String(row.expected))) {
        treatment.amount_mismatch += 1;
      }
      if (projectAssistantProseForSampling(voiced, state).includes(String(row.expected + 9999))) {
        treatment.amount_mismatch += 1;
      }
    }

    const partyProse = "买方应向乙方支付经济补偿。";
    if (controlPrompt.includes("买方") || !controlPrompt.includes("甲方")) {
      control.definition_or_party += 1;
    }
    const partyState = emptyFactorState();
    ingestDefinedTerms(partyState, LABOR_CONTRACT);
    applyProseSyndrome(partyState, partyProse);
    const defined = partyState.factors.find((factor) => factor.anchor === "defined:甲方");
    const foreign = partyState.factors.find((factor) => factor.anchor === "party:买方");
    if (
      defined?.outcomes[0]?.grounded !== true ||
      projectReading(foreign?.outcomes ?? []).kind === "definite"
    ) {
      treatment.definition_or_party += 1;
    }

    if (!controlPrompt.includes("labor-47")) {
      control.citation_outside_pack += 1;
    }
    const bareCite = emptyFactorState();
    ingestToolResult(bareCite, "search_statute", { sourceIds: ["labor-47"] });
    if (readingKind(bareCite, "citation:labor-47") === "definite") {
      treatment.citation_outside_pack += 1;
    }

    if (!controlPrompt.includes("xml_qa_no_tracks")) {
      control.redline_empty += 1;
    }
    const redline = emptyFactorState();
    ingestToolResult(redline, "render_tracked_draft", { code: "xml_qa_no_tracks" });
    if (!consumeRedlineRepair(redline).note) {
      treatment.redline_empty += 1;
    }

    expect(treatment).toEqual({
      citation_outside_pack: 0,
      amount_mismatch: 0,
      definition_or_party: 0,
      redline_empty: 0,
      ungrounded_as_fact: 0,
    });
    expect(total(treatment)).toBeLessThan(total(control));
    expect(renderEngineReadings(partyState)).toContain("上海示例科技有限公司");
  });
});

describe("industry expression track (not mixed into the five-error total)", () => {
  it("does not mark 继续履行 / 两种路径 as a mechanical conflict", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 45000 });
    expect(applyProseSyndrome(state, LABOR_JUDGMENT_PROSE).action).toBe("none");
    expect(LABOR_JUDGMENT_PROSE).toContain("继续履行");
    expect(LABOR_JUDGMENT_PROSE).toContain("两种路径");
    expect(
      state.factors.find((factor) => factor.anchor === "amount:economic_compensation")?.flag,
    ).not.toBe("conflict");
    expect(renderEngineReadings(state)).toContain("45000");
  });
});
