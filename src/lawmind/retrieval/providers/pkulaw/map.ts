/**
 * Map北大法宝-style / LawMind shim JSON into AuthorityHit[].
 * Supports:
 * - LawMind generic: { hits|items: AuthorityHit[] }
 * - Shim list: { data: { list: [...] } } or { result: [...] }
 * - MCP tools/call content JSON string with hits
 */

import type { AuthorityHit } from "../../authority-hits.js";

function asHit(raw: unknown): AuthorityHit | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const title =
    (typeof o.title === "string" && o.title) ||
    (typeof o.name === "string" && o.name) ||
    (typeof o.lawTitle === "string" && o.lawTitle) ||
    (typeof o.caseName === "string" && o.caseName) ||
    "";
  if (!title.trim()) {
    return null;
  }
  const kindRaw = typeof o.kind === "string" ? o.kind : typeof o.type === "string" ? o.type : "";
  let kind: AuthorityHit["kind"] = "other";
  if (/statute|law|法规|法条/i.test(kindRaw)) {
    kind = "statute";
  } else if (/case|案例|判决/i.test(kindRaw)) {
    kind = "case";
  } else if (/reg|规章/i.test(kindRaw)) {
    kind = "regulation";
  }
  return {
    id: typeof o.id === "string" ? o.id : typeof o.docId === "string" ? o.docId : undefined,
    title: title.trim(),
    kind,
    citation:
      typeof o.citation === "string"
        ? o.citation
        : typeof o.fullName === "string"
          ? o.fullName
          : undefined,
    excerpt:
      typeof o.excerpt === "string"
        ? o.excerpt
        : typeof o.summary === "string"
          ? o.summary
          : typeof o.content === "string"
            ? o.content
            : undefined,
    url: typeof o.url === "string" ? o.url : typeof o.link === "string" ? o.link : undefined,
  };
}

export function mapPkulawResponseBody(body: unknown): AuthorityHit[] {
  if (!body || typeof body !== "object") {
    return [];
  }
  const o = body as Record<string, unknown>;
  const arrays: unknown[] = [];
  if (Array.isArray(o.hits)) {
    arrays.push(...o.hits);
  }
  if (Array.isArray(o.items)) {
    arrays.push(...o.items);
  }
  if (Array.isArray(o.result)) {
    arrays.push(...o.result);
  }
  if (o.data && typeof o.data === "object") {
    const data = o.data as Record<string, unknown>;
    if (Array.isArray(data.list)) {
      arrays.push(...data.list);
    }
    if (Array.isArray(data.hits)) {
      arrays.push(...data.hits);
    }
  }
  // MCP tools/call: { content: [{ type: "text", text: "{...json...}" }] }
  if (Array.isArray(o.content)) {
    for (const part of o.content) {
      if (part && typeof part === "object" && typeof (part as { text?: string }).text === "string") {
        try {
          const nested = JSON.parse((part as { text: string }).text) as unknown;
          arrays.push(...mapPkulawResponseBody(nested));
        } catch {
          /* ignore */
        }
      }
    }
  }
  const hits: AuthorityHit[] = [];
  for (const row of arrays) {
    const hit = asHit(row);
    if (hit) {
      hits.push(hit);
    }
  }
  return hits;
}

export type PkulawSearchKind = "law" | "case";

export function inferPkulawSearchKind(query: string): PkulawSearchKind {
  // Avoid \\b — unreliable for CJK.
  if (/(案例|判例|判决|案号|类案)/.test(query)) {
    return "case";
  }
  return "law";
}
