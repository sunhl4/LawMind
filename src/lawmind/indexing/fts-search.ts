import { indexExists, openSearchIndexDb } from "./fts-ingest.js";
import { getMeta } from "./fts-schema.js";

export type SearchIndexSource = "audit" | "session";

export type WorkspaceSearchHit = {
  source: SearchIndexSource;
  id: string;
  taskId?: string;
  matterId?: string;
  snippet: string;
  timestamp?: string;
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

function escapeFtsQuery(q: string): string {
  return q
    .trim()
    .replace(/["']/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, "")}"*`)
    .join(" ");
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
  const sources = opts.sources ?? ["audit", "session"];
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
  } finally {
    db.close();
  }

  return { ok: true, query: q, hits };
}

export function getSearchIndexStatus(workspaceDir: string): {
  ready: boolean;
  schemaVersion?: number;
  lastRebuildAt?: string;
  auditRows?: number;
  sessionRows?: number;
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
    const truncated = getMeta(db, "truncated") === "1";
    return {
      ready: true,
      schemaVersion,
      lastRebuildAt,
      auditRows,
      sessionRows,
      truncated,
    };
  } finally {
    db.close();
  }
}
