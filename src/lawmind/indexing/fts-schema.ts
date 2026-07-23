import type { DatabaseSync } from "node:sqlite";

export function initSearchIndexSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS audit_fts USING fts5(
      event_id UNINDEXED,
      task_id,
      matter_id UNINDEXED,
      kind,
      body,
      timestamp UNINDEXED,
      tokenize='unicode61'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
      session_id UNINDEXED,
      turn_id UNINDEXED,
      matter_id UNINDEXED,
      role,
      body,
      timestamp UNINDEXED,
      tokenize='unicode61'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      path UNINDEXED,
      matter_id UNINDEXED,
      doc_kind,
      section,
      body,
      tokenize='trigram'
    );
  `);
}

/**
 * Recreate knowledge_fts (trigram). Call only from rebuild/clear — never on read-only open,
 * or search would wipe the index.
 */
export function recreateKnowledgeFts(db: DatabaseSync): void {
  db.exec(`DROP TABLE IF EXISTS knowledge_fts;`);
  db.exec(`
    CREATE VIRTUAL TABLE knowledge_fts USING fts5(
      path UNINDEXED,
      matter_id UNINDEXED,
      doc_kind,
      section,
      body,
      tokenize='trigram'
    );
  `);
}

export function clearFtsTables(db: DatabaseSync): void {
  db.exec(`DELETE FROM audit_fts;`);
  db.exec(`DELETE FROM session_fts;`);
  recreateKnowledgeFts(db);
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO index_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getMeta(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare(`SELECT value FROM index_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}
