/**
 * Template structure for the draft skeleton.
 *
 * Builtin Word variants contribute their column headings. A .docx contributes
 * only paragraphs that are heading styles, outline levels, or short Chinese
 * heading numbers. Body sentences are not nodes. Headings stay editable.
 */

import { skeletonFromLevels, type SkeletonNode } from "./skeleton-tree.js";

const HEADING_CHAR_CAP = 40;

const CHINESE_H1 = /^[一二三四五六七八九十百]+、/;
const CHINESE_H2 = /^[（(][一二三四五六七八九十\d]+[）)]/;
const CHINESE_H3 = /^\d+、/;

export function chineseHeadingLevel(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > HEADING_CHAR_CAP) {
    return undefined;
  }
  if (trimmed === "免责声明" || CHINESE_H1.test(trimmed)) {
    return 1;
  }
  if (CHINESE_H2.test(trimmed)) {
    return 2;
  }
  if (CHINESE_H3.test(trimmed)) {
    return 3;
  }
  return undefined;
}

function decodeXml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function styleHeadingLevel(styleId: string): number | undefined {
  const match = /^(?:Heading|heading|标题)\s*([1-3])$/.exec(styleId.trim());
  if (!match?.[1]) {
    return undefined;
  }
  return Number(match[1]);
}

/** Heading forest from word/document.xml. Body paragraphs are omitted. */
export function parseOoxmlHeadingForest(documentXml: string): SkeletonNode[] {
  const rows: Array<{ level: number; text: string }> = [];
  for (const chunk of documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []) {
    const text = [...chunk.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)]
      .map((match) => decodeXml(match[1] ?? ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text.length > HEADING_CHAR_CAP) {
      continue;
    }
    const outline = /<w:outlineLvl\b[^>]*w:val="(\d+)"/.exec(chunk);
    const styleId = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(chunk)?.[1] ?? "";
    const level = outline?.[1]
      ? Number(outline[1]) + 1
      : (styleHeadingLevel(styleId) ?? chineseHeadingLevel(text));
    if (level === undefined || !Number.isFinite(level)) {
      continue;
    }
    rows.push({ level, text: text.slice(0, HEADING_CHAR_CAP) });
    if (rows.length >= 24) {
      break;
    }
  }
  return skeletonFromLevels(rows);
}

const BUILTIN_HEADINGS: Record<string, readonly string[]> = {
  complaint: ["当事人", "诉讼请求", "事实与理由"],
  "word/legal-memo-default": ["致", "自", "日期", "事由", "保密", "一、结论", "免责声明"],
  "word/research-report-default": ["目录", "一、调研结论", "免责声明"],
  "word/contract-default": ["一、一句话结论"],
  "word/demand-letter-default": ["一、委托说明"],
};

/** Column headings the builtin renderer already emits. Empty for unknown ids. */
export function builtinTemplateHeadings(templateId: string): string[] {
  const id = templateId.trim();
  return [...(BUILTIN_HEADINGS[id] ?? [])];
}

/** Explicit templateId= / template_id= only. Utterance keywords do not choose a template. */
export function explicitTemplateId(instruction: string): string | undefined {
  const match = /(?:templateId|template_id)\s*[=:]\s*[`"']?([A-Za-z0-9./_-]+)/.exec(instruction);
  const id = match?.[1]?.trim();
  if (!id) {
    return undefined;
  }
  if (id === "complaint" || id.includes("complaint-master")) {
    return "complaint";
  }
  if (BUILTIN_HEADINGS[id] || /^(?:word|ppt|upload)\//.test(id)) {
    return id;
  }
  return undefined;
}
