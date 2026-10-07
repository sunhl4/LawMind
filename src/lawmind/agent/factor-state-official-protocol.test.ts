/**
 * Official task inventory, not the earlier engineering subset.
 *
 * CUAD v1: all 41 categories, Yes/No only when a span exists, dates in
 * mm/dd/yyyy, grouped categories may share one clause.
 * ContractNLI: 17 hypotheses, three-way, no argmax.
 * MAUD: paired deal points stay mixed.
 * LawBench: all 20 task ids, each scored with that task's published metric.
 *
 * Snippets are original. This does not report an official leaderboard score.
 * A judgment sentence must survive beside every item.
 */
import { describe, expect, it } from "vitest";
import { CUAD_GROUP1_SHARED, CUAD_OFFICIAL_CLAUSES } from "./cuad-official-clauses.js";
import {
  appendMechanicalNote,
  applyProseSyndrome,
  emptyFactorState,
  fuseSharedAnchorLines,
  ingestToolResult,
  projectAssistantProseForSampling,
  projectReading,
  renderEngineReadings,
  spanAttestsOutcome,
} from "./factor-state.js";
import {
  charFBeta,
  cuadDateAnswer,
  exactAccuracy,
  mean,
  multiLabelF1,
  normalizedLogDistance,
  rcF1,
  rougeL,
  singleLabelAccuracy,
  softF1,
} from "./legal-bench-metrics.js";
import { calculateLegal } from "./tools/legal/calculate-lib.js";

const JUDGMENT =
  "综合现有材料，我方主张就该条款保留谈判空间。若对方拒绝修改，则两种路径都写入意见。";

const NDA = [
  "本协议的存在本身亦属保密信息，接收方不得向第三方披露本协议已签署的事实。",
  "保密信息包括披露方以书面或口头方式提供、并在披露时标明保密的技术与经营信息。",
  "接收方不得对披露方软件进行反向工程。",
  "保密义务于本协议终止后三年内继续有效。",
  "协议终止时，接收方应返还或销毁保密信息，但依法必须留存的备份除外。",
  "接收方可向其律师披露保密信息，且无需另行通知披露方。",
  "接收方不得将保密信息用于本协议约定目的以外的用途。",
  "本协议不向接收方授予保密信息上的任何许可。",
].join("");

const CONTRACT_NLI: ReadonlyArray<{
  id: number;
  hypothesis: string;
  label: "entailment" | "contradiction" | "not_mentioned";
  span: string;
}> = [
  {
    id: 1,
    hypothesis: "协议已签署的事实亦属保密",
    label: "entailment",
    span: "本协议的存在本身亦属保密信息",
  },
  {
    id: 2,
    hypothesis: "口头提供并标明保密的信息属于保密信息",
    label: "entailment",
    span: "书面或口头方式提供、并在披露时标明保密",
  },
  {
    id: 3,
    hypothesis: "未标明保密的经营信息也当然构成保密信息",
    label: "contradiction",
    span: "并在披露时标明保密的技术与经营信息",
  },
  {
    id: 4,
    hypothesis: "接收方可以进行反向工程",
    label: "contradiction",
    span: "接收方不得对披露方软件进行反向工程",
  },
  {
    id: 5,
    hypothesis: "保密义务在终止后仍然存续",
    label: "entailment",
    span: "终止后三年内继续有效",
  },
  {
    id: 6,
    hypothesis: "终止后接收方应返还或销毁保密信息",
    label: "entailment",
    span: "接收方应返还或销毁保密信息",
  },
  {
    id: 7,
    hypothesis: "依法必须留存的备份可以不销毁",
    label: "entailment",
    span: "依法必须留存的备份除外",
  },
  {
    id: 8,
    hypothesis: "接收方不得向其律师披露",
    label: "contradiction",
    span: "接收方可向其律师披露保密信息",
  },
  {
    id: 9,
    hypothesis: "向律师披露无需另行通知披露方",
    label: "entailment",
    span: "无需另行通知披露方",
  },
  { id: 10, hypothesis: "接收方可以把保密信息卖给同业", label: "not_mentioned", span: "" },
  { id: 11, hypothesis: "接收方可以从第三方合法获得类似信息", label: "not_mentioned", span: "" },
  { id: 12, hypothesis: "接收方可以独立开发类似信息", label: "not_mentioned", span: "" },
  { id: 13, hypothesis: "接收方可以为备份复制保密信息", label: "not_mentioned", span: "" },
  { id: 14, hypothesis: "因司法程序被迫披露时应通知披露方", label: "not_mentioned", span: "" },
  {
    id: 15,
    hypothesis: "不得用于约定目的以外",
    label: "entailment",
    span: "不得将保密信息用于本协议约定目的以外的用途",
  },
  { id: 16, hypothesis: "接收方不得招揽披露方员工", label: "not_mentioned", span: "" },
  {
    id: 17,
    hypothesis: "本协议不授予保密信息上的许可",
    label: "entailment",
    span: "不向接收方授予保密信息上的任何许可",
  },
];

function assertJudgmentSurvives(label: string): void {
  const state = emptyFactorState();
  expect(applyProseSyndrome(state, JUDGMENT).action, label).toBe("none");
  const voiced = appendMechanicalNote(JUDGMENT, state);
  const sampled = projectAssistantProseForSampling(voiced, state);
  expect(voiced.startsWith(JUDGMENT), label).toBe(true);
  expect(sampled, label).toContain("两种路径");
  expect(sampled, label).toContain("主张就该条款保留谈判空间");
  expect(renderEngineReadings(state), label).toContain("【判断保留】");
  expect(
    state.factors.some((factor) => factor.flag === "conflict"),
    label,
  ).toBe(false);
}

describe("CUAD v1 official category list", () => {
  it("covers all 41 published categories exactly once", () => {
    expect(CUAD_OFFICIAL_CLAUSES).toHaveLength(41);
    expect(new Set(CUAD_OFFICIAL_CLAUSES.map((row) => row.index)).size).toBe(41);
    expect(CUAD_OFFICIAL_CLAUSES.map((row) => row.index)).toEqual(
      Array.from({ length: 41 }, (_, index) => index + 1),
    );
    const yesNo = CUAD_OFFICIAL_CLAUSES.filter((row) => row.answerKind === "yes_no");
    const derived = CUAD_OFFICIAL_CLAUSES.filter((row) => row.answerKind !== "yes_no");
    // Answer Format column: 32 Yes/No, and 9 derived strings
    // (name, parties, three dates, renewal, notice, governing law, warranty length).
    expect(yesNo).toHaveLength(32);
    expect(derived).toHaveLength(9);
  });

  it.each(CUAD_OFFICIAL_CLAUSES.map((row) => [row.officialName, row] as const))(
    "%s: the derived answer is a span, the absent sentence is not, and a judgment stays",
    (name, row) => {
      expect(row.excerpt.includes(row.answer), name).toBe(true);
      expect(row.absent.includes(row.answer), name).toBe(false);
      expect(spanAttestsOutcome(row.excerpt, row.answer), name).toBe(true);
      expect(spanAttestsOutcome(row.absent, row.answer), name).toBe(false);
      const distractor = `${row.absent}双方还应遵守《民法典》的规定。`;
      expect(spanAttestsOutcome(distractor, row.answer), name).toBe(false);
      const hit = emptyFactorState();
      ingestToolResult(hit, "draft_worker", {
        anchor: row.anchor,
        outcomeId: row.answer,
        span: row.excerpt,
        conclusion: row.answer,
      });
      expect(projectReading(hit.factors[0]?.outcomes ?? []).kind, name).toBe("definite");
      const miss = emptyFactorState();
      ingestToolResult(miss, "draft_worker", {
        anchor: row.anchor,
        outcomeId: row.answer,
        span: distractor,
        conclusion: row.answer,
      });
      expect(projectReading(miss.factors[0]?.outcomes ?? []).kind, name).toBe("mixed");
      if (row.answerKind === "yes_no") {
        expect(exactAccuracy("Yes", "Yes"), name).toBe(1);
        expect(exactAccuracy("No", "Yes"), name).toBe(0);
      }
      if (row.answerKind === "date") {
        expect(cuadDateAnswer(row.excerpt), name).toBe(cuadDateAnswer(row.answer));
        expect(cuadDateAnswer(row.answer), name).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      }
      assertJudgmentSurvives(name);
    },
  );

  it("lets one Group-1 clause answer effective date, expiration, renewal, and notice together", () => {
    const answers = ["2024年3月1日", "2027年3月1日", "自动续展一年", "届满前六十日书面通知"];
    for (const answer of answers) {
      expect(CUAD_GROUP1_SHARED.includes(answer)).toBe(true);
      expect(cuadDateAnswer(answer) ?? answer).toBeTruthy();
    }
    expect(cuadDateAnswer(CUAD_GROUP1_SHARED)).toBe("03/01/2024");
    const state = emptyFactorState();
    for (const [anchor, answer] of [
      ["clause:生效", "2024年3月1日"],
      ["clause:到期", "2027年3月1日"],
      ["clause:续展", "自动续展一年"],
      ["clause:续展通知", "届满前六十日书面通知"],
    ] as const) {
      ingestToolResult(state, "draft_worker", {
        anchor,
        outcomeId: answer,
        span: CUAD_GROUP1_SHARED,
        conclusion: answer,
      });
    }
    expect(state.factors).toHaveLength(4);
    for (const factor of state.factors) {
      expect(projectReading(factor.outcomes).kind).toBe("definite");
    }
    assertJudgmentSurvives("group-1");
  });
});

describe("ContractNLI 17 hypotheses", () => {
  it("has the published hypothesis count", () => {
    expect(CONTRACT_NLI).toHaveLength(17);
    expect(new Set(CONTRACT_NLI.map((row) => row.id)).size).toBe(17);
  });

  it.each(CONTRACT_NLI.map((row) => [String(row.id), row] as const))(
    "hypothesis %s keeps the three-way label and the judgment",
    (id, row) => {
      if (row.label === "entailment") {
        expect(NDA.includes(row.span), id).toBe(true);
        expect(spanAttestsOutcome(NDA, row.span), id).toBe(true);
        const state = emptyFactorState();
        ingestToolResult(state, "draft_worker", {
          anchor: `clause:nli-${row.id}`,
          outcomeId: row.span,
          span: NDA,
          conclusion: row.hypothesis,
        });
        expect(projectReading(state.factors[0]?.outcomes ?? []).kind, id).toBe("definite");
      }
      if (row.label === "contradiction") {
        const lines = fuseSharedAnchorLines([
          {
            anchor: `clause:nli-${row.id}`,
            outcomeId: "文本",
            conclusion: row.span,
            span: row.span,
          },
          {
            anchor: `clause:nli-${row.id}`,
            outcomeId: "假设相反",
            conclusion: row.hypothesis,
            span: row.hypothesis,
          },
        ]);
        expect(lines.join("\n"), id).toContain("【待核实】");
        expect(lines.join("\n"), id).toContain(row.span);
        expect(lines.join("\n"), id).toContain(row.hypothesis);
        expect(lines.join("\n"), id).not.toBe(row.hypothesis);
      }
      if (row.label === "not_mentioned") {
        expect(NDA.includes(row.hypothesis), id).toBe(false);
        const state = emptyFactorState();
        ingestToolResult(state, "draft_worker", {
          anchor: `clause:nli-${row.id}`,
          outcomeId: row.hypothesis,
          span: "本协议未写这一句。",
          conclusion: row.hypothesis,
        });
        expect(projectReading(state.factors[0]?.outcomes ?? []).kind, id).toBe("mixed");
      }
      assertJudgmentSurvives(`nli-${id}`);
    },
  );
});

describe("MAUD deal-point pairs", () => {
  it.each([
    ["MAE 与疫情除外", "发生重大不利变化即可终止", "疫情不属于重大不利变化"],
    ["GAAP 变更除外", "发生重大不利变化即可终止", "会计准则变更不构成重大不利变化"],
    ["努力程度", "应尽最大努力取得批准", "仅须尽商业上合理努力"],
    ["普通经营", "应在普通经营过程中运营", "可按买方书面指示偏离普通经营"],
    ["信义义务例外", "董事会可在信义义务要求时改变推荐", "推荐改变须经买方同意"],
    ["匹配权", "买方享有四个工作日的匹配权", "目标公司不得征求替代交易"],
    ["反向终止费", "买方在反垄断失败时支付反向终止费", "任何一方均无须支付终止费"],
    ["实际履行", "目标公司有权请求实际履行", "救济仅限于损害赔偿"],
  ] as const)("%s stays mixed and keeps both readings", (name, left, right) => {
    const lines = fuseSharedAnchorLines([
      { anchor: "clause:成交条件", outcomeId: `${name}-a`, conclusion: left, span: left },
      { anchor: "clause:成交条件", outcomeId: `${name}-b`, conclusion: right, span: right },
    ]);
    expect(lines.join("\n"), name).toContain("【待核实】");
    expect(lines.join("\n"), name).toContain(left);
    expect(lines.join("\n"), name).toContain(right);
    expect(lines.join("\n"), name).not.toContain("共享锚");
    assertJudgmentSurvives(name);
  });
});

describe("LawBench 20 tasks with published metrics", () => {
  it("1-1 article recitation: ROUGE-L stays high when a judgment follows the article", () => {
    const gold = "经济补偿按劳动者在本单位工作的年限，每满一年支付一个月工资。";
    const prediction = `${gold}${JUDGMENT}`;
    expect(rougeL(prediction, gold)).toBeGreaterThan(0.45);
    expect(prediction).toContain("两种路径");
    assertJudgmentSurvives("1-1");
  });

  it("1-2 knowledge QA: one label scores, two extracted labels score zero", () => {
    expect(singleLabelAccuracy(["诉讼时效为三年"], "诉讼时效为三年")).toBe(1);
    expect(singleLabelAccuracy(["诉讼时效为三年", "诉讼时效为一年"], "诉讼时效为三年")).toBe(0);
    assertJudgmentSurvives("1-2");
  });

  it("2-1 proofreading: F0.5 prefers the corrected sentence over a still-wrong one", () => {
    const gold = "甲方应于十日内付款。";
    const corrected = "甲方应于十日内付款。";
    const stillWrong = "甲方应于十日付款项。";
    expect(charFBeta(corrected, gold, 0.5)).toBe(1);
    expect(charFBeta(stillWrong, gold, 0.5)).toBeLessThan(1);
    assertJudgmentSurvives("2-1");
  });

  it("2-2 and 2-3 multi-label F1 gives partial credit and does not require a single label", () => {
    expect(multiLabelF1(["借款本金", "利息"], ["借款本金", "利息", "违约金"])).toBeCloseTo(0.8, 5);
    expect(multiLabelF1(["抚养", "探望"], ["抚养", "探望"])).toBe(1);
    expect(multiLabelF1(["离婚"], ["抚养", "探望"])).toBe(0);
    assertJudgmentSurvives("2-2");
    assertJudgmentSurvives("2-3");
  });

  it("2-4 and 2-8 and 3-6 single-label accuracy", () => {
    expect(exactAccuracy("合同纠纷", "合同纠纷")).toBe(1);
    expect(exactAccuracy("刑事", "合同纠纷")).toBe(0);
    expect(singleLabelAccuracy(["原告举证不能"], "原告举证不能")).toBe(1);
    expect(exactAccuracy("驳回诉讼请求", "驳回诉讼请求")).toBe(1);
    assertJudgmentSurvives("2-4");
  });

  it("2-5 reading comprehension rc-F1 extracts the span and still allows a judgment", () => {
    const passage = "劳动者月工资一万五千元，工作三年，解除后依法支付经济补偿。";
    const gold = "工作三年，解除后依法支付经济补偿";
    expect(passage.includes(gold)).toBe(true);
    expect(rcF1(gold, gold)).toBe(1);
    const reply = `${gold}。${JUDGMENT}`;
    expect(reply).toContain("两种路径");
    expect(rcF1(gold, gold)).toBeGreaterThan(rcF1("无关句子", gold));
    expect(rcF1(reply, gold)).toBeGreaterThan(rcF1("无关句子", gold));
    assertJudgmentSurvives("2-5");
  });

  it("2-6 and 2-10 soft-F1 accepts a shortened name and rejects an unrelated string", () => {
    const gold = ["上海示例科技有限公司", "张三"];
    expect(softF1(["上海示例科技有限公司", "张三"], gold)).toBe(1);
    expect(softF1(["上海示例科技", "张三"], gold)).toBeGreaterThan(0.7);
    expect(softF1(["完全另一家公司"], gold)).toBeLessThan(0.5);
    expect(softF1(["解除劳动合同"], ["解除劳动合同"])).toBe(1);
    assertJudgmentSurvives("2-6");
  });

  it("2-7 and 3-2 and 3-8 ROUGE-L keeps a judgment suffix above an unrelated answer", () => {
    const gold = "法院认定解除违法，并支持经济补偿。";
    const withJudgment = `${gold}${JUDGMENT}`;
    const unrelated = "建议双方和解。";
    expect(rougeL(withJudgment, gold)).toBeGreaterThan(rougeL(unrelated, gold));
    expect(withJudgment).toContain("两种路径");
    assertJudgmentSurvives("3-8");
  });

  it("2-9 and 3-1 and 3-3 multi-label F1", () => {
    expect(multiLabelF1(["付款", "逾期"], ["付款", "逾期"])).toBe(1);
    expect(multiLabelF1(["第四十七条"], ["第四十七条", "第四十六条"])).toBeCloseTo(2 / 3, 5);
    expect(multiLabelF1(["故意伤害"], ["故意伤害", "寻衅滋事"])).toBeCloseTo(2 / 3, 5);
    assertJudgmentSurvives("3-1");
  });

  it("3-4 and 3-5 normalized log-distance prefers the nearer prison term", () => {
    const goldMonths = 36;
    expect(normalizedLogDistance(36, goldMonths)).toBe(1);
    expect(normalizedLogDistance(30, goldMonths)).toBeGreaterThan(
      normalizedLogDistance(12, goldMonths),
    );
    const stated = "有期徒刑三年。综合现有材料，我方主张保留上诉。";
    expect(stated).toContain("有期徒刑三年");
    expect(stated).toContain("主张");
    assertJudgmentSurvives("3-4");
  });

  it("3-7 accuracy is exact on calculateLegal, including N, 2N, N+1, and the wage cap", () => {
    const rows = [
      { yearsOfService: 3, monthlyWageYuan: 15_000, kind: "N" as const, expected: 45_000 },
      { yearsOfService: 3, monthlyWageYuan: 10_000, kind: "2N" as const, expected: 60_000 },
      { yearsOfService: 2, monthlyWageYuan: 8_000, kind: "N+1" as const, expected: 24_000 },
      {
        yearsOfService: 20,
        monthlyWageYuan: 50_000,
        localAverageWageYuan: 10_000,
        kind: "N" as const,
        expected: 360_000,
      },
      { yearsOfService: 0.4, monthlyWageYuan: 12_000, kind: "N" as const, expected: 6_000 },
      { yearsOfService: 0.6, monthlyWageYuan: 12_000, kind: "N" as const, expected: 12_000 },
      { yearsOfService: 3.6, monthlyWageYuan: 10_000, kind: "N" as const, expected: 40_000 },
    ];
    const scores = rows.map((row) => {
      const computed = calculateLegal("economic_compensation", row);
      expect(computed.ok).toBe(true);
      if (!computed.ok) {
        return 0;
      }
      return exactAccuracy(String(computed.result.value), String(row.expected));
    });
    expect(mean(scores)).toBe(1);
    assertJudgmentSurvives("3-7");
  });

  it("reports a metric for every LawBench id and never folds them into one score", () => {
    const byTask = {
      "1-1": rougeL("经济补偿按年限支付。两种路径都写。", "经济补偿按年限支付。"),
      "1-2": singleLabelAccuracy(["三年"], "三年"),
      "2-1": charFBeta("十日内付款", "十日内付款", 0.5),
      "2-2": multiLabelF1(["本金", "利息"], ["本金", "利息"]),
      "2-3": multiLabelF1(["抚养"], ["抚养", "探望"]),
      "2-4": exactAccuracy("合同", "合同"),
      "2-5": rcF1("工作三年", "工作三年支付补偿"),
      "2-6": softF1(["张三"], ["张三"]),
      "2-7": rougeL("认定解除违法。", "认定解除违法。"),
      "2-8": exactAccuracy("举证不能", "举证不能"),
      "2-9": multiLabelF1(["付款"], ["付款"]),
      "2-10": softF1(["解除"], ["解除"]),
      "3-1": multiLabelF1(["第四十七条"], ["第四十七条"]),
      "3-2": rougeL("可适用第四十七条。", "可适用第四十七条。"),
      "3-3": multiLabelF1(["故意伤害"], ["故意伤害"]),
      "3-4": normalizedLogDistance(36, 36),
      "3-5": normalizedLogDistance(36, 36),
      "3-6": exactAccuracy("驳回", "驳回"),
      "3-7": exactAccuracy("45000", "45000"),
      "3-8": rougeL(`可以主张补偿。${JUDGMENT}`, "可以主张补偿。"),
    };
    expect(Object.keys(byTask)).toHaveLength(20);
    for (const [id, score] of Object.entries(byTask)) {
      expect(score, id).toBeGreaterThan(0);
      expect(score, id).toBeLessThanOrEqual(1);
    }
    expect(byTask["2-3"]).toBeLessThan(byTask["2-2"]);
    expect(byTask["3-8"]).toBeLessThan(1);
    expect(byTask["3-8"]).toBeGreaterThan(rougeL("无关回答", "可以主张补偿。"));
  });
});
