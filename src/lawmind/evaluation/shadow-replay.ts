/**
 * W2-5 影子回放：合成已结案对照（不跑 engine.plan/draft，不依赖真实案卷）。
 * 重叠为确定性字符/词元 Jaccard，缺陷召回走 runLegalLint。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLegalLint } from "../lint/run-lint.js";

export type ShadowReplayFixture = {
  id: string;
  instruction: string;
  lawyerFinalText: string;
  engineDraftText: string;
  plantedDefectRuleIds?: string[];
};

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
  },
  {
    id: "shadow-or-arbitrate",
    instruction: "请审查争议解决条款。",
    lawyerFinalText: "第二条 因本合同引起的争议，提交北京仲裁委员会仲裁。",
    engineDraftText: "第二条 争议既可以申请仲裁也可以向人民法院起诉。",
    plantedDefectRuleIds: ["form.or_arbitrate_or_sue"],
  },
  {
    id: "shadow-clean-nda",
    instruction: "请起草保密条款。",
    lawyerFinalText: "双方应对商业秘密承担保密义务，期限三年，未经书面同意不得向第三方披露。",
    engineDraftText: "双方应对商业秘密承担保密义务，期限三年，未经书面同意不得向第三方披露。",
  },
];

export function defaultShadowFixtureDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "shadow");
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
  return {
    id: rec.id,
    instruction: rec.instruction,
    lawyerFinalText: rec.lawyerFinalText,
    engineDraftText: rec.engineDraftText,
    plantedDefectRuleIds: Array.isArray(planted)
      ? planted.filter((id): id is string => typeof id === "string")
      : undefined,
  };
}

/** 从目录加载合成夹具；目录缺失或无有效 JSON 时回退内置三条。 */
export function loadShadowFixtures(dir = defaultShadowFixtureDir()): ShadowReplayFixture[] {
  try {
    if (!fs.existsSync(dir)) {
      return BUILTIN_SHADOW_FIXTURES;
    }
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .toSorted();
    const loaded: ShadowReplayFixture[] = [];
    for (const name of files) {
      try {
        const parsed = parseShadowFixture(
          JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as unknown,
        );
        if (parsed) {
          loaded.push(parsed);
        }
      } catch {
        /* skip bad file */
      }
    }
    return loaded.length > 0 ? loaded : BUILTIN_SHADOW_FIXTURES;
  } catch {
    return BUILTIN_SHADOW_FIXTURES;
  }
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
  const found = new Set(runLegalLint(engineDraftText).findings.map((f) => f.ruleId));
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

  const summaryBase = { cases, meanOverlap, defectRecall };
  return {
    results,
    summary: {
      ...summaryBase,
      reportZh: buildReportZh(results, summaryBase),
    },
  };
}
