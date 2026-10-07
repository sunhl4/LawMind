/**
 * Express track for the two industry benches: LegalBench/CUAD and LawBench.
 *
 * Structure may flag a wrong amount or an unattested span. Expression must
 * stay open: the model's judgment, the alternate path, and the writing task
 * remain. Scores are not fused into one number. Fixtures are original
 * Chinese snippets, not official CUAD and not lawyer-graded manuscripts.
 */
import { describe, expect, it } from "vitest";
import {
  CUAD_CLAUSES,
  LAW_BENCH_COMPENSATION,
  MAUD_MAE,
  NLI_CONTRADICTION,
  ingestClause,
} from "./factor-state-legal-industry-fixtures.js";
import {
  appendMechanicalNote,
  applyProseSyndrome,
  composeWorkerSystem,
  emptyFactorState,
  formatMarginalBlock,
  fuseSharedAnchorLines,
  ingestToolResult,
  marginalFactors,
  projectAssistantProseForSampling,
  projectReading,
  rememberBuiltinTemplateSkeleton,
  rememberSkeleton,
  renderEngineReadings,
} from "./factor-state.js";
import { calculateLegal } from "./tools/legal/calculate-lib.js";

const JUDGMENT =
  "综合现有材料，我方主张就该条款保留谈判空间。若对方拒绝修改，则两种路径都写入意见。";

const SECRET = "PARENT_SECRET 上一案赔偿上限壹佰万";

function wanSpell(expected: number): string {
  const wan = expected / 10_000;
  return `${wan}万元`;
}

describe("LegalBench / CUAD express track", () => {
  it.each(CUAD_CLAUSES.map((row) => [row.label, row] as const))(
    "%s: a judgment beside a grounded span stays writable",
    (label, row) => {
      const state = ingestClause(row.anchor, row.outcome, row.excerpt);
      expect(projectReading(state.factors[0]?.outcomes ?? []).kind).toBe("definite");
      expect(applyProseSyndrome(state, JUDGMENT).action).toBe("none");
      const voiced = appendMechanicalNote(JUDGMENT, state);
      const sampled = projectAssistantProseForSampling(voiced, state);
      expect(voiced.startsWith(JUDGMENT), label).toBe(true);
      expect(voiced, label).toContain("两种路径");
      expect(voiced, label).not.toContain("【机械核定】");
      expect(sampled, label).toContain("主张");
      expect(sampled, label).toContain("两种路径");
      expect(sampled, label).toContain("若对方拒绝修改");
      expect(projectReading(state.factors[0]?.outcomes ?? []).kind, label).toBe("definite");
      expect(
        state.factors.some((factor) => factor.flag === "conflict"),
        label,
      ).toBe(false);
      const readings = renderEngineReadings(state);
      expect(readings, label).toContain("【判断保留】");
      expect(readings, label).toContain("不是证据，可改、可删");
      expect(readings, label).toContain("主张就该条款保留谈判空间");
      expect(readings, label).not.toContain("必须逐句");
    },
  );

  it.each(CUAD_CLAUSES.map((row) => [row.label, row] as const))(
    "%s: two wordings of one outcome stay one reading; two strategies both remain visible",
    (label, row) => {
      const shared = fuseSharedAnchorLines([
        {
          anchor: row.anchor,
          outcomeId: row.outcome,
          conclusion: row.outcome,
          span: row.excerpt,
        },
        {
          anchor: row.anchor,
          outcomeId: row.outcome,
          conclusion: `意见可写作：${row.outcome}`,
          span: row.excerpt,
        },
      ]);
      expect(shared, label).toEqual([`共享锚 ${row.anchor}：${row.outcome}`]);
      const split = fuseSharedAnchorLines([
        {
          anchor: row.anchor,
          outcomeId: row.outcome,
          conclusion: "按原文履行",
          span: row.excerpt,
        },
        {
          anchor: row.anchor,
          outcomeId: `${row.outcome}·备选`,
          conclusion: "主张改约",
          span: "主张改约",
        },
      ]);
      expect(
        split.some((line) => line.startsWith("【待核实】")),
        label,
      ).toBe(true);
      expect(split.join("\n"), label).toContain("按原文履行");
      expect(split.join("\n"), label).toContain("主张改约");
      expect(split.join("\n"), label).not.toBe("主张改约");
      expect(split.join("\n"), label).not.toBe("按原文履行");
    },
  );

  it.each(CUAD_CLAUSES.map((row) => [row.label, row] as const))(
    "%s: the worker still receives the judgment and not the parent secret",
    (label, row) => {
      const state = ingestClause(row.anchor, row.outcome, row.excerpt);
      applyProseSyndrome(state, JUDGMENT);
      const block = formatMarginalBlock(marginalFactors(state, [row.anchor]));
      const system = composeWorkerSystem({
        instructions: `只写这一段。${JUDGMENT}`,
        marginal: block,
        parentTranscript: SECRET,
      });
      expect(system, label).toContain("主张就该条款保留谈判空间");
      expect(system, label).toContain("两种路径");
      expect(system, label).toContain(row.outcome);
      expect(system, label).not.toContain("PARENT_SECRET");
      expect(system, label).not.toContain("壹佰万");
      expect(block, label).not.toContain("PARENT_SECRET");
    },
  );

  it("a builtin memo skeleton stays editable after a CUAD judgment", () => {
    const row = CUAD_CLAUSES[0];
    expect(row).toBeTruthy();
    if (!row) {
      return;
    }
    const state = ingestClause(row.anchor, row.outcome, row.excerpt);
    applyProseSyndrome(state, JUDGMENT);
    rememberBuiltinTemplateSkeleton(state, "word/legal-memo-default");
    const templated = renderEngineReadings(state);
    expect(templated).toContain("【骨架起点】");
    expect(templated).toContain("一、结论");
    expect(templated).toContain("可改、可增、可删");
    expect(templated).toContain("【判断保留】");
    expect(templated).not.toContain("必须逐句");
    rememberSkeleton(state, ["1 争点", "1.1 解除"], "document");
    const rewritten = renderEngineReadings(state);
    expect(rewritten).toContain("1 争点");
    expect(rewritten).toContain("1.1 解除");
    expect(rewritten).not.toContain("- 免责声明");
    expect(projectReading(state.factors[0]?.outcomes ?? []).kind).toBe("definite");
    expect(rewritten).toContain("主张就该条款保留谈判空间");
  });

  it("ContractNLI contradiction and MAUD carveout keep both sides and the judgment", () => {
    const nli = fuseSharedAnchorLines([...NLI_CONTRADICTION]);
    expect(nli.join("\n")).toContain("【待核实】");
    expect(nli.join("\n")).not.toContain("共享锚");
    expect(nli.join("\n")).toContain("不得反向工程");
    const maud = fuseSharedAnchorLines([...MAUD_MAE]);
    expect(maud.join("\n")).toContain("【待核实】");
    expect(maud.join("\n")).toContain("发生重大不利变化即可终止");
    expect(maud.join("\n")).toContain("疫情不属于重大不利变化");
    const state = emptyFactorState();
    expect(applyProseSyndrome(state, JUDGMENT).action).toBe("none");
    const voiced = appendMechanicalNote(
      `${JUDGMENT}\n${nli.join("\n")}\n${maud.join("\n")}`,
      state,
    );
    expect(voiced.startsWith(JUDGMENT)).toBe(true);
    expect(projectAssistantProseForSampling(voiced, state)).toContain("两种路径");
    expect(state.factors.some((factor) => factor.flag === "conflict")).toBe(false);
  });
});

describe("LawBench amount express track", () => {
  it.each(LAW_BENCH_COMPENSATION.map((row) => [row.id, row] as const))(
    "%s: the wrong figure leaves the sample and the judgment stays",
    (id, row) => {
      const computed = calculateLegal("economic_compensation", row.inputs);
      expect(computed.ok, id).toBe(true);
      if (!computed.ok) {
        return;
      }
      expect(computed.result.value, id).toBe(row.expected);
      const state = emptyFactorState();
      ingestToolResult(state, "calculate", {
        op: computed.result.op,
        value: computed.result.value,
        formula: computed.result.formula,
        inputs: computed.result.inputs,
      });
      const wrong = row.expected + 9999;
      const prose = `${JUDGMENT}经济补偿为 ${wrong} 元。管辖争点宜另段展开。`;
      expect(applyProseSyndrome(state, prose).action).toBe("none");
      const amount = state.factors.find(
        (factor) => factor.anchor === "amount:economic_compensation",
      );
      expect(amount?.flag, id).toBe("conflict");
      expect(amount?.outcomes[0]?.id, id).toBe(String(row.expected));
      const voiced = appendMechanicalNote(prose, state);
      expect(voiced.startsWith(JUDGMENT), id).toBe(true);
      expect(voiced, id).toContain("两种路径");
      expect(voiced, id).toContain("管辖争点");
      expect(voiced, id).toContain("【机械核定】");
      expect(voiced, id).toContain(String(row.expected));
      const sampled = projectAssistantProseForSampling(voiced, state);
      expect(sampled, id).not.toContain(String(wrong));
      expect(sampled, id).toContain("主张就该条款保留谈判空间");
      expect(sampled, id).toContain("两种路径");
      expect(sampled, id).toContain("管辖争点");
      expect(sampled, id).toContain(String(row.expected));
      const readings = renderEngineReadings(state);
      expect(readings, id).toContain("【判断保留】");
      expect(readings, id).toContain(`【待核实】${row.expected}；${wrong}`);
      expect(projectReading(amount?.outcomes ?? []), id).toEqual({
        kind: "definite",
        id: String(row.expected),
      });
      expect(state.keptJudgments?.join("\n") ?? "", id).not.toContain(String(wrong));
      expect(
        state.keptJudgments?.some((sentence) => sentence.includes("主张")),
        id,
      ).toBe(true);
    },
  );

  it.each(LAW_BENCH_COMPENSATION.map((row) => [row.id, row] as const))(
    "%s: an equivalent 万元 spelling does not force a rewrite of the judgment",
    (id, row) => {
      const computed = calculateLegal("economic_compensation", row.inputs);
      expect(computed.ok, id).toBe(true);
      if (!computed.ok) {
        return;
      }
      const state = emptyFactorState();
      ingestToolResult(state, "calculate", {
        op: computed.result.op,
        value: computed.result.value,
        formula: computed.result.formula,
        inputs: computed.result.inputs,
      });
      const prose = `${JUDGMENT}经济补偿为 ${wanSpell(row.expected)}。`;
      expect(applyProseSyndrome(state, prose).action).toBe("none");
      const amount = state.factors.find(
        (factor) => factor.anchor === "amount:economic_compensation",
      );
      expect(amount?.flag, id).not.toBe("conflict");
      expect(amount?.outcomes[0]?.id, id).toBe(String(row.expected));
      const voiced = appendMechanicalNote(prose, state);
      expect(voiced.startsWith(JUDGMENT), id).toBe(true);
      expect(voiced, id).toContain(wanSpell(row.expected));
      expect(voiced, id).not.toContain("【机械核定】");
      const sampled = projectAssistantProseForSampling(voiced, state);
      expect(sampled, id).toContain(wanSpell(row.expected));
      expect(sampled, id).toContain("两种路径");
      expect(renderEngineReadings(state), id).toContain("主张就该条款保留谈判空间");
    },
  );

  it("express stays at least as open as plain while the wrong amount is the only thing removed", () => {
    let plainExpress = 0;
    let treatmentExpress = 0;
    let treatmentStructure = 0;
    for (const row of LAW_BENCH_COMPENSATION) {
      const judgment = JUDGMENT;
      const wrong = `${judgment}经济补偿为 ${row.expected + 9999} 元。`;
      if (wrong.includes("主张") && wrong.includes("两种路径")) {
        plainExpress += 1;
      }
      const computed = calculateLegal("economic_compensation", row.inputs);
      expect(computed.ok).toBe(true);
      if (!computed.ok) {
        continue;
      }
      const state = emptyFactorState();
      ingestToolResult(state, "calculate", {
        op: computed.result.op,
        value: computed.result.value,
      });
      applyProseSyndrome(state, wrong);
      const voiced = appendMechanicalNote(wrong, state);
      const sampled = projectAssistantProseForSampling(voiced, state);
      if (
        voiced.includes("主张") &&
        voiced.includes("两种路径") &&
        sampled.includes("主张") &&
        sampled.includes("两种路径")
      ) {
        treatmentExpress += 1;
      }
      if (
        !sampled.includes(String(row.expected + 9999)) &&
        sampled.includes(String(row.expected))
      ) {
        treatmentStructure += 1;
      }
    }
    expect(plainExpress).toBe(LAW_BENCH_COMPENSATION.length);
    expect(treatmentExpress).toBe(plainExpress);
    expect(treatmentStructure).toBe(LAW_BENCH_COMPENSATION.length);
    expect(treatmentExpress).toBeGreaterThan(0);
  });
});
