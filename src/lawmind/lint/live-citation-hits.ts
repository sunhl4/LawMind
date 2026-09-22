/**
 * Optional live statute-status check for cited laws (NPC FLK hybrid path).
 *
 * Fail-closed and local-first: when NPC live search is disabled or errors,
 * returns [] and citation validity falls back to the offline skeleton (local
 * repealed-list + nearby markers). Findings produced from these hits are
 * warnings — they never block export on their own.
 */

import { isNpcFlkLiveEnabled, searchNpcFlkLive } from "../retrieval/providers/open-law/npc-flk.js";
import type { LegalLintCitationHit } from "./citation-validity.js";

const CITE_TITLE_RE = /《([^》]{1,40})》/g;
const STATUS_RE = /现行有效|已废止|已修改|失效|废止/;
const MAX_LIVE_TITLES = 5;

/** Unique 《…》 statute titles cited in the text (capped for live lookups). */
export function extractCitedStatuteTitles(text: string, cap = MAX_LIVE_TITLES): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of (text ?? "").matchAll(CITE_TITLE_RE)) {
    const title = (m[1] ?? "").trim();
    if (!title || seen.has(title)) {
      continue;
    }
    seen.add(title);
    out.push(title);
    if (out.length >= cap) {
      break;
    }
  }
  return out;
}

type NpcSearch = typeof searchNpcFlkLive;

/**
 * Fetch {title, status} rows for cited statutes from the official public NPC
 * database. Returns [] when disabled or on any network/endpoint failure.
 */
export async function fetchLiveCitationHits(
  text: string,
  opts?: { enabled?: boolean; searchImpl?: NpcSearch },
): Promise<LegalLintCitationHit[]> {
  const enabled = opts?.enabled ?? isNpcFlkLiveEnabled();
  if (!enabled) {
    return [];
  }
  const search = opts?.searchImpl ?? searchNpcFlkLive;
  const titles = extractCitedStatuteTitles(text);
  const out: LegalLintCitationHit[] = [];
  for (const title of titles) {
    try {
      const { hits, error } = await search({ query: title });
      if (error || hits.length === 0) {
        continue;
      }
      const best = hits.find((h) => h.title === title) ?? hits[0];
      const status = best.excerpt?.match(STATUS_RE)?.[0];
      if (status) {
        out.push({ title: best.title, status });
      }
    } catch {
      // 单条失败不拖垮整批：该法条回到离线骨架口径。
    }
  }
  return out;
}
