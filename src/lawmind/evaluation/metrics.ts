/**
 * Phase B：从草稿 + 检索快照 + 推理图谱计算质量指标。
 */

import type { ArtifactDraft, LegalReasoningGraph, ResearchBundle } from "../types.js";

function draftFullText(draft: ArtifactDraft): string {
  return [draft.title, draft.summary, ...draft.sections.map((s) => `${s.heading}\n${s.body}`)]
    .join("\n")
    .toLowerCase();
}

/**
 * 引用有效率：草稿中出现在 bundle.sources 内的引用 ID 数 / 草稿总引用数。
 * 无引用时返回 null。
 */
export function computeCitationValidityRate(
  draft: ArtifactDraft,
  bundle: ResearchBundle,
): number | null {
  const sourceIds = new Set(bundle.sources.map((s) => s.id));
  let total = 0;
  let valid = 0;
  for (const sec of draft.sections) {
    for (const raw of sec.citations ?? []) {
      const id = String(raw).trim();
      if (!id) {
        continue;
      }
      total += 1;
      if (sourceIds.has(id)) {
        valid += 1;
      }
    }
  }
  if (total === 0) {
    return null;
  }
  return Math.round((valid / total) * 1000) / 1000;
}

function tokenizeRiskFlag(flag: string): string[] {
  return flag
    .split(/[\s；，。、：:!?]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2)
    .slice(0, 12);
}

/** 判断检索风险条是否在草稿中有表述（整句、分词或至少二字连续命中）。 */
function riskFlagTouchesDraft(flag: string, draftLower: string): boolean {
  const flagLower = flag.toLowerCase();
  if (draftLower.includes(flagLower)) {
    return true;
  }
  for (const t of tokenizeRiskFlag(flag)) {
    if (draftLower.includes(t)) {
      return true;
    }
  }
  // 中文等无空格：任意相邻二字在正文中出现即视为命中
  for (let i = 0; i + 2 <= flagLower.length; i++) {
    const bigram = flagLower.slice(i, i + 2);
    if (draftLower.includes(bigram)) {
      return true;
    }
  }
  return false;
}

/**
 * 风险召回：每条 bundle.riskFlags 是否在草稿正文中有可匹配的片段（分词命中）。
 * 无 riskFlags 时返回 null。
 */
export function computeRiskRecallRate(draft: ArtifactDraft, bundle: ResearchBundle): number | null {
  if (bundle.riskFlags.length === 0) {
    return null;
  }
  const text = draftFullText(draft);
  let hits = 0;
  for (const flag of bundle.riskFlags) {
    if (riskFlagTouchesDraft(flag, text)) {
      hits += 1;
    }
  }
  return Math.round((hits / bundle.riskFlags.length) * 1000) / 1000;
}

function issueProbeText(issueLine: string): string {
  const stripped = issueLine.replace(/^争点\s*\d+\s*[：:]\s*/, "").trim();
  return stripped.slice(0, 40).toLowerCase();
}

/**
 * 争点覆盖率：推理图谱中每个争点是否在草稿中有语义片段命中（前缀/关键词重叠）。
 * 无 issueTree 或为空时返回 null。
 */
export function computeIssueCoverageRate(
  draft: ArtifactDraft,
  graph: LegalReasoningGraph,
): number | null {
  if (graph.issueTree.length === 0) {
    return null;
  }
  const text = draftFullText(draft);
  let covered = 0;
  for (const node of graph.issueTree) {
    const probe = issueProbeText(node.issue);
    if (probe.length < 4) {
      continue;
    }
    if (text.includes(probe)) {
      covered += 1;
      continue;
    }
    const words = probe.split(/\s+/).filter((w) => w.length >= 4);
    if (words.some((w) => text.includes(w))) {
      covered += 1;
    }
  }
  return Math.round((covered / graph.issueTree.length) * 1000) / 1000;
}
