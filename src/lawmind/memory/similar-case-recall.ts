/**
 * Cross-matter CASE.md similarity recall — surface past matter experience
 * so the agent is not limited to the active case or raw LLM memory.
 *
 * Scoring (P1-1): token coverage + section weights (争点/风险优先) + phrase bonus.
 */

import fs from "node:fs";
import path from "node:path";
import { listMatterIds } from "../cases/index.js";
import { caseFilePath } from "../memory/index.js";
import { PROMPT_WINDOW } from "./prompt-windows.js";

export type SimilarCaseHit = {
  matterId: string;
  score: number;
  snippet: string;
  relativePath: string;
};

const STOP = new Set([
  "的",
  "了",
  "和",
  "与",
  "及",
  "或",
  "在",
  "是",
  "请",
  "帮",
  "我",
  "一份",
  "这个",
  "那个",
  "进行",
  "相关",
  "关于",
]);

/** Higher weight = more diagnostic for “similar matter” recall. */
const SECTION_WEIGHTS: Array<{ match: RegExp; weight: number }> = [
  { match: /核心争点|争点|争议焦点/, weight: 2.6 },
  { match: /风险|风险提示|风险点/, weight: 2.2 },
  { match: /策略|办案策略|下一步/, weight: 1.6 },
  { match: /基本信息|当事人|案由/, weight: 1.2 },
  { match: /进度|进展|日志/, weight: 0.9 },
];

export function tokenizeForRecall(text: string): string[] {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const t of lower.split(/[^\p{L}\p{N}]+/u)) {
    const x = t.trim();
    if (x.length >= 2 && !STOP.has(x)) {
      out.add(x);
    }
  }
  const cjk = lower.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) {
    const bi = cjk.slice(i, i + 2);
    if (!STOP.has(bi)) {
      out.add(bi);
    }
  }
  for (const m of lower.matchAll(/[\u4e00-\u9fff]{3,6}/g)) {
    const phrase = m[0];
    if (!STOP.has(phrase)) {
      out.add(phrase);
    }
  }
  return [...out].slice(0, 80);
}

function splitSections(caseText: string): Array<{ heading: string; body: string }> {
  const parts = caseText.split(/^##\s+/m);
  const out: Array<{ heading: string; body: string }> = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const nl = trimmed.indexOf("\n");
    if (nl < 0) {
      out.push({ heading: trimmed, body: "" });
      continue;
    }
    out.push({ heading: trimmed.slice(0, nl).trim(), body: trimmed.slice(nl + 1) });
  }
  if (out.length === 0) {
    out.push({ heading: "", body: caseText });
  }
  return out;
}

function sectionWeight(heading: string): number {
  for (const row of SECTION_WEIGHTS) {
    if (row.match.test(heading)) {
      return row.weight;
    }
  }
  return 1;
}

/**
 * Weighted overlap score in [0, 1].
 * Prefer hits in 争点/风险 sections; bonus for longer phrase matches.
 */
export function scoreCaseWeighted(queryTokens: string[], caseText: string): number {
  if (queryTokens.length === 0 || !caseText.trim()) {
    return 0;
  }
  const sections = splitSections(caseText);
  let weightedHits = 0;
  let weightDenom = 0;
  const hitTokens = new Set<string>();

  for (const token of queryTokens) {
    let bestW = 0;
    for (const sec of sections) {
      const hay = `${sec.heading}\n${sec.body}`.toLowerCase();
      if (hay.includes(token)) {
        bestW = Math.max(bestW, sectionWeight(sec.heading));
      }
    }
    weightDenom += 1;
    if (bestW > 0) {
      weightedHits += bestW;
      hitTokens.add(token);
    }
  }

  let coverage = weightDenom > 0 ? weightedHits / (weightDenom * 2.6) : 0;

  // Phrase bonus: contiguous 3+ CJK / long latin tokens that appear verbatim
  let phraseBonus = 0;
  for (const token of queryTokens) {
    if (token.length >= 3 && caseText.toLowerCase().includes(token) && hitTokens.has(token)) {
      phraseBonus += 0.04;
    }
  }
  coverage = Math.min(1, coverage + Math.min(0.2, phraseBonus));
  return coverage;
}

/** @deprecated use scoreCaseWeighted — kept for call-site clarity in tests */
export function scoreCase(queryTokens: string[], caseText: string): number {
  return scoreCaseWeighted(queryTokens, caseText);
}

function snippetFromCase(text: string, max = 700): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-") || l.startsWith("##"));
  const body = (lines.length > 0 ? lines.join("\n") : text).trim();
  return body.slice(0, max);
}

/**
 * Find other matters whose CASE.md overlaps the current instruction.
 * Skips the active matter. Soft-fails to [] on IO errors.
 */
export async function findSimilarCaseMemories(opts: {
  workspaceDir: string;
  instruction: string;
  currentMatterId?: string;
  limit?: number;
  minScore?: number;
}): Promise<SimilarCaseHit[]> {
  const queryTokens = tokenizeForRecall(opts.instruction);
  if (queryTokens.length === 0) {
    return [];
  }
  const limit = opts.limit ?? 3;
  const minScore = opts.minScore ?? 0.15;
  let matterIds: string[] = [];
  try {
    matterIds = await listMatterIds(opts.workspaceDir);
  } catch {
    return [];
  }
  const current = opts.currentMatterId?.trim();
  const hits: SimilarCaseHit[] = [];
  for (const matterId of matterIds) {
    if (current && matterId === current) {
      continue;
    }
    const rel = path.relative(opts.workspaceDir, caseFilePath(opts.workspaceDir, matterId));
    let text = "";
    try {
      const full = fs.readFileSync(caseFilePath(opts.workspaceDir, matterId), "utf8");
      // 评分只需前部结构化章节 + 有限尾部，避免超大 CASE 拖垮每轮召回
      text =
        full.length > PROMPT_WINDOW.similarCaseReadChars
          ? `${full.slice(0, Math.floor(PROMPT_WINDOW.similarCaseReadChars * 0.75))}\n${full.slice(-Math.floor(PROMPT_WINDOW.similarCaseReadChars * 0.25))}`
          : full;
    } catch {
      continue;
    }
    const score = scoreCaseWeighted(queryTokens, text);
    if (score < minScore) {
      continue;
    }
    hits.push({
      matterId,
      score,
      snippet: snippetFromCase(text),
      relativePath: rel.replace(/\\/g, "/"),
    });
  }
  hits.sort((a, b) => b.score - a.score || a.matterId.localeCompare(b.matterId));
  return hits.slice(0, limit);
}

export function formatSimilarCaseRecallBlock(hits: SimilarCaseHit[]): string | undefined {
  if (hits.length === 0) {
    return undefined;
  }
  const blocks: string[] = [
    "## 相关旧案经验（跨案件召回）",
    "以下为其他案件 CASE.md 中与本条指令相近的摘要。可对照争点与风险表述；事实以本案为准，勿张冠李戴。",
  ];
  for (const hit of hits) {
    blocks.push(
      `### 案件 ${hit.matterId}（相关度 ${(hit.score * 100).toFixed(0)}%）\n路径：\`${hit.relativePath}\`\n${hit.snippet}`,
    );
  }
  return blocks.join("\n\n");
}

/**
 * Recall@K helper for fixtures: fraction of queries where expectedMatterId is in top-K.
 */
export function recallAtK(
  rankings: Array<{ expectedMatterId: string; rankedIds: string[] }>,
  k: number,
): number {
  if (rankings.length === 0) {
    return 0;
  }
  let hits = 0;
  for (const row of rankings) {
    if (row.rankedIds.slice(0, k).includes(row.expectedMatterId)) {
      hits += 1;
    }
  }
  return hits / rankings.length;
}
