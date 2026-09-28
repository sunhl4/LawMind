/**
 * Write accepted before/after edits into a .docx as real Word revisions
 * (`w:del` / `w:ins`) when the original sentence sits in one text run.
 * This is the fallback the preview export uses if officecli does not apply.
 */

import fs from "node:fs/promises";
import JSZip from "jszip";
import { computeMinimalEditSpans } from "./minimal-edit-script.js";
import type { RedlineHunk } from "./redline-proposal.js";

export async function writeVisibleTrackedEdits(params: {
  sourceAbs: string;
  destAbs: string;
  hunks: readonly Pick<RedlineHunk, "before" | "after">[];
  author?: string;
}): Promise<{ applied: number; attempted: number }> {
  const attempted = params.hunks.filter(
    (hunk) => hunk.before !== hunk.after && hunk.before.trim(),
  ).length;
  const buffer = await fs.readFile(params.sourceAbs);
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  const xml = await file?.async("string");
  if (!xml) {
    return { applied: 0, attempted };
  }
  let next = xml;
  let applied = 0;
  let id = 1;
  const author = (params.author ?? "律师").replace(/[<>&"]/g, "").slice(0, 40) || "律师";
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const hunk of params.hunks) {
    if (!hunk.before.trim() || hunk.before === hunk.after) {
      continue;
    }
    const rewritten = rewriteUniqueTextRun(next, hunk.before, hunk.after, author, date, id);
    if (!rewritten) {
      continue;
    }
    next = rewritten.xml;
    id = rewritten.nextId;
    applied += 1;
  }
  if (applied === 0) {
    return { applied: 0, attempted };
  }
  zip.file("word/document.xml", next);
  const out = await zip.generateAsync({ type: "nodebuffer" });
  await fs.writeFile(params.destAbs, out);
  return { applied, attempted };
}

function rewriteUniqueTextRun(
  xml: string,
  before: string,
  after: string,
  author: string,
  date: string,
  id: number,
): { xml: string; nextId: number } | null {
  const runs = [...xml.matchAll(/<w:r\b[^>]*(?:\/>|>[\s\S]*?<\/w:r>)/g)];
  const hits: Array<{ run: string; index: number; text: string; open: string; inner: string }> = [];
  for (const match of runs) {
    const run = match[0] ?? "";
    if (run.endsWith("/>")) {
      continue;
    }
    const openEnd = run.indexOf(">");
    const close = run.lastIndexOf("</w:r>");
    if (openEnd < 0 || close < 0) {
      continue;
    }
    const inner = run.slice(openEnd + 1, close);
    const text = visibleRunText(inner);
    if (!text.includes(before)) {
      continue;
    }
    hits.push({ run, index: match.index ?? 0, text, open: run.slice(0, openEnd + 1), inner });
  }
  if (hits.length !== 1) {
    return null;
  }
  const hit = hits[0];
  if (!hit) {
    return null;
  }
  const at = hit.text.indexOf(before);
  if (at < 0 || hit.text.indexOf(before, at + before.length) >= 0) {
    return null;
  }
  const replaced = hit.text.slice(0, at) + after + hit.text.slice(at + before.length);
  const spans = computeMinimalEditSpans(hit.text, replaced);
  if (spans.length === 0) {
    return null;
  }
  const rPr = hit.inner.match(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>|<w:rPr\b[^>]*\/>/)?.[0] ?? "";
  const pieces: string[] = [];
  let cursor = 0;
  let nextId = id;
  for (const span of spans) {
    if (span.spanStart > cursor) {
      pieces.push(plainRun(rPr, hit.text.slice(cursor, span.spanStart)));
    }
    if (span.before) {
      pieces.push(revisionRun("del", rPr, span.before, author, date, nextId));
      nextId += 1;
    }
    if (span.after) {
      pieces.push(revisionRun("ins", rPr, span.after, author, date, nextId));
      nextId += 1;
    }
    cursor = span.spanEnd;
  }
  if (cursor < hit.text.length) {
    pieces.push(plainRun(rPr, hit.text.slice(cursor)));
  }
  const rewritten = pieces.join("");
  return {
    xml: xml.slice(0, hit.index) + rewritten + xml.slice(hit.index + hit.run.length),
    nextId,
  };
}

function visibleRunText(inner: string): string {
  const withoutCodes = inner
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<w:delInstrText\b[^>]*>[\s\S]*?<\/w:delInstrText>/g, "");
  let out = "";
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;
  for (const match of withoutCodes.matchAll(re)) {
    if (match[0].startsWith("<w:tab")) {
      out += "\t";
    } else if (match[0].startsWith("<w:br")) {
      out += "\n";
    } else {
      out += decodeXml(match[1] ?? "");
    }
  }
  return out;
}

function plainRun(rPr: string, text: string): string {
  if (!text) {
    return "";
  }
  return `<w:r>${rPr}${textNode("w:t", text)}</w:r>`;
}

function revisionRun(
  kind: "del" | "ins",
  rPr: string,
  text: string,
  author: string,
  date: string,
  id: number,
): string {
  const tag = kind === "del" ? "w:del" : "w:ins";
  const textTag = kind === "del" ? "w:delText" : "w:t";
  return `<${tag} w:id="${id}" w:author="${encodeXml(author)}" w:date="${date}"><w:r>${rPr}${textNode(textTag, text)}</w:r></${tag}>`;
}

function textNode(tag: string, text: string): string {
  const space = /^\s|\s$/u.test(text) ? ` xml:space="preserve"` : "";
  return `<${tag}${space}>${encodeXml(text)}</${tag}>`;
}

function encodeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
