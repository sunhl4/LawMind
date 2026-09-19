/**
 * Materials search over materials_fts (trigram + bm25).
 * Answers carry {relPath, page} so the lawyer can open the exact file location.
 */

import type { DatabaseSync } from "node:sqlite";
import { ingestMaterialsIncremental } from "./fts-ingest-materials.js";
import { openSearchIndexDb } from "./fts-ingest.js";
import { escapeKnowledgeFtsQuery } from "./fts-search.js";

export type MaterialSearchHit = {
  matterId: string;
  relPath: string;
  fileName: string;
  page: number;
  snippet: string;
  score: number;
};

function makeSnippet(body: string, max = 200): string {
  const t = body.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Search matter materials; refreshes changed files incrementally before querying. */
export async function searchMaterials(
  workspaceDir: string,
  opts: { q: string; matterId?: string; limit?: number },
): Promise<{ ok: true; hits: MaterialSearchHit[] }> {
  const q = opts.q.trim();
  if (!q) {
    return { ok: true, hits: [] };
  }
  const db: DatabaseSync = openSearchIndexDb(workspaceDir);
  try {
    await ingestMaterialsIncremental(db, workspaceDir);
    const ftsQ = escapeKnowledgeFtsQuery(q);
    if (!ftsQ) {
      return { ok: true, hits: [] };
    }
    const limit = Math.min(30, Math.max(1, opts.limit ?? 10));
    const matterId = opts.matterId?.trim();
    const sql = matterId
      ? `SELECT matter_id AS matterId, rel_path AS relPath, file_name AS fileName, page, body, bm25(materials_fts) AS rank
         FROM materials_fts WHERE materials_fts MATCH ? AND matter_id = ?
         ORDER BY rank LIMIT ?`
      : `SELECT matter_id AS matterId, rel_path AS relPath, file_name AS fileName, page, body, bm25(materials_fts) AS rank
         FROM materials_fts WHERE materials_fts MATCH ?
         ORDER BY rank LIMIT ?`;
    const rows = (
      matterId ? db.prepare(sql).all(ftsQ, matterId, limit) : db.prepare(sql).all(ftsQ, limit)
    ) as Array<{
      matterId: string;
      relPath: string;
      fileName: string;
      page: number;
      body: string;
      rank: number;
    }>;
    return {
      ok: true,
      hits: rows.map((r) => ({
        matterId: r.matterId,
        relPath: r.relPath,
        fileName: r.fileName,
        page: r.page,
        snippet: makeSnippet(r.body),
        score: typeof r.rank === "number" ? -r.rank : 0,
      })),
    };
  } finally {
    db.close();
  }
}
