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
  `);
}

export function clearFtsTables(db: DatabaseSync): void {
  db.exec(`DELETE FROM audit_fts;`);
  db.exec(`DELETE FROM session_fts;`);
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
