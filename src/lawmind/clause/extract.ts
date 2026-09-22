/**
 * 核心提取器：从合同文本中抽取结构化条款。
 * 失败时降级为整段原文，不抛异常。
 */

import { CHINESE_INTEGER_PATTERN, parseChineseInteger } from "../lint/chinese-numeral.js";
import type { Clause, ClauseDoc, ClauseType, Reference, SourceRange } from "./ast.js";
import { defaultClausePatterns } from "./dsl.js";
import type { ClausePattern, ExtractCtx } from "./pattern.js";
import { extractCaptureBody, findFirstTrigger, matchesTrigger } from "./pattern.js";

/** 条号线：第 N 条 / 第中文N条。 */
const ARTICLE_LINE_RE = new RegExp(`^\\s*(第\\s*(\\d+|${CHINESE_INTEGER_PATTERN})\\s*条)(.*)$`);

/** 阿拉伯序号段落：1. / 1． */
const ARABIC_SECTION_RE = /^\s*(\d+)[.．]\s*(.*)$/;

/** 中文序号段落：一、 */
const CHINESE_SECTION_RE = /^\s*([一二三四五六七八九十百]+)[、,]\s*(.*)$/;

const LINE_TERMINATORS = /\r?\n/;

interface Boundary {
  id: string;
  articleNo?: number;
  startLine: number;
  startChar: number;
  /** 标题行之后的正文起始位置（下一行开头） */
  bodyStartChar: number;
  title: string;
}

function lineNumberOf(text: string, charIndex: number): number {
  let count = 1;
  for (let i = 0; i < charIndex && i < text.length; i += 1) {
    if (text[i] === "\n") {
      count += 1;
    }
  }
  return count;
}

function rangeFromOffsets(text: string, startChar: number, endChar: number): SourceRange {
  return {
    startLine: lineNumberOf(text, startChar),
    endLine: lineNumberOf(text, Math.max(0, endChar - 1)),
    startChar,
    endChar,
  };
}

function parseArticleNumber(raw: string): number | undefined {
  if (/^\d+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  const n = parseChineseInteger(raw);
  return Number.isFinite(n) ? n : undefined;
}

function findBoundaries(text: string): Boundary[] {
  const lines = text.split(LINE_TERMINATORS);
  const lineStarts: number[] = [];
  let pos = 0;
  for (const line of lines) {
    lineStarts.push(pos);
    pos += line.length + 1; // 保留换行符
  }

  const boundaries: Boundary[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }

    let articleNo: number | undefined;
    let title = "";
    let prefixLen = 0;

    const articleMatch = ARTICLE_LINE_RE.exec(line);
    if (articleMatch) {
      articleNo = parseArticleNumber(articleMatch[2] ?? "");
      title = (articleMatch[3] ?? "").trim();
      prefixLen = articleMatch[1]?.length ?? 0;
    } else {
      const arabicMatch = ARABIC_SECTION_RE.exec(line);
      if (arabicMatch) {
        articleNo = parseArticleNumber(arabicMatch[1] ?? "");
        title = (arabicMatch[2] ?? "").trim();
        prefixLen = arabicMatch[0]?.length ?? 0;
      } else {
        const chineseMatch = CHINESE_SECTION_RE.exec(line);
        if (chineseMatch) {
          articleNo = parseArticleNumber(chineseMatch[1] ?? "");
          title = (chineseMatch[2] ?? "").trim();
          prefixLen = chineseMatch[0]?.length ?? 0;
        }
      }
    }

    if (prefixLen === 0) {
      continue;
    }

    const startChar = lineStarts[i] ?? 0;
    const bodyStartChar = i + 1 < lines.length ? (lineStarts[i + 1] ?? text.length) : text.length;
    const id = articleNo !== undefined ? `article-${articleNo}` : `section-${i + 1}`;

    boundaries.push({
      id,
      articleNo,
      startLine: i + 1,
      startChar,
      bodyStartChar,
      title,
    });
  }

  return boundaries;
}

function classifyClause(title: string, body: string, patterns: ClausePattern[]): ClauseType {
  // 标题优先：标题通常直接表达条款类型（如「违约责任」）。
  for (const pattern of patterns) {
    if (matchesTrigger(title, pattern.triggers)) {
      return pattern.type;
    }
  }
  const combined = `${title}\n${body}`;
  for (const pattern of patterns) {
    if (matchesTrigger(combined, pattern.triggers)) {
      return pattern.type;
    }
  }
  return "general";
}

function createFallbackDoc(text: string): ClauseDoc {
  const range: SourceRange = {
    startLine: 1,
    endLine: Math.max(1, lineNumberOf(text, text.length)),
    startChar: 0,
    endChar: text.length,
  };
  const clause: Clause = {
    id: "clause-fallback",
    type: "general",
    title: "",
    body: text,
    children: [],
    sourceRange: range,
    definitionKeys: [],
    references: [],
  };
  return {
    text,
    clauses: [clause],
    definitions: new Map(),
    references: [],
  };
}

const DEFINITION_TERM_RE = /[「“"]([^」”"]{1,30})[」”"]\s*[（(]以下简称\s*([^）)]{0,30})[）)]?/g;

function extractDefinitionKeys(text: string): string[] {
  const keys = new Set<string>();
  for (const m of text.matchAll(DEFINITION_TERM_RE)) {
    const term = (m[1] ?? "").trim();
    const alias = (m[2] ?? "").trim();
    if (term) {
      keys.add(term);
    }
    if (alias) {
      keys.add(alias);
    }
  }
  return [...keys];
}

function previousArticleNo(clauses: Clause[], index: number): number | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const no = clauses[i]?.articleNo;
    if (no !== undefined) {
      return no;
    }
  }
  return undefined;
}

function extractReferencesForClause(
  clause: Clause,
  clauseIndex: number,
  clauses: Clause[],
  definitions: Map<string, Clause>,
  docText: string,
): Reference[] {
  const refs: Reference[] = [];
  const fullText = docText.slice(clause.sourceRange.startChar, clause.sourceRange.endChar + 1);
  if (!fullText) {
    return refs;
  }
  const baseOffset = clause.sourceRange.startChar;

  // 第 N 条引用。跳过本条款标题自身的条号（第一条匹配通常位于 fullText 开头）。
  const articleRe = new RegExp(`第\\s*(\\d+|${CHINESE_INTEGER_PATTERN})\\s*条`, "g");
  let articleMatchIndex = 0;
  for (const m of fullText.matchAll(articleRe)) {
    articleMatchIndex += 1;
    const raw = m[1] ?? "";
    const n = parseArticleNumber(raw);
    if (n !== undefined && !(articleMatchIndex === 1 && (m.index ?? 0) === 0)) {
      const start = baseOffset + (m.index ?? 0);
      const end = start + (m[0]?.length ?? 0);
      refs.push({
        kind: "article",
        target: String(n),
        clauseId: clause.id,
        text: m[0] ?? "",
        sourceRange: rangeFromOffsets(docText, start, end),
      });
    }
  }

  // 前款 / 上一条 / 前条
  const previousNo = previousArticleNo(clauses, clauseIndex);
  for (const m of fullText.matchAll(/前款|上一条|前条/g)) {
    const start = baseOffset + (m.index ?? 0);
    const end = start + (m[0]?.length ?? 0);
    refs.push({
      kind: "previous",
      target: previousNo !== undefined ? String(previousNo) : "previous",
      clauseId: clause.id,
      text: m[0] ?? "",
      sourceRange: rangeFromOffsets(docText, start, end),
    });
  }

  // 定义术语引用：在其他条款中再次出现的定义 key
  for (const [key] of definitions) {
    if (clause.definitionKeys?.includes(key)) {
      continue; // 自己定义自己不算引用
    }
    let index = fullText.indexOf(key);
    while (index >= 0) {
      const start = baseOffset + index;
      const end = start + key.length;
      refs.push({
        kind: "term",
        target: key,
        clauseId: clause.id,
        text: key,
        sourceRange: rangeFromOffsets(docText, start, end),
      });
      index = fullText.indexOf(key, index + key.length);
    }
  }

  return refs;
}

function extractChildren(
  clause: Clause,
  pattern: ClausePattern | undefined,
  patterns: ClausePattern[],
  docText: string,
): Clause[] {
  if (!pattern?.children) {
    return [];
  }
  const fullText = docText.slice(clause.sourceRange.startChar, clause.sourceRange.endChar + 1);
  if (!fullText) {
    return [];
  }
  const baseOffset = clause.sourceRange.startChar;
  const children: Clause[] = [];
  for (let i = 0; i < pattern.children.length; i += 1) {
    const child = pattern.children[i];
    if (!child) {
      continue;
    }
    const hit = findFirstTrigger(fullText, child.triggers);
    if (!hit) {
      continue;
    }
    const body = extractCaptureBody(fullText.slice(hit.index), child.capture);
    const startChar = baseOffset + hit.index;
    const endChar = startChar + body.length;
    const ctx: ExtractCtx = {
      docText,
      lineOffset: lineNumberOf(docText, startChar),
      charOffset: startChar,
      parent: clause,
      patterns,
    };
    const extracted = child.extractor ? child.extractor(body, ctx) : {};
    children.push({
      id: `${clause.id}-child-${child.name}-${i}`,
      type: extracted?.type ?? child.type,
      title: extracted?.title ?? child.name,
      body: extracted?.body ?? body,
      children: extracted?.children ?? [],
      sourceRange: rangeFromOffsets(docText, startChar, endChar),
      definitionKeys: extracted?.definitionKeys ?? [],
      references: extracted?.references ?? [],
    });
  }
  return children;
}

/** 从合同文本中提取结构化条款。 */
export function extractClauses(
  docText: string,
  patterns: ClausePattern[] = defaultClausePatterns(),
): ClauseDoc {
  const text = docText ?? "";
  if (!text.trim()) {
    return createFallbackDoc(text);
  }

  const boundaries = findBoundaries(text);
  if (boundaries.length === 0) {
    return createFallbackDoc(text);
  }

  // 计算每个边界终点（以下一个边界 startChar 为界）
  const endChars: number[] = [];
  for (let i = 0; i < boundaries.length; i += 1) {
    const next = boundaries[i + 1];
    endChars.push(next !== undefined ? next.startChar - 1 : text.length);
  }

  const clauses: Clause[] = [];
  for (let i = 0; i < boundaries.length; i += 1) {
    const b = boundaries[i];
    if (!b) {
      continue;
    }
    const endChar = endChars[i] ?? text.length;
    const body = text.slice(b.bodyStartChar, endChar + 1);
    const type = classifyClause(b.title, body, patterns);
    clauses.push({
      id: b.id,
      type,
      title: b.title,
      body,
      children: [],
      sourceRange: {
        startLine: b.startLine,
        endLine: lineNumberOf(text, Math.max(0, endChar - 1)),
        startChar: b.startChar,
        endChar,
      },
      articleNo: b.articleNo,
      definitionKeys: [],
      references: [],
    });
  }

  // 第一轮：提取子条款与定义 key（使用完整条款文本，避免标题行遗漏）
  for (const clause of clauses) {
    const pattern = patterns.find((p) => p.type === clause.type);
    const fullText = text.slice(clause.sourceRange.startChar, clause.sourceRange.endChar + 1);
    clause.children = extractChildren(clause, pattern, patterns, text);
    clause.definitionKeys = extractDefinitionKeys(fullText);
  }

  // 构建定义表
  const definitions = new Map<string, Clause>();
  for (const clause of clauses) {
    for (const key of clause.definitionKeys ?? []) {
      if (!definitions.has(key)) {
        definitions.set(key, clause);
      }
    }
  }

  // 第二轮：提取引用
  const references: Reference[] = [];
  for (let i = 0; i < clauses.length; i += 1) {
    const clause = clauses[i];
    if (!clause) {
      continue;
    }
    clause.references = extractReferencesForClause(clause, i, clauses, definitions, text);
    references.push(...clause.references);
  }

  return {
    text,
    clauses,
    definitions,
    references,
  };
}
