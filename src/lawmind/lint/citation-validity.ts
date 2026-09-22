import { formatRepealedCitationWarning, scanRepealedStatutes } from "../reasoning/norm-validity.js";
import { lintFinding as finding } from "./finding.js";
import type { LegalLintFinding } from "./types.js";

export type LegalLintCitationHit = {
  title: string;
  status?: string;
};

export const CITATION_VALIDITY_RULE_COUNT = 3;

const CITE_RE = /《([^》]{1,40})》\s*第\s*([0-9一二三四五六七八九十百]+)\s*条/g;
const REPEALED_STATUS = /已废止|失效|废止/;
const IN_FORCE_STATUS = /现行有效/;

const repealedRule = { id: "citation.repealed_nearby", family: "citation" as const };
const knownRepealedRule = { id: "citation.known_repealed", family: "citation" as const };
const offlineRule = { id: "citation.offline_validity", family: "citation" as const };

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
    return [];
  }

  const findings: LegalLintFinding[] = [];
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
