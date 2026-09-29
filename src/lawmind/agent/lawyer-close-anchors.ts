/**
 * 把本轮工具已经返回的原文地址、稿件编号嵌进模型写好的句子。
 * 只替换条款名或文书标题这几个字，不改前后的话，也不再叫模型改写。
 */

import { isDraftTaskId, statuteJumpUrl } from "../sources/lawyer-chat-link.js";
import type { AgentMessage } from "./types.js";

export type StatuteAnchor = {
  url: string;
  blob: string;
};

export type RetrievedAnchors = {
  statutes: StatuteAnchor[];
  drafts: Array<{ title: string; taskId: string }>;
};

const EMPTY: RetrievedAnchors = { statutes: [], drafts: [] };

const STATUTE_RE = /《([^》\n]{2,40})》\s*第\s*([0-9０-９零一二三四五六七八九十百千]{1,8})\s*条/g;
const SKIP_RE = /\[[^\]\n]{1,200}\]\([^)\n\s]+\)|```[\s\S]*?```/g;

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

export function parseArticleNumber(raw: string): number | null {
  const digits = raw.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  );
  if (/^\d+$/.test(digits)) {
    const n = Number(digits);
    return n > 0 && n < 10_000 ? n : null;
  }
  let total = 0;
  let current = 0;
  let saw = false;
  for (const ch of digits) {
    if (ch in CN_DIGIT) {
      current = CN_DIGIT[ch] ?? 0;
      saw = true;
      continue;
    }
    const unit = ch === "千" ? 1000 : ch === "百" ? 100 : ch === "十" ? 10 : 0;
    if (!unit) {
      return null;
    }
    total += (current || 1) * unit;
    current = 0;
    saw = true;
  }
  if (!saw) {
    return null;
  }
  const n = total + current;
  return n > 0 && n < 10_000 ? n : null;
}

function normLaw(name: string): string {
  return name.replace(/中华人民共和国/g, "").replace(/\s+/g, "");
}

function hitMatches(blob: string, law: string, articleNo: number): boolean {
  const compact = blob.replace(/\s+/g, "");
  const lawKey = normLaw(law);
  if (lawKey.length < 2 || !normLaw(compact).includes(lawKey)) {
    return false;
  }
  for (const match of compact.matchAll(/第([0-9０-９零一二三四五六七八九十百千]{1,8})条/g)) {
    if (parseArticleNumber(match[1] ?? "") === articleNo) {
      return true;
    }
  }
  return false;
}

function uniqueStatuteUrl(
  anchors: RetrievedAnchors,
  law: string,
  articleNo: number,
  label: string,
): string | null {
  const urls = new Set<string>();
  for (const hit of anchors.statutes) {
    if (!hitMatches(hit.blob, law, articleNo)) {
      continue;
    }
    const safe = statuteJumpUrl(hit.url, label);
    if (safe) {
      urls.add(safe);
    }
  }
  return urls.size === 1 ? ([...urls][0] ?? null) : null;
}

function spliceStatutes(text: string, anchors: RetrievedAnchors): string {
  const re = new RegExp(STATUTE_RE.source, "g");
  return text.replace(re, (full, law: string, articleRaw: string) => {
    const articleNo = parseArticleNumber(articleRaw);
    if (!articleNo) {
      return full;
    }
    const label = full.replace(/\s+/g, "");
    const url = uniqueStatuteUrl(anchors, law, articleNo, label);
    return url ? `[${label}](${url})` : full;
  });
}

function spliceDraftTitles(text: string, anchors: RetrievedAnchors): string {
  const titles = [...anchors.drafts].toSorted((a, b) => b.title.length - a.title.length);
  let next = text;
  for (const draft of titles) {
    if (!next.includes(draft.title)) {
      continue;
    }
    let out = "";
    let index = 0;
    while (index < next.length) {
      const linkEnd = markdownLinkEnd(next, index);
      if (linkEnd > index) {
        out += next.slice(index, linkEnd);
        index = linkEnd;
        continue;
      }
      if (next.startsWith(draft.title, index)) {
        out += `[${draft.title}](lm-draft:${draft.taskId})`;
        index += draft.title.length;
        continue;
      }
      out += next[index];
      index += 1;
    }
    next = out;
  }
  return next;
}

function markdownLinkEnd(text: string, index: number): number {
  if (text[index] !== "[") {
    return index;
  }
  const labelEnd = text.indexOf("](", index + 1);
  if (labelEnd < 0) {
    return index;
  }
  const hrefEnd = text.indexOf(")", labelEnd + 2);
  if (hrefEnd < 0) {
    return index;
  }
  return hrefEnd + 1;
}

function splicePlain(text: string, anchors: RetrievedAnchors): string {
  return spliceDraftTitles(spliceStatutes(text, anchors), anchors);
}

/** 已是链接或代码块的部分不动。 */
export function spliceRetrievedAnchors(text: string, anchors: RetrievedAnchors): string {
  if (anchors.statutes.length === 0 && anchors.drafts.length === 0) {
    return text;
  }
  let out = "";
  let last = 0;
  for (const match of text.matchAll(SKIP_RE)) {
    const index = match.index ?? 0;
    out += splicePlain(text.slice(last, index), anchors);
    out += match[0];
    last = index + match[0].length;
  }
  out += splicePlain(text.slice(last), anchors);
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function harvest(
  value: unknown,
  into: RetrievedAnchors,
  drafts: Map<string, string | null>,
  depth: number,
): void {
  if (depth > 6) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      harvest(item, into, drafts, depth + 1);
    }
    return;
  }
  const rec = asRecord(value);
  if (!rec) {
    return;
  }
  const url = typeof rec.url === "string" ? rec.url.trim() : "";
  const title = typeof rec.title === "string" ? rec.title.trim() : "";
  const citation = typeof rec.citation === "string" ? rec.citation.trim() : "";
  const snippet = typeof rec.snippet === "string" ? rec.snippet.trim() : "";
  if (url.startsWith("https://") && (title || citation || snippet)) {
    into.statutes.push({ url, blob: [title, citation, snippet].filter(Boolean).join("\n") });
  }
  const taskId = typeof rec.taskId === "string" ? rec.taskId.trim() : "";
  if (
    title.length >= 4 &&
    title.length <= 80 &&
    taskId !== "chat-authority-search" &&
    isDraftTaskId(taskId)
  ) {
    const prev = drafts.get(title);
    drafts.set(title, prev === undefined || prev === taskId ? taskId : null);
  }
  for (const child of Object.values(rec)) {
    if (child && typeof child === "object") {
      harvest(child, into, drafts, depth + 1);
    }
  }
}

/** 从本轮工具结果收集可嵌的地址和稿件。同一标题对上两个编号时不嵌。 */
export function collectRetrievedAnchors(messages: readonly AgentMessage[]): RetrievedAnchors {
  const into: RetrievedAnchors = { statutes: [], drafts: [] };
  const drafts = new Map<string, string | null>();
  for (const msg of messages) {
    if (msg.role !== "tool") {
      continue;
    }
    for (const resp of msg.toolCallResponses ?? []) {
      if (!resp.result.ok) {
        continue;
      }
      harvest(resp.result.data, into, drafts, 0);
    }
  }
  for (const [title, taskId] of drafts) {
    if (taskId) {
      into.drafts.push({ title, taskId });
    }
  }
  return into.statutes.length === 0 && into.drafts.length === 0 ? EMPTY : into;
}
