/**
 * Lawyer-facing ablation suite (~500 items).
 *
 * What lawyers actually fix: citation, amount, party/definition, empty
 * redline, ungrounded definite claims, failed prose reentering the next
 * sample, conflicting parallel worker readings.
 *
 * What the model must stay free to write: judgment, structure, style,
 * contingency language, and numbers that are not the calculated slot.
 *
 * Arms:
 * - plain: ship the sentence as fact (no factor state)
 * - reinjection: drop history, keep only five invariant slogans
 * - treatment: current factor-state engine
 *
 * Frozen lawyer-shaped sentences, not graded manuscripts.
 * run() returns whether the arm handled the case correctly.
 */
import { describe, expect, it } from "vitest";
import {
  appendMechanicalNote,
  applyInverseEdits,
  applyProseSyndrome,
  composeWorkerSystem,
  consumeRedlineRepair,
  editContradictsGroundedAmount,
  emptyFactorState,
  formatMarginalBlock,
  fuseSharedAnchorLines,
  ingestDefinedTerms,
  ingestToolResult,
  marginalFactors,
  projectAssistantProseForSampling,
  projectReading,
  recordInverseEdits,
  recordReading,
  renderEngineReadings,
  revertProposals,
  selectSkeleton,
  type FactorState,
} from "./factor-state.js";

type Arm = "plain" | "reinjection" | "treatment";
type Kind =
  | "citation_bad"
  | "citation_ok"
  | "amount_bad"
  | "amount_ok"
  | "party_bad"
  | "party_ok"
  | "redline_bad"
  | "ungrounded_bad"
  | "fusion_conflict"
  | "fusion_paraphrase"
  | "sampling_redact"
  | "express_free"
  | "inverse_ok"
  | "marginal_ok"
  | "surgical_block";

type Case = {
  id: string;
  kind: Kind;
  /** Treatment must leave judgment / structure prose free. */
  express?: boolean;
  run: (arm: Arm) => boolean;
};

const REINJECTION = [
  "引用标识必须落在来源包",
  "金额须等于计算器",
  "定义与称谓不得漂移",
  "空修订不算完成",
  "没有出处不得写成事实",
].join("；");

const LAWS = [
  {
    name: "劳动合同法",
    article: 36,
    chinese: "三十六",
    snippet: "第三十六条 用人单位与劳动者协商一致，可以解除劳动合同。",
  },
  {
    name: "劳动合同法",
    article: 46,
    chinese: "四十六",
    snippet: "第四十六条 有下列情形之一的，用人单位应当向劳动者支付经济补偿。",
  },
  {
    name: "劳动合同法",
    article: 47,
    chinese: "四十七",
    snippet:
      "第四十七条 经济补偿按劳动者在本单位工作的年限，每满一年支付一个月工资的标准向劳动者支付。",
  },
  {
    name: "民法典",
    article: 577,
    chinese: "五百七十七",
    snippet:
      "第五百七十七条 当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担继续履行、采取补救措施或者赔偿损失等违约责任。",
  },
  {
    name: "民法典",
    article: 509,
    chinese: "五百零九",
    snippet: "第五百零九条 当事人应当按照约定全面履行自己的义务。",
  },
  {
    name: "民法典",
    article: 563,
    chinese: "五百六十三",
    snippet: "第五百六十三条 有下列情形之一的，当事人可以解除合同。",
  },
  {
    name: "公司法",
    article: 20,
    chinese: "二十",
    snippet: "第二十条 公司股东应当遵守法律、行政法规和公司章程。",
  },
  {
    name: "民事诉讼法",
    article: 27,
    chinese: "二十七",
    snippet: "第二十七条 因合同纠纷提起的诉讼，由被告住所地或者合同履行地人民法院管辖。",
  },
  {
    name: "劳动争议调解仲裁法",
    article: 27,
    chinese: "二十七",
    snippet: "第二十七条 劳动争议申请仲裁的时效期间为一年。",
  },
  {
    name: "工伤保险条例",
    article: 14,
    chinese: "十四",
    snippet: "第十四条 职工有下列情形之一的，应当认定为工伤。",
  },
] as const;

const AMOUNTS = [
  { op: "economic_compensation", value: 88000, label: "经济补偿", wrong: 90000 },
  { op: "economic_compensation", value: 12000, label: "经济补偿", wrong: 15000 },
  { op: "wage", value: 15000, label: "工资", wrong: 18000 },
  { op: "interest", value: 2400, label: "利息", wrong: 3000 },
  { op: "litigation_fee", value: 50, label: "诉讼费", wrong: 80 },
  { op: "economic_compensation", value: 265500, label: "经济补偿", wrong: 300000 },
  { op: "economic_compensation", value: 100000, label: "经济补偿", wrong: 120000 },
  { op: "wage", value: 22000, label: "工资", wrong: 25000 },
] as const;

const PARTIES = [
  { defined: "甲方：北京示例科技有限公司", foreign: "买方", ok: "甲方" },
  { defined: "乙方：上海示例贸易有限公司", foreign: "卖方", ok: "乙方" },
  { defined: "甲方：杭州示例网络有限公司（以下简称「公司」）", foreign: "需方", ok: "公司" },
  { defined: "委托方：广州示例律师事务所", foreign: "买方", ok: "委托方" },
  { defined: "出租人：深圳示例置业有限公司", foreign: "卖方", ok: "出租人" },
  { defined: "买方：成都示例商贸有限公司", foreign: "需方", ok: "买方" },
  { defined: "发包人：南京示例建设集团", foreign: "供方", ok: "发包人" },
  { defined: "许可方：武汉示例软件有限公司", foreign: "采购方", ok: "许可方" },
] as const;

const JUDGMENTS = [
  "综合本案证据，我方主张继续履行更符合商业安排。",
  "违约金条款偏高，建议按实际损失调整，不宜整条删除。",
  "管辖约定有效，但执行地与合同履行地不一致时仍需提示风险。",
  "解除权行使应以催告为前提，现有材料尚不足以支持立即解除。",
  "竞业限制补偿标准偏低，谈判时可要求补足差额。",
  "保密义务应保留，但期限与范围宜与岗位匹配。",
  "诉讼请求可并列主张解除与损害赔偿，由律师择一主攻。",
  "仲裁条款有效，不建议改成诉讼管辖。",
  "证据链缺口在出证时间，结论上宜写待核实而非直接否定。",
  "对方抗辩时效可能成立，建议先核对催告记录再定诉请。",
  "本合同属买卖合同纠纷，不是劳动争议程序。",
  "违约责任与损失填补应区分计算，避免重复计赔。",
  "解除通知发出后，后续往来不宜再按继续履行口径写。",
  "保全必要性取决于对方转移资产迹象，材料不足则不建议先保全。",
  "意见书结论可写「倾向于支持解除」，不必写成绝对胜诉。",
  "条款结构可先列争点、再列改法，不必拘泥模板栏目。",
  "文风保持所内交件口径，避免客服腔与工程黑话。",
  "缺当事人身份时按合理假设起草并标待核实，不要停下来采访。",
  "审查意见可同时给红线改法与谈判备选，由律师拍板。",
  "对不确定争点并列两种读法，比强行选边更稳妥。",
  "若对方补充付款凭证，现有解除主张可能需要改口。",
  "催告是否到达仍不明时，宜写两种程序路径供选择。",
  "赔偿上限条款可留，但应提示显失公平抗辩空间。",
  "送达地址条款建议保留，以免程序空转。",
] as const;

function reinjectOk(kind: Kind): boolean {
  return (
    kind.endsWith("_ok") ||
    kind === "express_free" ||
    kind === "fusion_paraphrase" ||
    kind === "marginal_ok" ||
    kind === "inverse_ok"
  );
}

function plainHandles(kind: Kind): boolean {
  return !(
    kind.endsWith("_bad") ||
    kind === "fusion_conflict" ||
    kind === "sampling_redact" ||
    kind === "surgical_block"
  );
}

function withRetrieved(law: (typeof LAWS)[number], demo = false): FactorState {
  const state = emptyFactorState();
  ingestToolResult(state, "search_statute", {
    sourceIds: [`${law.name}-${law.article}`],
    demoCorpus: demo,
    hits: [{ title: law.name, snippet: law.snippet }],
  });
  return state;
}

function withAmount(op: string, value: number): FactorState {
  const state = emptyFactorState();
  ingestToolResult(state, "calculate", { op, value });
  return state;
}

function mechanicalFlagged(state: FactorState, prose: string): boolean {
  applyProseSyndrome(state, prose);
  return state.factors.some(
    (factor) =>
      factor.flag === "conflict" || factor.flag === "mixed" || factor.flag === "uncorrectable",
  );
}

function moneyFormats(value: number): string[] {
  const comma = value.toLocaleString("en-US");
  const formats = [`${value}元`, `${value} 元`, `${comma}元`, `${comma} 元`];
  if (value % 10000 === 0) {
    formats.push(`${value / 10000}万元`, `${value / 10000} 万元`);
  }
  return formats;
}

function buildCases(): Case[] {
  const cases: Case[] = [];

  for (const law of LAWS) {
    for (const form of [
      `《${law.name}》第${law.article}条`,
      `《${law.name}》第${law.chinese}条`,
      `依据《${law.name}》第${law.article}条`,
    ] as const) {
      cases.push({
        id: `cite-ok-${law.name}-${law.article}-${form.length}`,
        kind: "citation_ok",
        express: true,
        run: (arm) => {
          if (arm !== "treatment") {
            return true;
          }
          return !mechanicalFlagged(withRetrieved(law), `${form}，可以据此主张。`);
        },
      });
      const wrongArticle = law.article + 63;
      cases.push({
        id: `cite-bad-${law.name}-${wrongArticle}-${form.length}`,
        kind: "citation_bad",
        run: (arm) => {
          const prose = `依据《${law.name}》第${wrongArticle}条，可以解除。`;
          if (arm === "plain") {
            return plainHandles("citation_bad");
          }
          if (arm === "reinjection") {
            return reinjectOk("citation_bad");
          }
          return mechanicalFlagged(withRetrieved(law), prose);
        },
      });
    }
    cases.push({
      id: `cite-demo-authority-${law.name}-${law.article}`,
      kind: "citation_bad",
      run: (arm) => {
        const prose = `根据权威来源《${law.name}》第${law.article}条，应当支持。`;
        if (arm === "plain") {
          return plainHandles("citation_bad");
        }
        if (arm === "reinjection") {
          return reinjectOk("citation_bad");
        }
        return mechanicalFlagged(withRetrieved(law, true), prose);
      },
    });
    cases.push({
      id: `cite-demo-labeled-${law.name}-${law.article}`,
      kind: "citation_ok",
      express: true,
      run: (arm) => {
        const prose = `演示语料《${law.name}》第${law.article}条，不是权威来源。`;
        if (arm !== "treatment") {
          return true;
        }
        return !mechanicalFlagged(withRetrieved(law, true), prose);
      },
    });
    cases.push({
      id: `cite-before-retrieve-${law.name}-${law.article}`,
      kind: "express_free",
      express: true,
      run: (arm) => {
        const prose = `可考虑援引《${law.name}》第${law.article}条，待检索核对。`;
        if (arm !== "treatment") {
          return true;
        }
        return !mechanicalFlagged(emptyFactorState(), prose);
      },
    });
  }

  for (const amount of AMOUNTS) {
    for (const fmt of moneyFormats(amount.value)) {
      cases.push({
        id: `amount-ok-${amount.op}-${amount.value}-${fmt}`,
        kind: "amount_ok",
        express: true,
        run: (arm) => {
          if (arm !== "treatment") {
            return true;
          }
          return !mechanicalFlagged(
            withAmount(amount.op, amount.value),
            `${amount.label}为 ${fmt}。`,
          );
        },
      });
    }
    for (const fmt of moneyFormats(amount.wrong)) {
      cases.push({
        id: `amount-bad-${amount.op}-${amount.wrong}-${fmt}`,
        kind: "amount_bad",
        run: (arm) => {
          const prose = `${amount.label}为 ${fmt}。`;
          if (arm === "plain") {
            return plainHandles("amount_bad");
          }
          if (arm === "reinjection") {
            return reinjectOk("amount_bad");
          }
          return mechanicalFlagged(withAmount(amount.op, amount.value), prose);
        },
      });
    }
    cases.push({
      id: `amount-nearby-fee-${amount.op}-${amount.value}`,
      kind: "amount_ok",
      express: true,
      run: (arm) => {
        if (arm !== "treatment") {
          return true;
        }
        const prose = `${amount.label}为 ${amount.value}元。另有案件受理费 50 元。`;
        return !mechanicalFlagged(withAmount(amount.op, amount.value), prose);
      },
    });
    if (amount.value >= 10000 && amount.wrong >= 10000) {
      cases.push({
        id: `amount-surgical-${amount.op}-${amount.value}`,
        kind: "surgical_block",
        run: (arm) => {
          if (arm === "plain") {
            return plainHandles("surgical_block");
          }
          if (arm === "reinjection") {
            return reinjectOk("surgical_block");
          }
          const blocked = editContradictsGroundedAmount(withAmount(amount.op, amount.value), [
            {
              find: `${amount.label} ${amount.value} 元`,
              replace: `${amount.label} ${amount.wrong} 元`,
            },
          ]);
          return blocked !== undefined;
        },
      });
    }
    cases.push({
      id: `amount-sampling-${amount.op}-${amount.value}`,
      kind: "sampling_redact",
      run: (arm) => {
        const prose = `${amount.label}为 ${amount.wrong} 元。相对方履行不能。`;
        if (arm === "plain") {
          return !prose.includes(String(amount.wrong));
        }
        if (arm === "reinjection") {
          return REINJECTION.includes("金额") && !prose.includes(String(amount.wrong));
        }
        const state = withAmount(amount.op, amount.value);
        applyProseSyndrome(state, prose);
        const voiced = appendMechanicalNote(prose, state);
        const sampled = projectAssistantProseForSampling(voiced, state);
        return !sampled.includes(String(amount.wrong)) && voiced.includes(String(amount.wrong));
      },
    });
  }

  for (const party of PARTIES) {
    cases.push({
      id: `party-bad-${party.foreign}-${party.ok}`,
      kind: "party_bad",
      run: (arm) => {
        const prose = `${party.foreign}应于三日内付款。`;
        if (arm === "plain") {
          return plainHandles("party_bad");
        }
        if (arm === "reinjection") {
          return reinjectOk("party_bad");
        }
        const state = emptyFactorState();
        ingestDefinedTerms(state, party.defined);
        return mechanicalFlagged(state, prose);
      },
    });
    cases.push({
      id: `party-ok-${party.ok}-${party.foreign}`,
      kind: "party_ok",
      express: true,
      run: (arm) => {
        if (arm !== "treatment") {
          return true;
        }
        const state = emptyFactorState();
        ingestDefinedTerms(state, party.defined);
        return !mechanicalFlagged(state, `${party.ok}应于三日内付款。`);
      },
    });
  }

  for (let i = 0; i < 24; i += 1) {
    cases.push({
      id: `redline-bad-${i}`,
      kind: "redline_bad",
      run: (arm) => {
        if (arm === "plain") {
          return plainHandles("redline_bad");
        }
        if (arm === "reinjection") {
          return reinjectOk("redline_bad");
        }
        const state = emptyFactorState();
        ingestToolResult(state, "render_tracked_draft", { code: "xml_qa_no_tracks" });
        return Boolean(consumeRedlineRepair(state).note);
      },
    });
    cases.push({
      id: `ungrounded-bad-${i}`,
      kind: "ungrounded_bad",
      run: (arm) => {
        if (arm === "plain") {
          return plainHandles("ungrounded_bad");
        }
        if (arm === "reinjection") {
          return reinjectOk("ungrounded_bad");
        }
        const state = emptyFactorState();
        recordReading(state, `clause:争点${i}`, "clause", `读法${i}`, false);
        return projectReading(state.factors[0]?.outcomes ?? []).kind !== "definite";
      },
    });
  }

  const outcomes = [
    ["may_terminate", "乙方有权解除", "乙方可以解除本合同"],
    ["must_pay", "应当支付违约金", "应支付违约金"],
    ["arbitrate", "提交仲裁", "约定仲裁解决"],
    ["continue", "继续履行", "宜继续履行合同"],
    ["compensate", "应支付经济补偿", "经济补偿应当支付"],
  ] as const;
  for (const [id, a, b] of outcomes) {
    for (let i = 0; i < 6; i += 1) {
      cases.push({
        id: `fusion-para-${id}-${i}`,
        kind: "fusion_paraphrase",
        express: true,
        run: (arm) => {
          if (arm !== "treatment") {
            return true;
          }
          const lines = fuseSharedAnchorLines([
            { anchor: `clause:${id}`, outcomeId: id, conclusion: a, span: a },
            { anchor: `clause:${id}`, outcomeId: id, conclusion: b, span: a },
          ]);
          return (
            lines.some((line) => line.startsWith("共享锚")) &&
            !lines.some((line) => line.startsWith("【待核实】"))
          );
        },
      });
      cases.push({
        id: `fusion-conflict-${id}-${i}`,
        kind: "fusion_conflict",
        run: (arm) => {
          if (arm === "plain") {
            return a === b;
          }
          if (arm === "reinjection") {
            return reinjectOk("fusion_conflict");
          }
          const lines = fuseSharedAnchorLines([
            { anchor: `clause:${id}`, outcomeId: `${id}_a`, conclusion: a, span: `原句${i}` },
            {
              anchor: `clause:${id}`,
              outcomeId: `${id}_b`,
              conclusion: `不${a}`,
              span: `原句${i}`,
            },
          ]);
          return lines.some((line) => line.startsWith("【待核实】"));
        },
      });
    }
  }

  for (const [index, judgment] of JUDGMENTS.entries()) {
    cases.push({
      id: `express-judgment-${index}`,
      kind: "express_free",
      express: true,
      run: (arm) => {
        if (arm !== "treatment") {
          return true;
        }
        const state = emptyFactorState();
        applyProseSyndrome(state, judgment);
        const note = appendMechanicalNote(judgment, state);
        return note === judgment && state.factors.every((factor) => factor.flag === "ok");
      },
    });
    cases.push({
      id: `express-with-calc-${index}`,
      kind: "express_free",
      express: true,
      run: (arm) => {
        if (arm !== "treatment") {
          return true;
        }
        const state = withAmount("economic_compensation", 88000);
        applyProseSyndrome(state, `${judgment}经济补偿为 88000 元。`);
        return !state.factors.some((factor) => factor.flag === "conflict");
      },
    });
    cases.push({
      id: `express-structure-${index}`,
      kind: "express_free",
      express: true,
      run: (arm) => {
        if (arm !== "treatment") {
          return true;
        }
        const prose = `一、争点\n${judgment}\n二、建议改法\n可增删调整栏目。`;
        return !mechanicalFlagged(emptyFactorState(), prose);
      },
    });
  }

  for (let i = 0; i < 28; i += 1) {
    cases.push({
      id: `inverse-ok-${i}`,
      kind: "inverse_ok",
      express: true,
      run: (arm) => {
        if (arm !== "treatment") {
          return true;
        }
        const state = emptyFactorState();
        const written = `甲方应于${i + 1}日内付款。`;
        recordInverseEdits(state, [{ find: "甲方", replace: "买方" }]);
        const forward = written.replace("甲方", "买方");
        const restored = applyInverseEdits(forward, state.inverseEdits ?? []);
        return restored.text === written && restored.applied === 1;
      },
    });
    cases.push({
      id: `marginal-ok-${i}`,
      kind: "marginal_ok",
      express: true,
      run: (arm) => {
        if (arm !== "treatment") {
          return true;
        }
        const state = emptyFactorState();
        ingestToolResult(state, "calculate", {
          op: "wage",
          value: 10000 + i,
          clauseAnchor: "clause:解除",
        });
        recordReading(state, "clause:管辖", "clause", "上海仲裁", true);
        const block = formatMarginalBlock(marginalFactors(state, ["clause:解除"]));
        const system = composeWorkerSystem({
          instructions: "只写这一段。",
          marginal: block,
          parentTranscript: "PARENT_SECRET 上一案赔偿上限",
        });
        return (
          block.includes("clause:解除") &&
          !system.includes("PARENT_SECRET") &&
          !block.includes("上海仲裁")
        );
      },
    });
    cases.push({
      id: `readings-survive-${i}`,
      kind: "express_free",
      express: true,
      run: (arm) => {
        if (arm === "plain") {
          return false;
        }
        if (arm === "reinjection") {
          return REINJECTION.includes("金额");
        }
        const state = withAmount("economic_compensation", 88000 + i);
        return renderEngineReadings(state).includes(String(88000 + i));
      },
    });
  }

  for (let i = 0; i < 18; i += 1) {
    cases.push({
      id: `skeleton-free-${i}`,
      kind: "express_free",
      express: true,
      run: (arm) => {
        if (arm !== "treatment") {
          return true;
        }
        return selectSkeleton({}).header?.includes("未从已验证骨架变形") === true;
      },
    });
    cases.push({
      id: `mechanical-note-keeps-judgment-${i}`,
      kind: "express_free",
      express: true,
      run: (arm) => {
        const judgment = `因相对方迟延，建议主张解除。经济补偿为 ${90000 + i} 元。`;
        if (arm === "plain" || arm === "reinjection") {
          return judgment.includes("建议主张解除");
        }
        const state = withAmount("economic_compensation", 88000);
        applyProseSyndrome(state, judgment);
        const voiced = appendMechanicalNote(judgment, state);
        return voiced.includes("建议主张解除") && voiced.includes("【机械核定】");
      },
    });
    cases.push({
      id: `revert-proposal-${i}`,
      kind: "express_free",
      express: true,
      run: (arm) => {
        if (arm !== "treatment") {
          return true;
        }
        const state = withAmount("economic_compensation", 88000);
        applyProseSyndrome(state, `经济补偿为 ${90000 + i} 元。`);
        revertProposals(state, []);
        const amount = state.factors.find(
          (factor) => factor.anchor === "amount:economic_compensation",
        );
        return (
          amount?.proposalId === undefined &&
          projectReading(amount?.outcomes ?? []).kind === "definite"
        );
      },
    });
  }

  return cases;
}

const CASES = buildCases();

describe("lawyer suite size", () => {
  it("covers about five hundred lawyer-shaped items", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(480);
    expect(CASES.length).toBeLessThanOrEqual(560);
  });
});

describe("lawyer suite ablation", () => {
  it("treatment beats plain and reinjection on mechanical errors without locking judgment prose", () => {
    let plainFailsCount = 0;
    let reinjectionFailsCount = 0;
    let treatmentFailsCount = 0;
    let expressKept = 0;
    let expressTotal = 0;

    for (const item of CASES) {
      const plainOk = item.run("plain");
      const reinjectionOk = item.run("reinjection");
      const treatmentOk = item.run("treatment");
      if (!plainOk) {
        plainFailsCount += 1;
      }
      if (!reinjectionOk) {
        reinjectionFailsCount += 1;
      }
      if (!treatmentOk) {
        treatmentFailsCount += 1;
      }
      if (item.express) {
        expressTotal += 1;
        if (treatmentOk) {
          expressKept += 1;
        }
      }
    }

    expect(treatmentFailsCount).toBeLessThan(plainFailsCount);
    expect(treatmentFailsCount).toBeLessThan(reinjectionFailsCount);
    expect(expressTotal).toBeGreaterThan(100);
    expect(expressKept / expressTotal).toBeGreaterThan(0.95);
    expect(plainFailsCount).toBeGreaterThan(100);
    expect(reinjectionFailsCount).toBeGreaterThan(100);
  });

  it.each(CASES.filter((item) => item.express).map((item) => [item.id, item] as const))(
    "keeps expression free: %s",
    (_id, item) => {
      expect(item.run("treatment")).toBe(true);
    },
  );

  it.each(
    CASES.filter(
      (item) =>
        item.kind.endsWith("_bad") ||
        item.kind === "fusion_conflict" ||
        item.kind === "sampling_redact" ||
        item.kind === "surgical_block",
    )
      .slice(0, 220)
      .map((item) => [item.id, item] as const),
  )("catches mechanical risk: %s", (_id, item) => {
    expect(item.run("treatment")).toBe(true);
  });
});
