/**
 * Personal knowledge hybrid-lite search: FTS5 BM25 + weighted lexical boosts.
 * Wave-1: no embeddings. Markdown remains source of truth; index is rebuildable.
 */

import { loadMatter } from "../adapters/matter-storage/index.js";
import { tokenizeForRecall, scoreCaseWeighted } from "../memory/similar-case-recall.js";
import { isDailyLogKnowledgePath } from "./fts-ingest-knowledge.js";
import { indexExists, openSearchIndexDb, rebuildWorkspaceSearchIndex } from "./fts-ingest.js";
import { escapeKnowledgeFtsQuery } from "./fts-search.js";

export type KnowledgeDocKindFilter =
  | "case"
  | "strategy"
  | "session_summary"
  | "memory"
  | "daily_log"
  | "profile"
  | "playbook"
  | "golden";

export type PersonalKnowledgeHit = {
  path: string;
  docKind: string;
  section?: string;
  matterId?: string;
  snippet: string;
  score: number;
};

export type SearchPersonalKnowledgeOpts = {
  q: string;
  matterId?: string;
  limit?: number;
  kinds?: KnowledgeDocKindFilter[];
  /** When false, skip auto-rebuild if index missing (default true for tools). */
  autoRebuild?: boolean;
};

function snippet(body: string, max = 200): string {
  const t = body.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}…`;
}

function kindBoost(docKind: string): number {
  switch (docKind) {
    case "case":
      return 1.35;
    case "strategy":
      return 1.25;
    case "golden":
      return 1.2;
    case "playbook":
      return 1.15;
    case "session_summary":
      return 1.1;
    case "profile":
      return 1.05;
    case "memory":
      return 1.0;
    case "daily_log":
      return 0.35;
    default:
      return 1.0;
  }
}

function strongMatch(queryTokens: string[], body: string, section: string): boolean {
  if (queryTokens.length === 0) {
    return false;
  }
  const hay = `${section}\n${body}`.toLowerCase();
  let hits = 0;
  for (const t of queryTokens) {
    if (t.length >= 2 && hay.includes(t)) {
      hits++;
    }
  }
  // Require majority of tokens or a long phrase hit
  if (hits >= Math.ceil(queryTokens.length * 0.6)) {
    return true;
  }
  return queryTokens.some((t) => t.length >= 4 && hay.includes(t));
}

/**
 * Hybrid personal knowledge search over the workspace FTS knowledge corpus.
 */
export async function searchPersonalKnowledge(
  workspaceDir: string,
  opts: SearchPersonalKnowledgeOpts,
): Promise<{ ok: true; query: string; hits: PersonalKnowledgeHit[]; indexMissing?: boolean }> {
  const q = opts.q.trim();
  if (!q) {
    return { ok: true, query: q, hits: [] };
  }

  if (!indexExists(workspaceDir)) {
    if (opts.autoRebuild === false) {
      return { ok: true, query: q, hits: [], indexMissing: true };
    }
    await rebuildWorkspaceSearchIndex(workspaceDir);
  }

  const ftsQ = escapeKnowledgeFtsQuery(q);
  if (!ftsQ) {
    return { ok: true, query: q, hits: [] };
  }

  const limit = Math.min(50, Math.max(1, opts.limit ?? 12));
  const matterId = opts.matterId?.trim();
  const kindFilter = opts.kinds?.length ? new Set(opts.kinds) : null;
  const queryTokens = tokenizeForRecall(q);
  const db = openSearchIndexDb(workspaceDir);
  const fused: PersonalKnowledgeHit[] = [];

  try {
    const fetchLimit = Math.min(80, limit * 4);
    const sql = matterId
      ? `SELECT path, matter_id, doc_kind, section, body, bm25(knowledge_fts) AS rank
         FROM knowledge_fts WHERE knowledge_fts MATCH ? AND (matter_id = ? OR matter_id = '')
         ORDER BY rank LIMIT ?`
      : `SELECT path, matter_id, doc_kind, section, body, bm25(knowledge_fts) AS rank
         FROM knowledge_fts WHERE knowledge_fts MATCH ?
         ORDER BY rank LIMIT ?`;
    const rows = (
      matterId
        ? db.prepare(sql).all(ftsQ, matterId, fetchLimit)
        : db.prepare(sql).all(ftsQ, fetchLimit)
    ) as Array<{
      path: string;
      matter_id: string;
      doc_kind: string;
      section: string;
      body: string;
      rank: number;
    }>;

    const crossMatterAllowed = process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH === "1";

    for (const r of rows) {
      if (kindFilter && !kindFilter.has(r.doc_kind as KnowledgeDocKindFilter)) {
        continue;
      }
      const mid = r.matter_id?.trim() || undefined;
      if (mid && matterId && mid !== matterId && !crossMatterAllowed) {
        // When filtering to a matter, workspace-global docs (empty matter_id) already allowed by SQL.
        continue;
      }
      if (mid && !matterId && !crossMatterAllowed) {
        // Default: include all non-restricted; skip restricted at score time
        try {
          const rec = loadMatter(workspaceDir, mid);
          if (rec?.sensitivity === "restricted") {
            continue;
          }
        } catch {
          /* keep */
        }
      }

      const bm25 = typeof r.rank === "number" ? -r.rank : 0;
      const lexical = scoreCaseWeighted(queryTokens, `${r.section}\n${r.body}`);
      let score = bm25 * 0.55 + lexical * 2.2;
      score *= kindBoost(r.doc_kind);

      const daily = r.doc_kind === "daily_log" || isDailyLogKnowledgePath(r.path);
      if (daily && !strongMatch(queryTokens, r.body, r.section)) {
        score *= 0.15;
      } else if (daily) {
        score *= 0.55;
      }

      // Section heading boost (争点/风险)
      if (/争点|风险|策略|条款/.test(r.section)) {
        score *= 1.15;
      }

      fused.push({
        path: r.path,
        docKind: r.doc_kind,
        section: r.section || undefined,
        matterId: mid,
        snippet: snippet(r.body),
        score,
      });
    }
  } finally {
    db.close();
  }

  fused.sort((a, b) => b.score - a.score);
  // Dedupe by path keeping best chunk
  const seen = new Set<string>();
  const hits: PersonalKnowledgeHit[] = [];
  for (const h of fused) {
    if (seen.has(h.path)) {
      continue;
    }
    seen.add(h.path);
    hits.push(h);
    if (hits.length >= limit) {
      break;
    }
  }

  return { ok: true, query: q, hits };
}
