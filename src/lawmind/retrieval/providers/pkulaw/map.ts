/**
 * Map北大法宝-style / LawMind shim JSON into AuthorityHit[].
 * Supports:
 * - LawMind generic: { hits|items: AuthorityHit[] }
 * - Shim list: { data: { list: [...] } } or { result: [...] }
 * - Official MCP tools/call: structuredContent.result[] + content JSON array
 *   ({ gid, title, article, url } / case_number)
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
  // Official case gateway: docType/caseType 中文，无 kind/type。
  const docKindRaw = [o.docType, o.caseType]
    .filter((x): x is string => typeof x === "string")
    .join(" ");
  let kind: AuthorityHit["kind"] = "other";
  if (/statute|law|法规|法条/i.test(kindRaw)) {
    kind = "statute";
  } else if (/case|案例|判决/i.test(kindRaw) || /案例|判决|裁定|决定书/i.test(docKindRaw)) {
    kind = "case";
  } else if (/reg|规章/i.test(kindRaw)) {
    kind = "regulation";
  } else if (
    typeof o.case_number === "string" ||
    typeof o.caseNumber === "string" ||
    typeof o.caseName === "string"
  ) {
    kind = "case";
  } else if (typeof o.article === "string" || typeof o.tiao_num === "string") {
    kind = "statute";
  }
  const article = typeof o.article === "string" ? o.article.trim() : "";
  // 类案网关正文放在 identified（本院认为）/ refereeResult（裁判结果）/ ascertain（查明），
  // content 常为空串，故按序回退；claims 侧另有 500 字截断。
  const caseProse = [o.identified, o.refereeResult, o.ascertain]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .join("\n");
  const excerpt =
    (typeof o.excerpt === "string" && o.excerpt.trim()) ||
    (typeof o.summary === "string" && o.summary.trim()) ||
    (typeof o.content === "string" && o.content.trim()) ||
    caseProse ||
    article ||
    undefined;
  const id =
    (typeof o.id === "string" && o.id) ||
    (typeof o.docId === "string" && o.docId) ||
    (typeof o.gid === "string" && o.gid) ||
    undefined;
  return {
    id,
    title: title.trim(),
    kind,
    citation:
      typeof o.citation === "string"
        ? o.citation
        : typeof o.fullName === "string"
          ? o.fullName
          : typeof o.case_number === "string"
            ? o.case_number
            : typeof o.caseNumber === "string"
              ? o.caseNumber
              : undefined,
    excerpt,
    url: typeof o.url === "string" ? o.url : typeof o.link === "string" ? o.link : undefined,
    provider: "pkulaw",
  };
}

function collectRows(body: unknown, into: unknown[]): void {
  if (Array.isArray(body)) {
    into.push(...body);
    return;
  }
  if (!body || typeof body !== "object") {
    return;
  }
  const o = body as Record<string, unknown>;
  if (Array.isArray(o.hits)) {
    into.push(...o.hits);
  }
  if (Array.isArray(o.items)) {
    into.push(...o.items);
  }
  if (Array.isArray(o.result)) {
    into.push(...o.result);
  }
  if (o.data && typeof o.data === "object") {
    // Official case gateway / mcp-case-search-service: structuredContent.data 是
    // 顶层数组（不是 data.list）；漏掉就会 rows>0 但 hits=0 → invalid_response。
    if (Array.isArray(o.data)) {
      into.push(...o.data);
    }
    const data = o.data as Record<string, unknown>;
    if (Array.isArray(data.list)) {
      into.push(...data.list);
    }
    if (Array.isArray(data.hits)) {
      into.push(...data.hits);
    }
    if (Array.isArray(data.result)) {
      into.push(...data.result);
    }
    if (Array.isArray(data.rows)) {
      into.push(...data.rows);
    }
  }
  if (o.structuredContent && typeof o.structuredContent === "object") {
    collectRows(o.structuredContent, into);
  }
  // MCP tools/call: { content: [{ type: "text", text: "{...json...}" | "[...]" }] }
  if (Array.isArray(o.content)) {
    for (const part of o.content) {
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: string }).text === "string"
      ) {
        try {
          collectRows(JSON.parse((part as { text: string }).text) as unknown, into);
        } catch {
          /* ignore non-JSON tool text */
        }
      }
    }
  }
}

export function mapPkulawResponseBody(body: unknown): AuthorityHit[] {
  const arrays: unknown[] = [];
  collectRows(body, arrays);
  const hits: AuthorityHit[] = [];
  const seen = new Set<string>();
  for (const row of arrays) {
    const hit = asHit(row);
    if (!hit) {
      continue;
    }
    const key = `${hit.id ?? ""}|${hit.url ?? ""}|${hit.title}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    hits.push(hit);
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
