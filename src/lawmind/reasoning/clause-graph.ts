/**
 * 条款图：把文书拆成条款，逐条标风险 / 缺项，再汇成一张图。
 * 规则先行；模型 critic 只在这张图上加意见，不改写正文。
 */

import type { ArtifactDraft } from "../types.js";

export type ClauseKind = "article" | "heading" | "paragraph";

export type ClauseNode = {
  id: string;
  heading: string;
  body: string;
  kind: ClauseKind;
  risks: string[];
  missing: string[];
};

export type ClauseGraph = {
  taskId: string;
  clauses: ClauseNode[];
  riskCount: number;
  missingCount: number;
  builtAt: string;
};

const ARTICLE_SPLIT = /(?=第[一二三四五六七八九十百千0-9]+条)/g;
const RISK_HINTS = ["违约", "赔偿", "解除", "管辖", "仲裁", "不可抗力", "保密", "违约金"];

function classifyKind(heading: string): ClauseKind {
  if (/第[一二三四五六七八九十百千0-9]+条/.test(heading)) {
    return "article";
  }
  if (heading.trim()) {
    return "heading";
  }
  return "paragraph";
}

function analyzeClause(heading: string, body: string): { risks: string[]; missing: string[] } {
  const text = `${heading}\n${body}`;
  const risks = RISK_HINTS.filter((hint) => text.includes(hint));
  const missing: string[] = [];
  if (!body.trim()) {
    missing.push("条款正文为空");
  }
  if (/【待补充|【收函对象|【出租人|【甲方/.test(text)) {
    missing.push("仍有骨架占位");
  }
  if (/应当|必须/.test(body) && !/否则|违约|责任/.test(body)) {
    missing.push("有义务表述，但未写后果");
  }
  return { risks, missing };
}

export function splitClauseText(text: string, headingFallback = ""): ClauseNode[] {
  const raw = text.replace(/\r\n/g, "\n").trim();
  if (!raw) {
    return [];
  }
  const chunks =
    raw.includes("第") && /第[一二三四五六七八九十百千0-9]+条/.test(raw)
      ? raw
          .split(ARTICLE_SPLIT)
          .map((part) => part.trim())
          .filter(Boolean)
      : [raw];
  return chunks.map((chunk, idx) => {
    const firstLine = chunk.split("\n")[0]?.trim() ?? "";
    const heading = /第[一二三四五六七八九十百千0-9]+条/.test(firstLine)
      ? firstLine.slice(0, 40)
      : headingFallback || `段落 ${idx + 1}`;
    const body = /第[一二三四五六七八九十百千0-9]+条/.test(firstLine)
      ? chunk.slice(firstLine.length).trim()
      : chunk;
    const { risks, missing } = analyzeClause(heading, body);
    return {
      id: `c${idx + 1}`,
      heading,
      body,
      kind: classifyKind(heading),
      risks,
      missing,
    };
  });
}

export function buildClauseGraphFromDraft(draft: ArtifactDraft): ClauseGraph {
  const clauses: ClauseNode[] = [];
  for (const section of draft.sections) {
    const split = splitClauseText(section.body, section.heading);
    if (split.length > 0) {
      clauses.push(...split);
      continue;
    }
    const { risks, missing } = analyzeClause(section.heading, section.body);
    clauses.push({
      id: `s${clauses.length + 1}`,
      heading: section.heading,
      body: section.body,
      kind: classifyKind(section.heading),
      risks,
      missing,
    });
  }
  const numbered = clauses.map((clause, idx) => ({ ...clause, id: `c${idx + 1}` }));
  return {
    taskId: draft.taskId,
    clauses: numbered,
    riskCount: numbered.reduce((sum, clause) => sum + clause.risks.length, 0),
    missingCount: numbered.reduce((sum, clause) => sum + clause.missing.length, 0),
    builtAt: new Date().toISOString(),
  };
}

export function clauseGraphRiskNotes(graph: ClauseGraph): string[] {
  const notes: string[] = [];
  for (const clause of graph.clauses) {
    if (clause.missing.length > 0) {
      notes.push(`${clause.heading}：${clause.missing.join("；")}`);
    }
  }
  return notes.slice(0, 12);
}
