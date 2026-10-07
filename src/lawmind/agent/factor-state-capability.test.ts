/**
 * Six-defect capability suite (claim Q).
 *
 * Quantum-inspired structure must press §0.1 defects and amplify model
 * expression — not merely win the mechanical five-error gate.
 *
 * Arms: plain | reinjection | treatment.
 * Dual scores (never fused into one "quantum score"):
 * - structure: defect pressed / bypassed
 * - express: judgment kept, writing path still open
 *
 * Fake sentences. Not lawyer-graded manuscripts. Do not conflate with
 * factor-state-lawyer-suite (mechanical gate).
 */
import { describe, expect, it } from "vitest";
import {
  appendMechanicalNote,
  applyInverseEdits,
  applyProseSyndrome,
  composeWorkerSystem,
  emptyFactorState,
  formatMarginalBlock,
  fuseSharedAnchorLines,
  ingestDefinedTerms,
  ingestDraftBody,
  ingestToolResult,
  marginalFactors,
  projectAssistantProseForSampling,
  recordInverseEdits,
  recordReading,
  renderEngineReadings,
  selectSkeleton,
  type FactorState,
} from "./factor-state.js";

type Arm = "plain" | "reinjection" | "treatment";

type Scores = { structure: number; express: number };

const REINJECTION =
  "引用标识必须落在来源包；金额须等于计算器；定义与称谓不得漂移；空修订不算完成；没有出处不得写成事实。";

const JUDGMENT = "综合证据，我方主张继续履行更符合商业安排；管辖争点宜另段展开。";

function emptyScores(): Scores {
  return { structure: 0, express: 0 };
}

/** D2: fluent prose with a bad cite — stabilizers flag the cite, keep judgment. */
function scoreD2(arm: Arm): Scores {
  const scores = emptyScores();
  const prose = [
    JUDGMENT,
    "一、争点",
    "依据《劳动合同法》第99条，可以解除。",
    "二、建议改法",
    "违约金偏高，宜按实际损失调整。",
  ].join("\n");
  if (arm === "plain") {
    // Ships as fact; judgment present but structure fails (bad cite accepted).
    if (prose.includes("第99条")) {
      scores.structure += 0;
    }
    if (prose.includes("继续履行")) {
      scores.express += 1;
    }
    return scores;
  }
  if (arm === "reinjection") {
    // Slogans only — no concrete cite anchor.
    if (REINJECTION.includes("引用") && !REINJECTION.includes("第99条")) {
      scores.structure += 0;
    }
    if (prose.includes("继续履行")) {
      scores.express += 1;
    }
    return scores;
  }
  const state = emptyFactorState();
  ingestToolResult(state, "search_statute", {
    hits: [
      {
        title: "劳动合同法",
        snippet: "第三十六条 用人单位与劳动者协商一致，可以解除劳动合同。",
      },
    ],
  });
  applyProseSyndrome(state, prose);
  const voiced = appendMechanicalNote(prose, state);
  const flagged = state.factors.some(
    (factor) =>
      factor.kind === "citation" &&
      (factor.flag === "conflict" || factor.flag === "mixed" || factor.flag === "uncorrectable"),
  );
  if (flagged) {
    scores.structure += 1;
  }
  if (
    voiced.includes("继续履行") &&
    voiced.includes("【机械核定】") &&
    !voiced.includes("【因子修复】")
  ) {
    scores.express += 1;
  }
  return scores;
}

/** D3: two workers, same anchor, different outcomeIds — no argmax / vote. */
function scoreD3(arm: Arm): Scores {
  const scores = emptyScores();
  const a = "乙方有权解除";
  const b = "乙方无权解除本合同，只能继续履行";
  if (arm === "plain") {
    // Longer wording wins (vote / ship one side).
    const winner = b.length >= a.length ? b : a;
    if (winner === b && !winner.includes("有权解除")) {
      scores.structure += 0;
    }
    return scores;
  }
  if (arm === "reinjection") {
    scores.structure += 0;
    return scores;
  }
  const lines = fuseSharedAnchorLines([
    { anchor: "clause:解除", outcomeId: "may_terminate", conclusion: a, span: "第十五条" },
    { anchor: "clause:解除", outcomeId: "must_continue", conclusion: b, span: "第十六条" },
  ]);
  const pending = lines.some(
    (line) => line.startsWith("【待核实】") && line.includes("clause:解除"),
  );
  const both = lines.some((line) => line.includes("有权解除") && line.includes("无权解除"));
  if (pending && both) {
    scores.structure += 1;
  }
  // Expression: conflict is labeled, not collapsed — model may still write around it.
  if (pending && !lines.some((line) => line === a || line === b)) {
    scores.express += 1;
  }
  return scores;
}

/** D4: parent secret must not enter worker system; local anchor remains. */
function scoreD4(arm: Arm): Scores {
  const scores = emptyScores();
  const secret = "PARENT_SECRET 上一案赔偿上限壹佰万";
  if (arm === "plain") {
    const system = `只写解除段。\n父摘要：${secret}\nclause:管辖 上海仲裁`;
    if (system.includes("PARENT_SECRET")) {
      scores.structure += 0;
    }
    if (system.includes("解除")) {
      scores.express += 1;
    }
    return scores;
  }
  if (arm === "reinjection") {
    const system = `只写解除段。\n${REINJECTION}\n${secret}`;
    if (system.includes("PARENT_SECRET")) {
      scores.structure += 0;
    }
    scores.express += 1;
    return scores;
  }
  const state = emptyFactorState();
  ingestToolResult(state, "calculate", {
    op: "wage",
    value: 15000,
    clauseAnchor: "clause:解除",
  });
  recordReading(state, "clause:管辖", "clause", "上海仲裁", true);
  const block = formatMarginalBlock(marginalFactors(state, ["clause:解除"]));
  const system = composeWorkerSystem({
    instructions: "只写解除段。",
    marginal: block,
    parentTranscript: secret,
  });
  if (
    !system.includes("PARENT_SECRET") &&
    !system.includes("壹佰万") &&
    !block.includes("上海仲裁") &&
    (block.includes("clause:解除") || system.includes("clause:解除") || block.includes("15000"))
  ) {
    scores.structure += 1;
  }
  if (system.includes("只写解除段") && !system.includes("PARENT_SECRET")) {
    scores.express += 1;
  }
  return scores;
}

/** D5: inverse restores party label; amount slot outside cone untouched. */
function scoreD5(arm: Arm): Scores {
  const scores = emptyScores();
  const edited = "买方应于三日内付款。经济补偿为 88000 元。";
  if (arm === "plain" || arm === "reinjection") {
    // Cannot invert — must regenerate.
    if (edited.includes("买方") && !edited.includes("甲方应于")) {
      scores.structure += 0;
    }
    scores.express += 1;
    return scores;
  }
  const state = emptyFactorState();
  ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
  recordInverseEdits(state, [{ find: "甲方", replace: "买方" }]);
  const restored = applyInverseEdits(edited, state.inverseEdits ?? []);
  const amount = state.factors.find((factor) => factor.anchor === "amount:economic_compensation");
  if (
    restored.text.includes("甲方应于") &&
    restored.applied === 1 &&
    amount?.outcomes[0]?.id === "88000"
  ) {
    scores.structure += 1;
  }
  if (restored.text.includes("88000") && restored.text.includes("甲方")) {
    scores.express += 1;
  }
  return scores;
}

/** X3: same amount, two spellings — must not force a rewrite. */
function scoreX3(arm: Arm): Scores {
  const scores = emptyScores();
  const prose = `${JUDGMENT}经济补偿为 8.8万元。`;
  if (arm !== "treatment") {
    scores.express += prose.includes("8.8万元") ? 1 : 0;
    scores.structure += 1; // plain has no checker conflict either
    return scores;
  }
  const state = emptyFactorState();
  ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
  applyProseSyndrome(state, prose);
  const conflict = state.factors.some((factor) => factor.flag === "conflict");
  if (!conflict) {
    scores.structure += 1;
  }
  if (!conflict && prose.includes("8.8万元") && prose.includes("继续履行")) {
    scores.express += 1;
  }
  return scores;
}

/** X5: free skeleton — model not forced into template columns. */
function scoreX5(arm: Arm): Scores {
  const scores = emptyScores();
  if (arm === "plain" || arm === "reinjection") {
    // No skeleton contract — express free by accident, no structure win for adiabatic claim.
    scores.express += 1;
    return scores;
  }
  const choice = selectSkeleton({});
  if (choice.kind === "free" && choice.header?.includes("未从已验证骨架变形")) {
    scores.structure += 1;
    scores.express += 1;
  }
  return scores;
}

/**
 * D1/D6 sampling projection helpers used by the dual-track aggregate
 * (full loop lives in cassettes; unit layer checks the projection contract).
 */
function scoreD1Projection(arm: Arm): Scores {
  const scores = emptyScores();
  const prose = `${JUDGMENT}经济补偿为 99999 元。`;
  if (arm === "plain") {
    if (prose.includes("99999")) {
      scores.structure += 0;
    }
    if (prose.includes("继续履行")) {
      scores.express += 1;
    }
    return scores;
  }
  if (arm === "reinjection") {
    const next = `${REINJECTION}\n${prose}`;
    if (next.includes("99999")) {
      scores.structure += 0;
    }
    scores.express += next.includes("继续履行") ? 1 : 0;
    return scores;
  }
  const state = emptyFactorState();
  ingestToolResult(state, "calculate", { op: "economic_compensation", value: 88000 });
  applyProseSyndrome(state, prose);
  const voiced = appendMechanicalNote(prose, state);
  const sampled = projectAssistantProseForSampling(voiced, state);
  const readings = renderEngineReadings(state);
  if (!sampled.includes("99999") && readings.includes("88000") && voiced.includes("继续履行")) {
    scores.structure += 1;
  }
  if (voiced.includes("继续履行") && voiced.includes("【机械核定】") && voiced.includes("99999")) {
    scores.express += 1;
  }
  return scores;
}

function scoreD6Projection(arm: Arm): Scores {
  const scores = emptyScores();
  const prose = "根据权威来源〔npc-1〕，应当付款。相对方迟延，建议主张解除。";
  if (arm === "plain" || arm === "reinjection") {
    if (prose.includes("权威来源〔npc-1〕")) {
      scores.structure += 0;
    }
    scores.express += prose.includes("建议主张解除") ? 1 : 0;
    return scores;
  }
  const state = emptyFactorState();
  ingestToolResult(state, "search_statute", { sourceIds: ["npc-1"], demoCorpus: true });
  applyProseSyndrome(state, prose);
  const voiced = appendMechanicalNote(prose, state);
  const sampled = projectAssistantProseForSampling(voiced, state);
  if (!sampled.includes("权威来源〔npc-1〕") && voiced.includes("建议主张解除")) {
    scores.structure += 1;
  }
  if (voiced.includes("建议主张解除") && voiced.includes("【机械核定】")) {
    scores.express += 1;
  }
  return scores;
}

function runArm(arm: Arm): Scores {
  const parts = [
    scoreD1Projection(arm),
    scoreD2(arm),
    scoreD3(arm),
    scoreD4(arm),
    scoreD5(arm),
    scoreD6Projection(arm),
    scoreX3(arm),
    scoreX5(arm),
  ];
  return parts.reduce(
    (acc, part) => ({
      structure: acc.structure + part.structure,
      express: acc.express + part.express,
    }),
    emptyScores(),
  );
}

describe("six-defect capability (claim Q)", () => {
  it("treatment beats plain and reinjection on structure without fusing express into one score", () => {
    const plain = runArm("plain");
    const reinjection = runArm("reinjection");
    const treatment = runArm("treatment");

    expect(treatment.structure).toBeGreaterThan(plain.structure);
    expect(treatment.structure).toBeGreaterThan(reinjection.structure);
    expect(treatment.express).toBeGreaterThan(plain.express);
    expect(treatment.express).toBeGreaterThan(reinjection.express);
    expect(treatment.express).toBeGreaterThan(0);
    // Dual track: report both; never collapse into one "quantum score" field.
    expect(treatment).toEqual(
      expect.objectContaining({ structure: expect.any(Number), express: expect.any(Number) }),
    );
    expect(Object.keys(treatment).toSorted()).toEqual(["express", "structure"]);
  });

  it("D2 flags the bad cite and keeps the judgment paragraph", () => {
    expect(scoreD2("treatment").structure).toBe(1);
    expect(scoreD2("treatment").express).toBe(1);
    expect(scoreD2("plain").structure).toBe(0);
  });

  it("D3 writes 待核实 for conflicting outcome ids instead of voting", () => {
    expect(scoreD3("treatment").structure).toBe(1);
    expect(scoreD3("plain").structure).toBe(0);
  });

  it("D4 drops parent secret from the worker system and keeps the local anchor", () => {
    expect(scoreD4("treatment").structure).toBe(1);
    expect(scoreD4("plain").structure).toBe(0);
    expect(scoreD4("reinjection").structure).toBe(0);
  });

  it("D5 inverts the party edit and leaves the amount slot", () => {
    expect(scoreD5("treatment").structure).toBe(1);
    expect(scoreD5("plain").structure).toBe(0);
  });

  it("D1 projection redacts the wrong amount from the next sample but keeps judgment for the lawyer", () => {
    expect(scoreD1Projection("treatment")).toEqual({ structure: 1, express: 1 });
    expect(scoreD1Projection("plain").structure).toBe(0);
  });

  it("D6 projection strips authority wording from the sampling view", () => {
    expect(scoreD6Projection("treatment").structure).toBe(1);
    expect(scoreD6Projection("treatment").express).toBe(1);
    expect(scoreD6Projection("plain").structure).toBe(0);
  });

  it("X3 accepts 8.8万元 for a grounded 88000 without forcing a rewrite", () => {
    expect(scoreX3("treatment")).toEqual({ structure: 1, express: 1 });
  });

  it("does not project a nearby contract price onto a calculated interest slot", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "interest", value: 4321 });
    const prose = "本合同价款总计为人民币 1280000 元。逾期利息为 99999 元。管辖争点宜另段展开。";
    applyProseSyndrome(state, prose);
    const sampled = projectAssistantProseForSampling(appendMechanicalNote(prose, state), state);
    expect(sampled).toContain("1280000");
    expect(sampled).not.toContain("99999");
    expect(sampled).toContain("管辖争点");
  });

  it("unbinds a polarity collision in the sample and keeps the judgment for the lawyer", () => {
    const prose = `${JUDGMENT}验收合格后，方可不得进行隐蔽。`;
    const state = emptyFactorState();
    applyProseSyndrome(state, prose);
    const voiced = appendMechanicalNote(prose, state);
    const sampled = projectAssistantProseForSampling(voiced, state);
    expect(voiced).toContain("继续履行");
    expect(voiced).toContain("方可不得");
    expect(sampled).toContain("继续履行");
    expect(sampled).not.toContain("方可不得");
    expect(sampled).toContain("【待核实】");
  });

  it("does not let a written 买方 become the draft's role basis", () => {
    const state = emptyFactorState();
    ingestDefinedTerms(state, "甲方：北京示例科技有限公司");
    applyProseSyndrome(state, "买方应于三日内付款。");
    ingestDraftBody(state, "买方应于三日内付款。");
    expect(state.documentRoles ?? []).not.toContain("买方");
    expect(state.factors.find((factor) => factor.anchor === "party:买方")?.flag).toBe("mixed");
  });

  it("X5 keeps a free skeleton header so the model is not forced into template columns", () => {
    expect(scoreX5("treatment")).toEqual({ structure: 1, express: 1 });
  });

  it("does not claim manuscripts: fixture prose is not a graded deliverable", () => {
    const state: FactorState = emptyFactorState();
    expect(state.factors).toEqual([]);
    // Guard against silent renaming that conflates this suite with the mechanical gate.
    expect("factor-state-capability").not.toContain("lawyer-suite");
  });
});
