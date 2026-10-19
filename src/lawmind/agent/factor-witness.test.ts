import { describe, expect, it } from "vitest";
import {
  applyProseSyndrome,
  emptyFactorState,
  ingestToolResult,
  recordReading,
} from "./factor-state.js";
import {
  buildWitnessProbes,
  moneyCandidates,
  parseMoneyYuan,
  scoreWitnessAnswer,
  witnessReport,
} from "./factor-witness.js";

describe("witness probe construction (docs/量子启发.md §二(3))", () => {
  it("probes a conflicting amount without leaking the ledger answer into the question", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
    applyProseSyndrome(state, "经济补偿为 99999 元。");

    const probes = buildWitnessProbes(state, 3);
    expect(probes).toHaveLength(1);
    const probe = probes[0];
    expect(probe?.kind).toBe("amount");
    expect(probe?.anchor).toBe("amount:economic_compensation");
    expect(probe?.question).toContain("经济补偿");
    expect(probe?.question).not.toContain("88000");
    expect(probe?.question).not.toContain("99999");
    expect(probe?.expected).toBe("88000");

    const drifted = scoreWitnessAnswer(probe, "经济补偿为 99999 元。");
    expect(drifted.verdict).toBe("drift");
    const honest = scoreWitnessAnswer(probe, "88,000 元");
    expect(honest.verdict).toBe("pass");
  });

  it("flags a hedged answer on an already-verified amount as drift, not pass", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "wage", value: 15000 });
    const probe = buildWitnessProbes(state, 1)[0];
    expect(probe?.kind).toBe("amount");
    const hedged = scoreWitnessAnswer(probe, "这个数我不太确定。");
    expect(hedged.verdict).toBe("drift");
  });

  it("treats 【待核实】as passing on an unverified slot and an assertive number as drift", () => {
    const state = emptyFactorState();
    recordReading(state, "amount:wage", "amount", "15000", false);
    const probe = buildWitnessProbes(state, 1)[0];
    expect(probe?.kind).toBe("unverified");
    const hedged = scoreWitnessAnswer(probe, "【待核实】，材料里没有原句。");
    expect(hedged.verdict).toBe("pass");
    const assertive = scoreWitnessAnswer(probe, "工资为 15000 元。");
    expect(assertive.verdict).toBe("drift");
    expect(state.factors[0]?.flag).toBe("mixed");
  });

  it("probes a defined term and compares the definition text verbatim", () => {
    const state = emptyFactorState();
    recordReading(
      state,
      "defined:公司",
      "clause",
      "北京示例科技有限公司",
      true,
      "「公司」即北京示例科技有限公司",
    );
    const probe = buildWitnessProbes(state, 1)[0];
    expect(probe?.kind).toBe("defined");
    expect(probe?.anchor).toBe("defined:公司");
    const pass = scoreWitnessAnswer(probe, "北京示例科技有限公司");
    expect(pass.verdict).toBe("pass");
    const drift = scoreWitnessAnswer(probe, "上海示例贸易有限公司");
    expect(drift.verdict).toBe("drift");
    expect(probe?.question).not.toContain("北京示例");
  });

  it("skips a defined probe whose reading is only the short term itself", () => {
    const state = emptyFactorState();
    recordReading(state, "defined:公司", "clause", "公司", true, "以下简称「公司」");
    expect(buildWitnessProbes(state, 3)).toEqual([]);
  });

  it("refers to citations by position so the question does not embed the id", () => {
    const state = emptyFactorState();
    recordReading(state, "citation:labor-47", "citation", "labor-47", true, "labor-47 原文片段");
    const probe = buildWitnessProbes(state, 1)[0];
    expect(probe?.kind).toBe("citation");
    expect(probe?.question).toContain("第 1 条引用");
    expect(probe?.question).not.toContain("labor-47");
    const pass = scoreWitnessAnswer(probe, "labor-47");
    expect(pass.verdict).toBe("pass");
  });

  it("is empty without factors and skips turn-local stated amounts", () => {
    const empty = buildWitnessProbes(emptyFactorState(), 3);
    expect(empty).toEqual([]);

    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "wage", value: 15000 });
    recordReading(state, "amount:stated:480万", "amount", "480万元", true, "480万元");
    const probes = buildWitnessProbes(state, 3);
    expect(probes.map((probe) => probe.anchor)).toEqual(["amount:wage"]);
  });

  it("ranks conflict and mixed slots ahead of clean ones under the limit", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "wage", value: 15000 });
    ingestToolResult(state, "calculate", { op: "interest", value: 2000 });
    ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
    // 已核在前、错误改写在后：这是账本产生 conflict 标记的顺序。
    applyProseSyndrome(state, "经济补偿为 99999 元。");

    const probes = buildWitnessProbes(state, 2);
    expect(probes).toHaveLength(2);
    expect(probes[0]?.anchor).toBe("amount:economic_compensation");
    expect(probes.some((probe) => probe.anchor === "amount:interest")).toBe(false);
  });
});

describe("witness report", () => {
  it("summarizes drift anchors as an observation, never as evidence", () => {
    const report = witnessReport([
      { anchor: "amount:wage", kind: "amount", verdict: "pass", detail: "一致" },
      { anchor: "amount:interest", kind: "amount", verdict: "drift", detail: "不符" },
      { anchor: "amount:interest", kind: "amount", verdict: "drift", detail: "多值" },
    ]);
    expect(report.verdict).toBe("drift");
    expect(report.driftAnchors).toEqual(["amount:interest"]);
    expect(report.probes).toBe(3);
  });
});

describe("money parsing helpers", () => {
  it("keeps serial numbers out of amount candidates", () => {
    expect(moneyCandidates("第 47 条引用，共 2 份")).toEqual([]);
    expect(moneyCandidates("共 88000 元")).toEqual([88000]);
    expect(moneyCandidates("8.8万元")).toEqual([88000]);
    expect(moneyCandidates("88,000元")).toEqual([88000]);
  });

  it("parses ledger readings with 万 and plain digits", () => {
    expect(parseMoneyYuan("88000")).toBe(88000);
    expect(parseMoneyYuan("8.8万")).toBe(88000);
    expect(parseMoneyYuan("480万元")).toBe(4800000);
    expect(parseMoneyYuan("第1条")).toBeUndefined();
  });
});
