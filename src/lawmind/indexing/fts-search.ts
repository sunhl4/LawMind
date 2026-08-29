import { indexExists, openSearchIndexDb } from "./fts-ingest.js";
import { getMeta } from "./fts-schema.js";

export type SearchIndexSource = "audit" | "session" | "knowledge";

export type WorkspaceSearchHit = {
  source: SearchIndexSource;
  id: string;
  taskId?: string;
  matterId?: string;
  /** Relative workspace path for knowledge hits */
  path?: string;
  docKind?: string;
  section?: string;
  snippet: string;
  timestamp?: string;
  /** Optional fusion score (knowledge hybrid) */
  score?: number;
};

export type WorkspaceSearchOptions = {
  q: string;
  matterId?: string;
  sources?: SearchIndexSource[];
  limit?: number;
};

export type WorkspaceSearchResult = {
  ok: true;
  query: string;
  hits: WorkspaceSearchHit[];
  indexMissing?: boolean;
};

export function escapeFtsQuery(q: string): string {
  return q
    .trim()
    .replace(/["']/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, "")}"*`)
    .join(" ");
}

/** Query builder for knowledge_fts (trigram): phrase + CJK bigram OR terms. */
export function escapeKnowledgeFtsQuery(q: string): string {
  const cleaned = q
    .trim()
    .replace(/["']/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "";
  }
  const terms = new Set<string>();
  if (cleaned.length >= 3) {
    terms.add(cleaned);
  }
  for (const part of cleaned.split(/\s+/)) {
    if (part.length >= 3) {
      terms.add(part);
    }
  }
  const cjk = cleaned.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) {
    terms.add(cjk.slice(i, i + 2));
  }
  for (let i = 0; i < cjk.length - 2; i++) {
    terms.add(cjk.slice(i, i + 3));
  }
  return [...terms]
    .slice(0, 24)
    .map((t) => `"${t.replace(/"/g, "")}"`)
    .join(" OR ");
}

function snippet(body: string, max = 160): string {
  const t = body.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}…`;
}

export function searchWorkspaceIndex(
  workspaceDir: string,
  opts: WorkspaceSearchOptions,
): WorkspaceSearchResult {
  const q = opts.q.trim();
  if (!q) {
    return { ok: true, query: q, hits: [] };
  }
  if (!indexExists(workspaceDir)) {
    return { ok: true, query: q, hits: [], indexMissing: true };
  }
  const ftsQ = escapeFtsQuery(q);
  if (!ftsQ) {
    return { ok: true, query: q, hits: [] };
  }
  const sources = opts.sources ?? ["audit", "session", "knowledge"];
  const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
  const matterId = opts.matterId?.trim();
  const db = openSearchIndexDb(workspaceDir);
  const hits: WorkspaceSearchHit[] = [];

  try {
    if (sources.includes("audit")) {
      const sql = matterId
        ? `SELECT event_id, task_id, matter_id, body, timestamp FROM audit_fts WHERE audit_fts MATCH ? AND matter_id = ? LIMIT ?`
        : `SELECT event_id, task_id, matter_id, body, timestamp FROM audit_fts WHERE audit_fts MATCH ? LIMIT ?`;
      const rows = (
        matterId ? db.prepare(sql).all(ftsQ, matterId, limit) : db.prepare(sql).all(ftsQ, limit)
      ) as Array<{
        event_id: string;
        task_id: string;
        matter_id: string;
        body: string;
        timestamp: string;
      }>;
      for (const r of rows) {
        hits.push({
          source: "audit",
          id: r.event_id,
          taskId: r.task_id,
          matterId: r.matter_id || undefined,
          snippet: snippet(r.body),
          timestamp: r.timestamp,
        });
      }
    }

    if (sources.includes("session") && hits.length < limit) {
      const remain = limit - hits.length;
      const sql = matterId
        ? `SELECT session_id, turn_id, matter_id, body, timestamp FROM session_fts WHERE session_fts MATCH ? AND matter_id = ? LIMIT ?`
        : `SELECT session_id, turn_id, matter_id, body, timestamp FROM session_fts WHERE session_fts MATCH ? LIMIT ?`;
      const rows = (
        matterId ? db.prepare(sql).all(ftsQ, matterId, remain) : db.prepare(sql).all(ftsQ, remain)
      ) as Array<{
        session_id: string;
        turn_id: string;
        matter_id: string;
        body: string;
        timestamp: string;
      }>;
      for (const r of rows) {
        hits.push({
          source: "session",
          id: r.turn_id || r.session_id,
          matterId: r.matter_id || undefined,
          snippet: snippet(r.body),
          timestamp: r.timestamp,
        });
      }
    }

    if (sources.includes("knowledge") && hits.length < limit) {
      const remain = limit - hits.length;
      const knowledgeQ = escapeKnowledgeFtsQuery(q);
      if (knowledgeQ) {
        const sql = matterId
          ? `SELECT path, matter_id, doc_kind, section, body, bm25(knowledge_fts) AS rank
             FROM knowledge_fts WHERE knowledge_fts MATCH ? AND (matter_id = ? OR matter_id = '')
             ORDER BY rank LIMIT ?`
          : `SELECT path, matter_id, doc_kind, section, body, bm25(knowledge_fts) AS rank
             FROM knowledge_fts WHERE knowledge_fts MATCH ?
             ORDER BY rank LIMIT ?`;
        const rows = (
          matterId
            ? db.prepare(sql).all(knowledgeQ, matterId, remain)
            : db.prepare(sql).all(knowledgeQ, remain)
        ) as Array<{
          path: string;
          matter_id: string;
          doc_kind: string;
          section: string;
          body: string;
          rank: number;
        }>;
        for (const r of rows) {
          hits.push({
            source: "knowledge",
            id: `${r.path}#${r.section || "body"}`,
            path: r.path,
            docKind: r.doc_kind,
            section: r.section || undefined,
            matterId: r.matter_id || undefined,
            snippet: snippet(r.body),
            score: typeof r.rank === "number" ? -r.rank : undefined,
          });
        }
      }
    }
  } finally {
    db.close();
  }

  return { ok: true, query: q, hits };
}

/** 索引新鲜度阈值：lastRebuildAt 早于此毫秒数即视为过期。 */
export const SEARCH_INDEX_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** 由 getSearchIndexStatus 结果推导新鲜度（Doctor 提醒与自动重建共用口径）。 */
export function computeSearchIndexFreshness(
  status: { ready: boolean; lastRebuildAt?: string },
  now: number = Date.now(),
): { stale: boolean; staleReason?: string } {
  if (!status.ready) {
    return { stale: true, staleReason: "index_missing" };
  }
  const t = status.lastRebuildAt ? Date.parse(status.lastRebuildAt) : Number.NaN;
  if (!Number.isFinite(t)) {
    return { stale: true, staleReason: "last_rebuild_unknown" };
  }
  if (now - t > SEARCH_INDEX_STALE_AFTER_MS) {
    return { stale: true, staleReason: "older_than_24h" };
  }
  return { stale: false };
}

export function getSearchIndexStatus(workspaceDir: string): {
  ready: boolean;
  schemaVersion?: number;
  lastRebuildAt?: string;
  auditRows?: number;
  sessionRows?: number;
  knowledgeRows?: number;
  truncated?: boolean;
} {
  if (!indexExists(workspaceDir)) {
    return { ready: false };
  }
  const db = openSearchIndexDb(workspaceDir);
  try {
    const schemaVersion = Number(getMeta(db, "schemaVersion") ?? "0");
    const lastRebuildAt = getMeta(db, "lastRebuildAt");
    const auditRows = Number(getMeta(db, "auditRows") ?? "0");
    const sessionRows = Number(getMeta(db, "sessionRows") ?? "0");
    const knowledgeRows = Number(getMeta(db, "knowledgeRows") ?? "0");
    const truncated = getMeta(db, "truncated") === "1";
    return {
      ready: true,
      schemaVersion,
      lastRebuildAt,
      auditRows,
      sessionRows,
      knowledgeRows,
      truncated,
    };
  } finally {
    db.close();
  }
}
