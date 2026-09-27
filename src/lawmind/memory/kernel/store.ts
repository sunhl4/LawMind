import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  MEMORY_CONFIRMATIONS,
  MEMORY_KERNEL_SCHEMA_VERSION,
  MEMORY_KERNEL_SCOPES,
  MEMORY_KINDS,
  MEMORY_VALIDITIES,
  keySearchText,
  type MemoryConfirmation,
  type MemoryKernelScope,
  type MemoryKind,
  type MemoryOrigin,
  type MemoryRecord,
  type MemoryValidity,
} from "./contract.js";

const ORIGINS = new Set<MemoryOrigin>([
  "lawyer",
  "review",
  "engine",
  "migration",
  "stance",
  "firm_default",
  "consolidation",
]);

export function memoryKernelPath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "memory-kernel.sqlite");
}

function openDb(workspaceDir: string): DatabaseSync {
  const file = memoryKernelPath(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS memory_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_record (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      scope_id TEXT NOT NULL DEFAULT '',
      rec_key TEXT NOT NULL,
      body TEXT NOT NULL,
      confirmation TEXT NOT NULL,
      validity TEXT NOT NULL,
      superseded_by TEXT,
      source_matter_id TEXT,
      client_id TEXT,
      counterparty TEXT,
      source_task_id TEXT,
      origin TEXT NOT NULL,
      confidence REAL,
      evidence_matter_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS memory_record_lookup
      ON memory_record (confirmation, validity, scope, scope_id, rec_key);
    CREATE TABLE IF NOT EXISTS memory_edge (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_edge_from ON memory_edge (from_id, kind);
  `);
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        record_id UNINDEXED,
        body,
        tokenize='trigram'
      );
    `);
  } catch {
    /* 没有 trigram 时仍可用槽位名和字面重叠召回。 */
  }
  const version = db.prepare(`SELECT value FROM memory_meta WHERE key = 'schemaVersion'`).get() as
    | { value: string }
    | undefined;
  if (!version) {
    db.prepare(`INSERT INTO memory_meta (key, value) VALUES ('schemaVersion', ?)`).run(
      String(MEMORY_KERNEL_SCHEMA_VERSION),
    );
  }
  return db;
}

function withDb<T>(workspaceDir: string, fn: (db: DatabaseSync) => T): T {
  const db = openDb(workspaceDir);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function asKind(value: string): MemoryKind {
  return MEMORY_KINDS.find((k) => k === value) ?? "habit";
}

function asScope(value: string): MemoryKernelScope {
  return MEMORY_KERNEL_SCOPES.find((s) => s === value) ?? "lawyer";
}

function asConfirmation(value: string): MemoryConfirmation {
  return MEMORY_CONFIRMATIONS.find((s) => s === value) ?? "pending";
}

function asValidity(value: string): MemoryValidity {
  return MEMORY_VALIDITIES.find((s) => s === value) ?? "current";
}

function asOrigin(value: string): MemoryOrigin {
  return ORIGINS.has(value as MemoryOrigin) ? (value as MemoryOrigin) : "migration";
}

type Row = {
  id: string;
  kind: string;
  scope: string;
  scope_id: string;
  rec_key: string;
  body: string;
  confirmation: string;
  validity: string;
  superseded_by: string | null;
  source_matter_id: string | null;
  client_id: string | null;
  counterparty: string | null;
  source_task_id: string | null;
  origin: string;
  confidence: number | null;
  evidence_matter_ids: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

function fromRow(row: Row): MemoryRecord {
  let evidenceMatterIds: string[] = [];
  try {
    const parsed = JSON.parse(row.evidence_matter_ids) as unknown;
    if (Array.isArray(parsed)) {
      evidenceMatterIds = parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
    }
  } catch {
    evidenceMatterIds = [];
  }
  return {
    id: row.id,
    kind: asKind(row.kind),
    scope: asScope(row.scope),
    scopeId: row.scope_id,
    key: row.rec_key,
    body: row.body,
    confirmation: asConfirmation(row.confirmation),
    validity: asValidity(row.validity),
    ...(row.superseded_by ? { supersededBy: row.superseded_by } : {}),
    ...(row.source_matter_id ? { sourceMatterId: row.source_matter_id } : {}),
    ...(row.client_id ? { clientId: row.client_id } : {}),
    ...(row.counterparty ? { counterparty: row.counterparty } : {}),
    ...(row.source_task_id ? { sourceTaskId: row.source_task_id } : {}),
    origin: asOrigin(row.origin),
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
    evidenceMatterIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  };
}

const SELECT_ALL = `SELECT * FROM memory_record`;

export function listMemoryRecords(workspaceDir: string): MemoryRecord[] {
  return withDb(workspaceDir, (db) => {
    const rows = db.prepare(`${SELECT_ALL} ORDER BY updated_at DESC`).all() as Row[];
    return rows.map(fromRow);
  });
}

export function getMemoryRecord(workspaceDir: string, id: string): MemoryRecord | undefined {
  return withDb(workspaceDir, (db) => {
    const row = db.prepare(`${SELECT_ALL} WHERE id = ?`).get(id) as Row | undefined;
    return row ? fromRow(row) : undefined;
  });
}

export type MemoryInsert = {
  id?: string;
  kind: MemoryKind;
  scope: MemoryKernelScope;
  scopeId?: string;
  key: string;
  body: string;
  confirmation: MemoryConfirmation;
  validity?: MemoryValidity;
  supersededBy?: string;
  sourceMatterId?: string;
  clientId?: string;
  counterparty?: string;
  sourceTaskId?: string;
  origin: MemoryOrigin;
  confidence?: number;
  evidenceMatterIds?: string[];
  createdAt?: string;
  updatedAt?: string;
};

function insertRow(
  db: DatabaseSync,
  input: MemoryInsert,
  mode: "insert" | "ignore" | "replace",
): MemoryRecord | undefined {
  const now = new Date().toISOString();
  const id = input.id?.trim() || `mem_${randomUUID()}`;
  const sql =
    mode === "ignore"
      ? `INSERT OR IGNORE INTO memory_record (
          id, kind, scope, scope_id, rec_key, body, confirmation, validity,
          superseded_by, source_matter_id, client_id, counterparty, source_task_id,
          origin, confidence, evidence_matter_ids, created_at, updated_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      : `INSERT OR REPLACE INTO memory_record (
          id, kind, scope, scope_id, rec_key, body, confirmation, validity,
          superseded_by, source_matter_id, client_id, counterparty, source_task_id,
          origin, confidence, evidence_matter_ids, created_at, updated_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`;
  db.prepare(sql).run(
    id,
    input.kind,
    input.scope,
    input.scopeId?.trim() ?? "",
    input.key.trim(),
    input.body.trim(),
    input.confirmation,
    input.validity ?? "current",
    input.supersededBy ?? null,
    input.sourceMatterId ?? null,
    input.clientId ?? null,
    input.counterparty ?? null,
    input.sourceTaskId ?? null,
    input.origin,
    input.confidence ?? null,
    JSON.stringify(input.evidenceMatterIds ?? []),
    input.createdAt ?? now,
    input.updatedAt ?? now,
  );
  const row = db.prepare(`${SELECT_ALL} WHERE id = ?`).get(id) as Row | undefined;
  if (row) {
    refreshMemorySearch(db, row);
  }
  return row ? fromRow(row) : undefined;
}

export function insertMemoryRecord(workspaceDir: string, input: MemoryInsert): MemoryRecord {
  const saved = withDb(workspaceDir, (db) => insertRow(db, input, "insert"));
  if (!saved) {
    throw new Error("memory_insert_failed");
  }
  return saved;
}

export function insertMemoryRecordIfAbsent(
  workspaceDir: string,
  input: MemoryInsert & { id: string },
): MemoryRecord | undefined {
  return withDb(workspaceDir, (db) => {
    const existing = db.prepare(`${SELECT_ALL} WHERE id = ?`).get(input.id) as Row | undefined;
    if (existing) {
      return fromRow(existing);
    }
    return insertRow(db, input, "ignore");
  });
}

export function replaceMemoryRecord(
  workspaceDir: string,
  input: MemoryInsert & { id: string },
): MemoryRecord {
  const saved = withDb(workspaceDir, (db) => {
    const existing = db.prepare(`${SELECT_ALL} WHERE id = ?`).get(input.id) as Row | undefined;
    if (existing) {
      const prev = fromRow(existing);
      const incoming = input.validity ?? "current";
      // 导入和立场同步不能把已撤回、已取代的句子写回「当前」。
      if (
        (prev.validity === "revoked" || prev.validity === "superseded") &&
        incoming === "current"
      ) {
        return prev;
      }
    }
    return insertRow(db, input, "replace");
  });
  if (!saved) {
    throw new Error("memory_replace_failed");
  }
  return saved;
}

export function patchMemoryRecord(
  workspaceDir: string,
  id: string,
  patch: Partial<
    Pick<MemoryRecord, "confirmation" | "validity" | "body" | "key" | "scope" | "scopeId" | "kind">
  > & {
    supersededBy?: string | null;
    revokedAt?: string | null;
  },
): MemoryRecord | undefined {
  return withDb(workspaceDir, (db) => {
    const existing = db.prepare(`${SELECT_ALL} WHERE id = ?`).get(id) as Row | undefined;
    if (!existing) {
      return undefined;
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE memory_record
       SET confirmation = ?, validity = ?, body = ?, superseded_by = ?, revoked_at = ?,
           rec_key = ?, scope = ?, scope_id = ?, kind = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      patch.confirmation ?? existing.confirmation,
      patch.validity ?? existing.validity,
      patch.body ?? existing.body,
      patch.supersededBy === undefined ? existing.superseded_by : patch.supersededBy,
      patch.revokedAt === undefined ? existing.revoked_at : patch.revokedAt,
      patch.key ?? existing.rec_key,
      patch.scope ?? existing.scope,
      patch.scopeId ?? existing.scope_id,
      patch.kind ?? existing.kind,
      now,
      id,
    );
    const row = db.prepare(`${SELECT_ALL} WHERE id = ?`).get(id) as Row | undefined;
    if (row) {
      refreshMemorySearch(db, row);
    }
    return row ? fromRow(row) : undefined;
  });
}

function refreshMemorySearch(db: DatabaseSync, row: Row): void {
  try {
    db.prepare(`DELETE FROM memory_fts WHERE record_id = ?`).run(row.id);
    if (row.confirmation === "confirmed" && row.validity === "current") {
      const label = keySearchText(row.rec_key);
      db.prepare(`INSERT INTO memory_fts (record_id, body) VALUES (?, ?)`).run(
        row.id,
        `${label}\n${row.body}`,
      );
    }
  } catch {
    /* 索引不可用时字面召回仍然有效。 */
  }
}

export function searchMemoryIds(workspaceDir: string, query: string): Set<string> {
  const q = query.replace(/["*]/g, " ").trim();
  if (q.length < 2) {
    return new Set();
  }
  return withDb(workspaceDir, (db) => {
    try {
      const rows = db
        .prepare(`SELECT record_id FROM memory_fts WHERE memory_fts MATCH ? LIMIT 24`)
        .all(q) as Array<{ record_id: string }>;
      return new Set(rows.map((row) => row.record_id));
    } catch {
      return new Set();
    }
  });
}

export type MemoryEdgeKind = "supersedes" | "consolidates";

export function addMemoryEdge(
  workspaceDir: string,
  fromId: string,
  toId: string,
  kind: MemoryEdgeKind,
): void {
  withDb(workspaceDir, (db) => {
    db.prepare(
      `INSERT OR IGNORE INTO memory_edge (id, from_id, to_id, kind, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(`edge_${kind}_${fromId}_${toId}`, fromId, toId, kind, new Date().toISOString());
  });
}

export function readMemoryMeta(workspaceDir: string, key: string): string | undefined {
  return withDb(workspaceDir, (db) => {
    const row = db.prepare(`SELECT value FROM memory_meta WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  });
}

export function writeMemoryMeta(workspaceDir: string, key: string, value: string): void {
  withDb(workspaceDir, (db) => {
    db.prepare(
      `INSERT INTO memory_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  });
}

export function listCurrentSlot(
  workspaceDir: string,
  scope: MemoryKernelScope,
  scopeId: string,
  key: string,
): MemoryRecord[] {
  return withDb(workspaceDir, (db) => {
    const rows = db
      .prepare(
        `${SELECT_ALL}
         WHERE scope = ? AND scope_id = ? AND rec_key = ?
           AND confirmation = 'confirmed' AND validity = 'current'`,
      )
      .all(scope, scopeId, key) as Row[];
    return rows.map(fromRow);
  });
}
