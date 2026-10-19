/**
 * PowerPoint UI preview payload for the desktop middle column.
 * Reads .pptx OOXML (JSZip) and returns ordered slides with title/body text
 * for reading — not a full WYSIWYG renderer.
 */

import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { ensureLocalFile } from "../../../runtime/icloud-materialize.js";

export const MAX_PPTX_READ_BYTES = 40 * 1024 * 1024;
export const MAX_PPTX_SLIDES = 80;
export const MAX_PPTX_BLOCKS_PER_SLIDE = 48;
export const MAX_PPTX_CHARS_PER_BLOCK = 2_000;

export type PptxPreviewBlock = {
  role: "title" | "subtitle" | "body" | "notes";
  text: string;
};

export type PptxPreviewSlide = {
  index: number;
  /** 1-based label for the rail. */
  label: string;
  blocks: PptxPreviewBlock[];
  /** True when this slide hit the block or char cap. */
  truncated: boolean;
};

export type LoadedPptxPreview = {
  slides: PptxPreviewSlide[];
  truncatedSlides: boolean;
  slideWidthEmu?: number;
  slideHeightEmu?: number;
};

export async function loadPptxUiPreview(absPath: string): Promise<LoadedPptxPreview> {
  const resolved = path.resolve(absPath);
  await ensureLocalFile(resolved);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new Error("not_a_file");
  }
  if (stat.size > MAX_PPTX_READ_BYTES) {
    throw new Error("pptx_too_large");
  }
  const buf = await fs.readFile(resolved);
  return parsePptxPreviewBuffer(buf);
}

export async function parsePptxPreviewBuffer(buf: Buffer | Uint8Array): Promise<LoadedPptxPreview> {
  const zip = await JSZip.loadAsync(buf);
  const presentationXml = await readZipText(zip, "ppt/presentation.xml");
  if (!presentationXml) {
    throw new Error("missing_presentation");
  }
  const relsXml = await readZipText(zip, "ppt/_rels/presentation.xml.rels");
  const slideTargets = resolveSlideTargets(presentationXml, relsXml);
  if (slideTargets.length === 0) {
    // Fallback: numbered slideN.xml in archive order.
    const fallback = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .toSorted((a, b) => slideNumber(a) - slideNumber(b));
    slideTargets.push(...fallback.map((t) => normalizeZipPath(t)));
  }
  const truncatedSlides = slideTargets.length > MAX_PPTX_SLIDES;
  const targets = truncatedSlides ? slideTargets.slice(0, MAX_PPTX_SLIDES) : slideTargets;
  const size = parseSlideSize(presentationXml);
  const slides: PptxPreviewSlide[] = [];
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    if (!target) {
      continue;
    }
    const slideXml = await readZipText(zip, target);
    if (!slideXml) {
      slides.push({
        index: i,
        label: String(i + 1),
        blocks: [{ role: "body", text: "（无法读取此页）" }],
        truncated: false,
      });
      continue;
    }
    const blocks = extractSlideBlocks(slideXml);
    const notesPath = await resolveNotesPath(zip, target);
    if (notesPath) {
      const notesXml = await readZipText(zip, notesPath);
      if (notesXml) {
        const noteText = extractNotesBodyText(notesXml).trim();
        if (noteText) {
          blocks.push({
            role: "notes",
            text: clipBlock(noteText),
          });
        }
      }
    }
    const truncated = blocks.length >= MAX_PPTX_BLOCKS_PER_SLIDE;
    slides.push({
      index: i,
      label: String(i + 1),
      blocks: blocks.length > 0 ? blocks : [{ role: "body", text: "（本页无可抽取文字）" }],
      truncated,
    });
  }
  return {
    slides,
    truncatedSlides,
    ...(size.slideWidthEmu ? { slideWidthEmu: size.slideWidthEmu } : {}),
    ...(size.slideHeightEmu ? { slideHeightEmu: size.slideHeightEmu } : {}),
  };
}

function resolveSlideTargets(presentationXml: string, relsXml: string | undefined): string[] {
  const ridOrder: string[] = [];
  for (const m of presentationXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    if (m[1]) {
      ridOrder.push(m[1]);
    }
  }
  if (ridOrder.length === 0 || !relsXml) {
    return [];
  }
  const ridToTarget = new Map<string, string>();
  for (const m of relsXml.matchAll(
    /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?>/g,
  )) {
    const id = m[1];
    const target = m[2];
    if (id && target && /slides\/slide\d+\.xml/i.test(target)) {
      ridToTarget.set(id, normalizeZipPath(`ppt/${target.replace(/^\.\//, "")}`));
    }
  }
  // Also accept Target first, Id second attribute order.
  for (const m of relsXml.matchAll(
    /<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"[^>]*\/?>/g,
  )) {
    const target = m[1];
    const id = m[2];
    if (id && target && /slides\/slide\d+\.xml/i.test(target) && !ridToTarget.has(id)) {
      ridToTarget.set(id, normalizeZipPath(`ppt/${target.replace(/^\.\//, "")}`));
    }
  }
  const out: string[] = [];
  for (const rid of ridOrder) {
    const target = ridToTarget.get(rid);
    if (target) {
      out.push(target);
    }
  }
  return out;
}

async function resolveNotesPath(zip: JSZip, slidePath: string): Promise<string | undefined> {
  const base = slidePath.replace(/^ppt\//, "");
  const relsPath = `ppt/slides/_rels/${path.posix.basename(base)}.rels`;
  const rels = await readZipText(zip, relsPath);
  if (!rels) {
    return undefined;
  }
  const m =
    rels.match(/Target="([^"]*notesSlides\/notesSlide\d+\.xml)"/i) ??
    rels.match(/Target="(\.\.\/notesSlides\/notesSlide\d+\.xml)"/i);
  if (!m?.[1]) {
    return undefined;
  }
  const target = m[1].replace(/^\.\.\//, "").replace(/^\.\//, "");
  if (target.startsWith("notesSlides/")) {
    return normalizeZipPath(`ppt/${target}`);
  }
  if (target.startsWith("ppt/")) {
    return normalizeZipPath(target);
  }
  return normalizeZipPath(`ppt/slides/${target}`);
}

function extractSlideBlocks(slideXml: string): PptxPreviewBlock[] {
  const blocks: PptxPreviewBlock[] = [];
  // Shapes keep title/body roles; graphicFrame covers tables that are not p:sp.
  const shapes = [...slideXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((m) => m[0] ?? "");
  const frames = [...slideXml.matchAll(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)].map(
    (m) => m[0] ?? "",
  );
  const sources = shapes.length + frames.length > 0 ? [...shapes, ...frames] : [slideXml];
  for (const source of sources) {
    if (blocks.length >= MAX_PPTX_BLOCKS_PER_SLIDE) {
      break;
    }
    const role = placeholderRole(source);
    const paras = extractParagraphs(source);
    for (const para of paras) {
      if (blocks.length >= MAX_PPTX_BLOCKS_PER_SLIDE) {
        break;
      }
      const text = clipBlock(para);
      if (!text) {
        continue;
      }
      blocks.push({ role, text });
      // Only the first para of a title/subtitle shape keeps that role.
      if (role === "title" || role === "subtitle") {
        break;
      }
    }
  }
  return blocks;
}

/** Notes slides also embed a slide-number field; only keep the notes body placeholder. */
function extractNotesBodyText(notesXml: string): string {
  const shapes = [...notesXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((m) => m[0] ?? "");
  const bodyShapes = shapes.filter((shape) => /<p:ph\b[^>]*\btype="body"/i.test(shape));
  const sources = bodyShapes.length > 0 ? bodyShapes : shapes;
  const lines: string[] = [];
  for (const source of sources) {
    for (const para of extractParagraphs(source)) {
      const trimmed = para.trim();
      // Drop lone slide-number placeholders.
      if (!trimmed || /^\d{1,3}$/.test(trimmed)) {
        continue;
      }
      lines.push(trimmed);
    }
  }
  return lines.join("\n");
}

function placeholderRole(shapeXml: string): PptxPreviewBlock["role"] {
  const ph = shapeXml.match(/<p:ph\b[^>]*>/)?.[0] ?? "";
  const type = ph.match(/\btype="([^"]+)"/)?.[1]?.toLowerCase() ?? "";
  if (type === "title" || type === "ctrtitle") {
    return "title";
  }
  if (type === "subtitle") {
    return "subtitle";
  }
  return "body";
}

function extractParagraphs(xml: string): string[] {
  const paras: string[] = [];
  for (const m of xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
    const chunk = m[0] ?? "";
    const parts: string[] = [];
    for (const t of chunk.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)) {
      parts.push(decodeXml(t[1] ?? ""));
    }
    const line = parts.join("").replace(/\s+/g, " ").trim();
    if (line) {
      paras.push(line);
    }
  }
  if (paras.length === 0) {
    const flat = extractPlainText(xml).trim();
    if (flat) {
      paras.push(flat);
    }
  }
  return paras;
}

function extractPlainText(xml: string): string {
  const parts: string[] = [];
  for (const m of xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)) {
    parts.push(decodeXml(m[1] ?? ""));
  }
  return parts.join("").replace(/\s+/g, " ");
}

function parseSlideSize(presentationXml: string): {
  slideWidthEmu?: number;
  slideHeightEmu?: number;
} {
  const tag = presentationXml.match(/<p:sldSz\b[^>]*\/?>/)?.[0] ?? "";
  const cx = Number(tag.match(/\bcx="(\d+)"/)?.[1]);
  const cy = Number(tag.match(/\bcy="(\d+)"/)?.[1]);
  return {
    ...(Number.isFinite(cx) && cx > 0 ? { slideWidthEmu: cx } : {}),
    ...(Number.isFinite(cy) && cy > 0 ? { slideHeightEmu: cy } : {}),
  };
}

function clipBlock(text: string): string {
  if (text.length <= MAX_PPTX_CHARS_PER_BLOCK) {
    return text;
  }
  return `${text.slice(0, MAX_PPTX_CHARS_PER_BLOCK)}…`;
}

function decodeXml(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeZipPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
}

async function readZipText(zip: JSZip, entryPath: string): Promise<string | undefined> {
  const normalized = normalizeZipPath(entryPath);
  const file =
    zip.file(normalized) ??
    zip.file(normalized.replace(/^ppt\//, "")) ??
    Object.values(zip.files).find(
      (f) => !f.dir && normalizeZipPath(f.name).toLowerCase() === normalized.toLowerCase(),
    );
  if (!file || file.dir) {
    return undefined;
  }
  return file.async("string");
}
