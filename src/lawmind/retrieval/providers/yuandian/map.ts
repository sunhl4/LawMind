/**
 * 元典 (YuanDian) response body → AuthorityHit[] mapping.
 *
 * 元典开放平台 (open.chineselaw.com) returns tool call envelopes; the exact
 REST field names vary per interface (documented in the API square), so this
 mapper stays tolerant and:
 * - deep-collects candidate rows (data.list / extra.fatiao / result / MCP
 *   structuredContent / content JSON text) with a depth cap;
 * - reads common title/content fields with vendor-specific fallbacks
 *   (fgmc 法规名称 + ftnum 条号 for statutes, case_number 案号 for cases);
 * - stamps provider:"yuandian" and lets the caller stamp kind from the tool
 *   that produced the hits (law tool → statute, case tool → case).
 */

import type { AuthorityHit } from "../../authority-hits.js";

const MAX_DEPTH = 8;
const MAX_ROWS = 200;

function asHit(raw: unknown): AuthorityHit | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const str = (key: string): string | undefined =>
    typeof o[key] === "string" && o[key].trim() ? o[key].trim() : undefined;

  const fgmc = str("fgmc") ?? str("lawName") ?? str("fatiaoName");
  const ftnum = str("ftnum") ?? str("tiaoNum") ?? str("article");
  const caseNumber = str("case_number") ?? str("caseNumber") ?? str("案号");
  const composedCitation = fgmc && ftnum ? `《${fgmc}》${ftnum}` : fgmc ? `《${fgmc}》` : undefined;

  const title =
    str("title") ??
    str("标题") ??
    str("name") ??
    str("caseName") ??
    str("case_name") ??
    (fgmc && ftnum ? `${fgmc} ${ftnum}` : undefined) ??
    fgmc;
  if (!title?.trim()) {
    return null;
  }
  const excerpt =
    str("content") ??
    str("法条内容") ??
    str("excerpt") ??
    str("summary") ??
    str("text") ??
    str("裁判要旨") ??
    undefined;
  const id = str("id") ?? str("docId") ?? str("gid") ?? str("ft_id") ?? str("fg_id") ?? undefined;
  return {
    ...(id ? { id } : {}),
    title: title.trim(),
    citation: str("citation") ?? caseNumber ?? composedCitation,
    excerpt,
    url: str("url") ?? str("link"),
    provider: "yuandian",
  };
}

/** Depth-first collection of candidate row arrays (objects and arrays only). */
function collectRows(body: unknown, into: unknown[], depth = 0): void {
  if (into.length >= MAX_ROWS || depth > MAX_DEPTH) {
    return;
  }
  if (Array.isArray(body)) {
    for (const row of body) {
      if (into.length >= MAX_ROWS) {
        return;
      }
      if (row && typeof row === "object") {
        into.push(row);
        // Envelope arrays (MCP `content`) hide rows behind embedded JSON text —
        // probe inside too; the caller's dedupe removes accidental repeats.
        collectRows(row, into, depth + 1);
      }
    }
    return;
  }
  if (!body || typeof body !== "object") {
    return;
  }
  for (const value of Object.values(body as Record<string, unknown>)) {
    if (value == null) {
      continue;
    }
    if (typeof value === "object") {
      collectRows(value, into, depth + 1);
    } else if (
      typeof value === "string" &&
      (value.trim().startsWith("{") || value.trim().startsWith("["))
    ) {
      // MCP content part text may embed JSON results.
      try {
        collectRows(JSON.parse(value) as unknown, into, depth + 1);
      } catch {
        /* ignore non-JSON text */
      }
    }
  }
}

export function mapYuandianResponseBody(body: unknown): AuthorityHit[] {
  const rows: unknown[] = [];
  collectRows(body, rows);
  const hits: AuthorityHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const hit = asHit(row);
    if (!hit) {
      continue;
    }
    const key = `${hit.id ?? ""}|${hit.citation ?? ""}|${hit.title}|${hit.url ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    hits.push(hit);
  }
  return hits;
}
