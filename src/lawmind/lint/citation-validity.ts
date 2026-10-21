import { formatRepealedCitationWarning, scanRepealedStatutes } from "../reasoning/norm-validity.js";
import { lintFinding as finding } from "./finding.js";
import type { LegalLintFinding } from "./types.js";

export type LegalLintCitationHit = {
  title: string;
  status?: string;
};

export const CITATION_VALIDITY_RULE_COUNT = 4;

const CITE_RE = /《([^》]{1,40})》\s*第\s*([0-9一二三四五六七八九十百]+)\s*条/g;
const EMPTY_TITLE_RE = /《\s*》/g;
const ARTICLE_INSIDE_RE = /《[^》]{0,40}?第[0-9一二三四五六七八九十百]+条[^》]*?》/g;
const MISSING_NUMERAL_RE = /《[^》]{1,40}》\s*第\s*条/g;
const REPEALED_STATUS = /已废止|失效|废止/;
const IN_FORCE_STATUS = /现行有效/;

const repealedRule = { id: "citation.repealed_nearby", family: "citation" as const };
const knownRepealedRule = { id: "citation.known_repealed", family: "citation" as const };
const offlineRule = { id: "citation.offline_validity", family: "citation" as const };
const malformedRule = { id: "citation.malformed", family: "citation" as const };

function locateUnclosedTitleMarkers(text: string): number[] {
  const unclosed: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "《") {
      stack.push(i);
    } else if (ch === "》" && stack.length > 0) {
      stack.pop();
    }
  }
  unclosed.push(...stack);
  return unclosed;
}

/** 对照 MeWork `citationIssues.malformedMarkers`：模型输出的引用哨兵句法畸形（不可解析）时单独成条。 */
export function lintMalformedCitations(body: string): LegalLintFinding[] {
  const findings: LegalLintFinding[] = [];
  const seen = new Set<number>();
  const record = (anchor: string, index: number, span: string, message: string): void => {
    const found = index >= 0 ? index : body.indexOf(anchor);
    if (found < 0 || seen.has(found)) {
      return;
    }
    seen.add(found);
    const preview = span.length > 48 ? `${span.slice(0, 48)}…` : span;
    findings.push(
      finding(malformedRule, "warning", `${message}（原文摘录：${preview}）`, { anchor }),
    );
  };

  for (const m of body.matchAll(EMPTY_TITLE_RE)) {
    record(m[0], m.index ?? -1, m[0], "引用格式错误：书名号内缺少法律名称（《》为空）。");
  }
  for (const m of body.matchAll(ARTICLE_INSIDE_RE)) {
    record(
      m[0],
      m.index ?? -1,
      m[0],
      "引用格式错误：条号写在书名号内，应拆出为《法律名称》第N条。",
    );
  }
  for (const m of body.matchAll(MISSING_NUMERAL_RE)) {
    record(m[0], m.index ?? -1, m[0], "引用格式错误：《法律名称》后“第条”缺少条号数字。");
  }
  for (const idx of locateUnclosedTitleMarkers(body)) {
    record(
      "《",
      idx,
      body.slice(idx, idx + 24),
      "引用格式错误：书名号《未闭合，请补全法律名称或删除多余书名号。",
    );
  }
  return findings;
}

function looksLikeOpinion(text: string): boolean {
  return /法律意见|律师意见|本意见书|出具(?:本)?(?:法律)?意见|经检索[^。]{0,20}认为/.test(text);
}

function windowAround(text: string, index: number, length: number, radius = 18): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return text.slice(start, end);
}

function hitMatchesTitle(hit: LegalLintCitationHit, title: string): boolean {
  const a = hit.title.trim();
  const b = title.trim();
  if (!a || !b) {
    return false;
  }
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Citation validity skeleton — no network.
 * Optional hits (e.g. NPC FLK-shaped {title,status}) are local only.
 */
export function lintCitationValidity(
  text: string,
  hits?: LegalLintCitationHit[],
): LegalLintFinding[] {
  const body = text ?? "";
  const cites = [...body.matchAll(CITE_RE)];
  if (cites.length === 0) {
    return lintMalformedCitations(body);
  }

  const findings: LegalLintFinding[] = [...lintMalformedCitations(body)];
  const seenRepeal = new Set<string>();
  const knownRepealed = scanRepealedStatutes(body);

  for (const m of cites) {
    const title = (m[1] ?? "").trim();
    const article = (m[2] ?? "").trim();
    const nearby = windowAround(body, m.index ?? 0, m[0].length);
    const hit = hits?.find((h) => hitMatchesTitle(h, title));
    const repealedNearby = REPEALED_STATUS.test(nearby);
    const repealedHit = Boolean(hit?.status && REPEALED_STATUS.test(hit.status));
    if (!(repealedNearby || repealedHit)) {
      continue;
    }
    const key = `${title}#${article}`;
    if (seenRepeal.has(key)) {
      continue;
    }
    seenRepeal.add(key);
    findings.push(
      finding(
        repealedRule,
        "warning",
        `引用《${title}》第${article}条旁出现废止/失效标记，请核对该条是否仍有效。`,
        { anchor: m[0], statuteRef: `《${title}》第${article}条` },
      ),
    );
  }

  const seenKnown = new Set<string>();
  for (const m of cites) {
    const title = (m[1] ?? "").trim();
    const article = (m[2] ?? "").trim();
    const hit = knownRepealed.find((h) => title === h.title || title.endsWith(h.title));
    if (!hit) {
      continue;
    }
    const key = `${hit.title}#${article}`;
    if (seenKnown.has(key) || seenRepeal.has(key)) {
      continue;
    }
    seenKnown.add(key);
    findings.push(
      finding(
        knownRepealedRule,
        "warning",
        formatRepealedCitationWarning(hit.title, article, hit.replaceWith),
        { anchor: m[0], statuteRef: `《${title}》第${article}条` },
      ),
    );
  }

  const hasInForceMarker = IN_FORCE_STATUS.test(body);
  const hitInForce = Boolean(hits?.some((h) => h.status && IN_FORCE_STATUS.test(h.status)));
  if (looksLikeOpinion(body) && !hasInForceMarker && !hitInForce) {
    findings.push(
      finding(offlineRule, "info", "无法在线核验条文效力。请律师核对引用是否现行有效。"),
    );
  }

  return findings;
}
