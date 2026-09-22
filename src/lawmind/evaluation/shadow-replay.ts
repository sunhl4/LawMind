/**
 * W2-5 影子回放：两层口径。
 *
 * 静态层（本文件 runShadowReplay，draftSource="fixture-static"）：
 * 合成已结案对照，不跑 engine.plan/draft；engineDraftText 是 fixture 静态串。
 * 语义 = lint/重叠的回归 fixture 层（lint 规则被删会让静态层召回掉下 1），
 * 不是「真实任务回放」证据。
 *
 * 真回放层（shadow-engine-replay.ts，draftSource="engine-scripted-model"）：
 * fixture 携带模型脚本（modelScript，类似 VCR cassette），由脚本化模型驱动
 * 真实 runTurn 管线（真实工具、真实 lint、真实门禁）产出草稿，报告数字反映
 * 引擎真实产出，允许 <1。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLegalLint } from "../lint/run-lint.js";

/**
 * 脚本化模型的一步：一次真实工具调用。
 * args 字符串支持两个占位符：
 *   - "$instruction" / "$engineDraftText"：回放驱动器在开局前按 fixture 字段解析；
 *   - "$lastDraftTaskId"：脚本化模型服务在每次请求时从对话历史里的
 *     draft_document 工具结果解析（taskId 运行时才生成，cassette 无法预知）。
 */
export type ShadowModelScriptStep = {
  tool: string;
  args?: Record<string, unknown>;
};

export type ShadowReplayFixture = {
  id: string;
  instruction: string;
  lawyerFinalText: string;
  engineDraftText: string;
  plantedDefectRuleIds?: string[];
  /**
   * 真回放层 cassette：脚本化模型依次执行的工具调用。
   * 缺省时该 fixture 不参与 engine-scripted-model 层（静态层不受影响）。
   */
  modelScript?: ShadowModelScriptStep[];
};

/**
 * 内置 fixture 的标准 cassette：先走真实 draft_document 管线（plan→research→
 * draft→persist，含真实 lint/自检/门禁），再用 update_draft 把 fixture 的草稿
 * 文本写入草稿（触发真实改稿门禁与 redline 生成）。澄清门禁由驱动器按真实
 * 律师会话流程放行（先答澄清，再继续改稿）。
 */
export function defaultShadowModelScript(): ShadowModelScriptStep[] {
  return [
    { tool: "draft_document", args: { instruction: "$instruction" } },
    {
      tool: "update_draft",
      args: {
        task_id: "$lastDraftTaskId",
        sections: [{ heading: "回放草稿", body: "$engineDraftText" }],
      },
    },
  ];
}

export type ShadowReplayCaseResult = {
  id: string;
  similarity: number;
  plantedDefectRecall: number | null;
  hitRuleIds: string[];
  plantedRuleIds: string[];
};

export type ShadowReplaySummary = {
  cases: number;
  meanOverlap: number;
  defectRecall: number | null;
  /** 草稿来源口径：fixture 静态串（非引擎产出）。真实引擎回放是独立大项，落地前不得改标。 */
  draftSource: "fixture-static";
  reportZh: string;
};

export type ShadowReplayReport = {
  results: ShadowReplayCaseResult[];
  summary: ShadowReplaySummary;
};

export const BUILTIN_SHADOW_FIXTURES: ShadowReplayFixture[] = [
  {
    id: "shadow-deposit-30",
    instruction: "请审查买卖合同定金条款。",
    lawyerFinalText: "第一条 定金为本合同标的额的百分之十。卖方应在签约后收取定金。",
    engineDraftText: "第一条 定金为本合同标的额的 30%。卖方应在签约后收取定金。",
    plantedDefectRuleIds: ["statutory.deposit_cap"],
    modelScript: defaultShadowModelScript(),
  },
  {
    id: "shadow-or-arbitrate",
    instruction: "请审查争议解决条款。",
    lawyerFinalText: "第二条 因本合同引起的争议，提交北京仲裁委员会仲裁。",
    engineDraftText: "第二条 争议既可以申请仲裁也可以向人民法院起诉。",
    plantedDefectRuleIds: ["form.or_arbitrate_or_sue"],
    modelScript: defaultShadowModelScript(),
  },
  {
    id: "shadow-clean-nda",
    instruction: "请起草保密条款。",
    lawyerFinalText: "双方应对商业秘密承担保密义务，期限三年，未经书面同意不得向第三方披露。",
    engineDraftText: "双方应对商业秘密承担保密义务，期限三年，未经书面同意不得向第三方披露。",
    modelScript: defaultShadowModelScript(),
  },
  {
    id: "shadow-lease-no-rent",
    instruction: "请审查房屋租赁合同。",
    lawyerFinalText: "房屋租赁合同。租期一年，月租金八千元，押金一个月。",
    engineDraftText: "房屋租赁合同。第一条 甲乙双方订立本合同。",
    plantedDefectRuleIds: ["lease.rent"],
    modelScript: defaultShadowModelScript(),
  },
  {
    id: "shadow-employment-no-pay",
    instruction: "请审查劳动合同。",
    lawyerFinalText: "劳动合同。岗位为法务，月工资一万元，合同期限三年。",
    engineDraftText: "劳动合同。第一条 甲方聘用乙方。",
    plantedDefectRuleIds: ["employment.pay"],
    modelScript: defaultShadowModelScript(),
  },
  {
    id: "shadow-equity-no-ratio",
    instruction: "请审查股权转让协议。",
    lawyerFinalText: "股权转让协议。转让持股百分之十，对价一百万元，交割后办理工商变更。",
    engineDraftText: "股权转让协议。第一条 双方同意转让。",
    plantedDefectRuleIds: ["equity.ratio"],
    modelScript: defaultShadowModelScript(),
  },
  {
    id: "shadow-construction-no-schedule",
    instruction: "请审查建设工程施工合同。",
    lawyerFinalText: "建设工程施工合同。开工日与竣工日已列，工程价款按进度款支付。",
    engineDraftText: "建设工程施工合同。第一条 承包范围为本工程。",
    plantedDefectRuleIds: ["construction.schedule"],
    modelScript: defaultShadowModelScript(),
  },
  {
    id: "shadow-sale-no-acceptance",
    instruction: "请审查买卖合同。",
    lawyerFinalText: "买卖合同。甲方出售货物，乙方付款。价款一万元。交付后七日内验收。",
    engineDraftText: "买卖合同。甲方出售货物，乙方付款。价款一万元。",
    plantedDefectRuleIds: ["sale.acceptance"],
    modelScript: defaultShadowModelScript(),
  },
  {
    id: "shadow-loan-no-interest",
    instruction: "请审查借款合同。",
    lawyerFinalText: "借款合同。甲方出借，乙方收款。年利率百分之四，按月还本付息。",
    engineDraftText: "借款合同。甲方出借，乙方收款。",
    plantedDefectRuleIds: ["loan.interest"],
    modelScript: defaultShadowModelScript(),
  },
  {
    id: "shadow-placeholder",
    instruction: "请审查待补合同。",
    lawyerFinalText: "本合同甲方为甲公司，标的额 10000 元。",
    engineDraftText: "本合同甲方为【待补充】，标的额 10000 元。",
    plantedDefectRuleIds: ["placeholder.open"],
    modelScript: defaultShadowModelScript(),
  },
  {
    id: "shadow-guarantee-no-period",
    instruction: "请审查保证条款。",
    lawyerFinalText:
      "丙方作为保证人就主债务承担连带责任保证，保证期间为主债务履行期届满之日起六个月。",
    engineDraftText: "丙方作为保证人就主债务承担连带责任保证。",
    plantedDefectRuleIds: ["form.guarantee_period"],
    modelScript: defaultShadowModelScript(),
  },
  {
    id: "shadow-party-pair",
    instruction: "请审查合同主体。",
    lawyerFinalText: "本合同甲方负责供货，乙方按月结算价款。",
    engineDraftText: "本合同甲方负责供货，价款按月结算。",
    plantedDefectRuleIds: ["consistency.party_pair"],
    modelScript: defaultShadowModelScript(),
  },
];

function defaultShadowFixtureDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "shadow");
}

function parseModelScript(raw: unknown): ShadowModelScriptStep[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const steps: ShadowModelScriptStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return undefined;
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.tool !== "string" || !rec.tool.trim()) {
      return undefined;
    }
    if (
      rec.args !== undefined &&
      (!rec.args || typeof rec.args !== "object" || Array.isArray(rec.args))
    ) {
      return undefined;
    }
    steps.push({
      tool: rec.tool,
      ...(rec.args ? { args: rec.args as Record<string, unknown> } : {}),
    });
  }
  return steps;
}

function parseShadowFixture(raw: unknown): ShadowReplayFixture | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  if (
    typeof rec.id !== "string" ||
    typeof rec.instruction !== "string" ||
    typeof rec.lawyerFinalText !== "string" ||
    typeof rec.engineDraftText !== "string"
  ) {
    return undefined;
  }
  const planted = rec.plantedDefectRuleIds;
  const modelScript = parseModelScript(rec.modelScript);
  return {
    id: rec.id,
    instruction: rec.instruction,
    lawyerFinalText: rec.lawyerFinalText,
    engineDraftText: rec.engineDraftText,
    plantedDefectRuleIds: Array.isArray(planted)
      ? planted.filter((id): id is string => typeof id === "string")
      : undefined,
    ...(modelScript ? { modelScript } : {}),
  };
}

/** 从目录加载合成夹具，并与内置集合按 id 合并（磁盘同 id 覆盖）。 */
export function loadShadowFixtures(dir = defaultShadowFixtureDir()): ShadowReplayFixture[] {
  const byId = new Map(BUILTIN_SHADOW_FIXTURES.map((row) => [row.id, row]));
  try {
    if (!fs.existsSync(dir)) {
      return [...byId.values()];
    }
    for (const name of fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .toSorted()) {
      try {
        const parsed = parseShadowFixture(
          JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as unknown,
        );
        if (parsed) {
          byId.set(parsed.id, parsed);
        }
      } catch {
        /* skip bad file */
      }
    }
  } catch {
    return BUILTIN_SHADOW_FIXTURES;
  }
  return [...byId.values()];
}

function tokenizeForOverlap(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9]{2,}/g)) {
    tokens.add(m[0] ?? "");
  }
  const compact = lower.replace(/\s+/g, "");
  if (compact.length === 1) {
    tokens.add(compact);
  }
  for (let i = 0; i < compact.length - 1; i += 1) {
    tokens.add(compact.slice(i, i + 2));
  }
  return tokens;
}

/** 确定性重叠：词元 + 二字滑动窗口 Jaccard。 */
export function textOverlapRatio(a: string, b: string): number {
  const left = tokenizeForOverlap(a);
  const right = tokenizeForOverlap(b);
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const token of left) {
    if (right.has(token)) {
      inter += 1;
    }
  }
  const union = left.size + right.size - inter;
  return union === 0 ? 1 : inter / union;
}

function plantedRecall(
  engineDraftText: string,
  plantedDefectRuleIds: string[] | undefined,
): { recall: number | null; hitRuleIds: string[]; plantedRuleIds: string[] } {
  const plantedRuleIds = plantedDefectRuleIds ?? [];
  // 静态层 fixture 都是合同稿；须带 deliverableType，否则族规则 fail-closed 会把植入召回打穿。
  const found = new Set(
    runLegalLint(engineDraftText, undefined, undefined, [], {
      deliverableType: "contract.review",
    }).findings.map((f) => f.ruleId),
  );
  const hitRuleIds = plantedRuleIds.filter((id) => found.has(id));
  if (plantedRuleIds.length === 0) {
    return { recall: null, hitRuleIds, plantedRuleIds };
  }
  return {
    recall: hitRuleIds.length / plantedRuleIds.length,
    hitRuleIds,
    plantedRuleIds,
  };
}

function buildReportZh(
  results: ShadowReplayCaseResult[],
  summary: Omit<ShadowReplaySummary, "reportZh">,
): string {
  const recallZh =
    summary.defectRecall == null ? "无植入样本" : `${(summary.defectRecall * 100).toFixed(0)}%`;
  const lines = [
    `影子回放 ${summary.cases} 件。平均重叠 ${(summary.meanOverlap * 100).toFixed(1)}%。植入缺陷召回 ${recallZh}。`,
    "草稿来源：fixture-static（fixture 静态串，非引擎产出；仅作 lint 回归层证据）。",
  ];
  for (const row of results) {
    const caseRecall =
      row.plantedDefectRecall == null ? "—" : `${(row.plantedDefectRecall * 100).toFixed(0)}%`;
    lines.push(`- ${row.id}：重叠 ${(row.similarity * 100).toFixed(1)}%，缺陷召回 ${caseRecall}`);
  }
  return lines.join("\n");
}

export function runShadowReplay(fixtures: ShadowReplayFixture[]): ShadowReplayReport {
  const results: ShadowReplayCaseResult[] = fixtures.map((fixture) => {
    const planted = plantedRecall(fixture.engineDraftText, fixture.plantedDefectRuleIds);
    return {
      id: fixture.id,
      similarity: textOverlapRatio(fixture.lawyerFinalText, fixture.engineDraftText),
      plantedDefectRecall: planted.recall,
      hitRuleIds: planted.hitRuleIds,
      plantedRuleIds: planted.plantedRuleIds,
    };
  });

  const cases = results.length;
  const meanOverlap =
    cases === 0 ? 0 : results.reduce((sum, row) => sum + row.similarity, 0) / cases;

  let plantedTotal = 0;
  let plantedHits = 0;
  for (const row of results) {
    plantedTotal += row.plantedRuleIds.length;
    plantedHits += row.hitRuleIds.length;
  }
  const defectRecall = plantedTotal === 0 ? null : plantedHits / plantedTotal;

  const summaryBase = { cases, meanOverlap, defectRecall, draftSource: "fixture-static" as const };
  return {
    results,
    summary: {
      ...summaryBase,
      reportZh: buildReportZh(results, summaryBase),
    },
  };
}
