import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readAllAuditLogs } from "../audit/index.js";
import { listTaskRecords } from "../tasks/index.js";
import {
  ingestKnowledgeRows,
  listKnowledgeSourceStamps,
  syncKnowledgeIncremental,
} from "./fts-ingest-knowledge.js";
import { ingestMaterialsIncremental, ingestMaterialsRows } from "./fts-ingest-materials.js";
import { clearFtsTables, getMeta, initSearchIndexSchema, setMeta } from "./fts-schema.js";
import {
  SEARCH_INDEX_SCHEMA_VERSION,
  lawmindDir,
  searchIndexPath,
} from "./workspace-index-path.js";

export type RebuildIndexOptions = {
  maxAuditRows?: number;
  maxSessionRows?: number;
  maxKnowledgeRows?: number;
};

export type RebuildIndexResult = {
  ok: true;
  auditRows: number;
  sessionRows: number;
  knowledgeRows: number;
  materialsRows: number;
  truncated: boolean;
  durationMs: number;
};

const DEFAULT_MAX_AUDIT = 50_000;
const DEFAULT_MAX_SESSION = 50_000;
const DEFAULT_MAX_KNOWLEDGE = 40_000;

function matterIdByTaskId(workspaceDir: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of listTaskRecords(workspaceDir)) {
    if (t.matterId?.trim()) {
      m.set(t.taskId, t.matterId.trim());
    }
  }
  return m;
}

async function ingestAuditRows(
  db: DatabaseSync,
  workspaceDir: string,
  maxRows: number,
): Promise<{ count: number; truncated: boolean }> {
  const matterMap = matterIdByTaskId(workspaceDir);
  const auditDir = path.join(workspaceDir, "audit");
  let events: Awaited<ReturnType<typeof readAllAuditLogs>> = [];
  try {
    events = await readAllAuditLogs(auditDir);
  } catch {
    events = [];
  }
  const insert = db.prepare(
    `INSERT INTO audit_fts(event_id, task_id, matter_id, kind, body, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let count = 0;
  let truncated = false;
  for (const e of events) {
    if (count >= maxRows) {
      truncated = true;
      break;
    }
    const matterId = matterMap.get(e.taskId) ?? "";
    const body = [e.kind, e.detail ?? "", e.actor, e.actorId ?? ""].join(" ").trim();
    insert.run(e.eventId, e.taskId, matterId, e.kind, body, e.timestamp);
    count++;
  }
  return { count, truncated };
}

function extractTurnText(turn: {
  instruction?: string;
  result?: string;
  messages?: Array<{ role?: string; content?: string }>;
}): string {
  const parts: string[] = [];
  if (turn.instruction?.trim()) {
    parts.push(turn.instruction.trim());
  }
  if (turn.result?.trim()) {
    parts.push(turn.result.trim());
  }
  for (const m of turn.messages ?? []) {
    if (m.content?.trim()) {
      parts.push(`${m.role ?? "msg"}: ${m.content.trim()}`);
    }
  }
  return parts.join("\n");
}

function ingestSessionRows(
  db: DatabaseSync,
  workspaceDir: string,
  maxRows: number,
): { count: number; truncated: boolean } {
  const sessionsDir = path.join(workspaceDir, "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return { count: 0, truncated: false };
  }
  const insert = db.prepare(
    `INSERT INTO session_fts(session_id, turn_id, matter_id, role, body, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let count = 0;
  let truncated = false;
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!name.endsWith(".json") || name.includes(".turns.")) {
      continue;
    }
    const sessionId = name.replace(/\.json$/, "");
    const sessionPath = path.join(sessionsDir, name);
    let matterId = "";
    let sessionUpdated = "";
    try {
      const meta = JSON.parse(fs.readFileSync(sessionPath, "utf8")) as {
        matterId?: string;
        updatedAt?: string;
      };
      matterId = meta.matterId?.trim() ?? "";
      sessionUpdated = meta.updatedAt ?? "";
    } catch {
      continue;
    }
    const turnsPath = path.join(sessionsDir, `${sessionId}.turns.jsonl`);
    if (!fs.existsSync(turnsPath)) {
      continue;
    }
    const raw = fs.readFileSync(turnsPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (count >= maxRows) {
        truncated = true;
        return { count, truncated };
      }
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const turn = JSON.parse(trimmed) as {
          turnId?: string;
          instruction?: string;
          result?: string;
          messages?: Array<{ role?: string; content?: string }>;
        };
        const body = extractTurnText(turn);
        if (!body) {
          continue;
        }
        insert.run(sessionId, turn.turnId ?? "", matterId, "turn", body, sessionUpdated);
        count++;
      } catch {
        // skip bad line
      }
    }
  }
  return { count, truncated };
}

export function openSearchIndexDb(workspaceDir: string): DatabaseSync {
  fs.mkdirSync(lawmindDir(workspaceDir), { recursive: true });
  const db = new DatabaseSync(searchIndexPath(workspaceDir));
  initSearchIndexSchema(db);
  return db;
}

export async function rebuildWorkspaceSearchIndex(
  workspaceDir: string,
  opts?: RebuildIndexOptions,
): Promise<RebuildIndexResult> {
  const started = Date.now();
  const maxAudit = opts?.maxAuditRows ?? DEFAULT_MAX_AUDIT;
  const maxSession = opts?.maxSessionRows ?? DEFAULT_MAX_SESSION;
  const maxKnowledge = opts?.maxKnowledgeRows ?? DEFAULT_MAX_KNOWLEDGE;
  const db = openSearchIndexDb(workspaceDir);
  clearFtsTables(db);
  const audit = await ingestAuditRows(db, workspaceDir, maxAudit);
  const session = ingestSessionRows(db, workspaceDir, maxSession);
  const knowledge = ingestKnowledgeRows(db, workspaceDir, maxKnowledge);
  const materials = await ingestMaterialsRows(db, workspaceDir);
  const truncated =
    audit.truncated || session.truncated || knowledge.truncated || materials.truncated;
  setMeta(db, "schemaVersion", String(SEARCH_INDEX_SCHEMA_VERSION));
  setMeta(db, "lastRebuildAt", new Date().toISOString());
  setMeta(db, "auditRows", String(audit.count));
  setMeta(db, "sessionRows", String(session.count));
  setMeta(db, "knowledgeRows", String(knowledge.count));
  setMeta(db, "materialsRows", String(materials.count));
  setMeta(db, "truncated", truncated ? "1" : "0");
  recordSourceBaseline(db, workspaceDir);
  db.close();
  return {
    ok: true,
    auditRows: audit.count,
    sessionRows: session.count,
    knowledgeRows: knowledge.count,
    materialsRows: materials.count,
    truncated,
    durationMs: Date.now() - started,
  };
}

export function indexExists(workspaceDir: string): boolean {
  return fs.existsSync(searchIndexPath(workspaceDir));
}

type SourceStamp = { key: string; mtime: number; size: number };

function fileStamp(abs: string): { mtime: number; size: number } | null {
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      return null;
    }
    return { mtime: Math.floor(stat.mtimeMs), size: stat.size };
  } catch {
    return null;
  }
}

function listSessionStamps(workspaceDir: string): SourceStamp[] {
  const sessionsDir = path.join(workspaceDir, "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }
  const out: SourceStamp[] = [];
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!name.endsWith(".json") || name.includes(".turns.")) {
      continue;
    }
    const sessionId = name.replace(/\.json$/, "");
    const meta = fileStamp(path.join(sessionsDir, name));
    const turns = fileStamp(path.join(sessionsDir, `${sessionId}.turns.jsonl`));
    if (!meta || !turns) {
      continue;
    }
    out.push({
      key: sessionId,
      mtime: Math.max(meta.mtime, turns.mtime),
      size: meta.size + turns.size,
    });
  }
  return out;
}

function listAuditStamps(workspaceDir: string): SourceStamp[] {
  const auditDir = path.join(workspaceDir, "audit");
  if (!fs.existsSync(auditDir)) {
    return [];
  }
  const out: SourceStamp[] = [];
  for (const name of fs.readdirSync(auditDir)) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const stamp = fileStamp(path.join(auditDir, name));
    if (stamp) {
      out.push({ key: name, ...stamp });
    }
  }
  return out;
}

function upsertSource(
  db: DatabaseSync,
  kind: string,
  key: string,
  mtime: number,
  size: number,
): void {
  db.prepare(
    `INSERT INTO index_source(source_key, kind, mtime, size) VALUES (?, ?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET kind = excluded.kind, mtime = excluded.mtime, size = excluded.size`,
  ).run(key, kind, mtime, size);
}

function storedStamps(
  db: DatabaseSync,
  kind: string,
): Map<string, { mtime: number; size: number }> {
  const rows = db
    .prepare(`SELECT source_key AS sourceKey, mtime, size FROM index_source WHERE kind = ?`)
    .all(kind) as Array<{ sourceKey: string; mtime: number; size: number }>;
  return new Map(rows.map((row) => [row.sourceKey, { mtime: row.mtime, size: row.size }]));
}

function stampsDrifted(
  current: SourceStamp[],
  stored: Map<string, { mtime: number; size: number }>,
): boolean {
  if (current.length !== stored.size) {
    return true;
  }
  for (const row of current) {
    const prev = stored.get(row.key);
    if (!prev || prev.mtime !== row.mtime || prev.size !== row.size) {
      return true;
    }
  }
  return false;
}

function materialsDrifted(db: DatabaseSync, workspaceDir: string): boolean {
  const casesDir = path.join(workspaceDir, "cases");
  if (!fs.existsSync(casesDir)) {
    const n = db.prepare(`SELECT count(*) AS c FROM materials_fts`).get() as { c: number };
    return n.c > 0;
  }
  const existing = new Map(
    (
      db.prepare(`SELECT DISTINCT rel_path AS relPath, mtime FROM materials_fts`).all() as Array<{
        relPath: string;
        mtime: number;
      }>
    ).map((row) => [row.relPath, row.mtime]),
  );
  let seen = 0;
  for (const matterId of fs.readdirSync(casesDir)) {
    const materialsDir = path.join(casesDir, matterId, "materials");
    let names: string[] = [];
    try {
      names = fs.readdirSync(materialsDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith(".")) {
        continue;
      }
      const abs = path.join(materialsDir, name);
      const stamp = fileStamp(abs);
      if (!stamp || stamp.size > 20 * 1024 * 1024) {
        continue;
      }
      seen++;
      const relPath = `cases/${matterId}/materials/${name}`;
      if (existing.get(relPath) !== stamp.mtime) {
        return true;
      }
    }
  }
  return seen !== existing.size;
}

/** 磁盘上的源和索引戳不一致时为 true。只 stat，不读正文。 */
export function workspaceSourcesChanged(db: DatabaseSync, workspaceDir: string): boolean {
  const sourceCount = (db.prepare(`SELECT count(*) AS c FROM index_source`).get() as { c: number })
    .c;
  const indexed =
    (db.prepare(`SELECT count(*) AS c FROM audit_fts`).get() as { c: number }).c +
    (db.prepare(`SELECT count(*) AS c FROM session_fts`).get() as { c: number }).c +
    (db.prepare(`SELECT count(*) AS c FROM knowledge_fts`).get() as { c: number }).c;
  if (sourceCount === 0 && indexed > 0) {
    return true;
  }
  return (
    stampsDrifted(listKnowledgeSourceStamps(workspaceDir), storedStamps(db, "knowledge")) ||
    stampsDrifted(listSessionStamps(workspaceDir), storedStamps(db, "session")) ||
    stampsDrifted(listAuditStamps(workspaceDir), storedStamps(db, "audit")) ||
    materialsDrifted(db, workspaceDir)
  );
}

function recordSourceBaseline(db: DatabaseSync, workspaceDir: string): void {
  db.exec(`DELETE FROM index_source; DELETE FROM index_source_member;`);
  for (const row of listKnowledgeSourceStamps(workspaceDir)) {
    upsertSource(db, "knowledge", row.key, row.mtime, row.size);
  }
  for (const row of listSessionStamps(workspaceDir)) {
    upsertSource(db, "session", row.key, row.mtime, row.size);
  }
  const auditDir = path.join(workspaceDir, "audit");
  const insertMember = db.prepare(
    `INSERT INTO index_source_member(source_key, member_id) VALUES (?, ?)`,
  );
  for (const row of listAuditStamps(workspaceDir)) {
    upsertSource(db, "audit", row.key, row.mtime, row.size);
    const raw = fs.readFileSync(path.join(auditDir, row.key), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const event = JSON.parse(trimmed) as { eventId?: string };
        if (event.eventId) {
          insertMember.run(row.key, event.eventId);
        }
      } catch {
        // 坏行不进成员表
      }
    }
  }
}

function replaceAuditFile(
  db: DatabaseSync,
  workspaceDir: string,
  fileName: string,
  maxRows: number,
): boolean {
  const members = db
    .prepare(`SELECT member_id AS memberId FROM index_source_member WHERE source_key = ?`)
    .all(fileName) as Array<{ memberId: string }>;
  const delEvent = db.prepare(`DELETE FROM audit_fts WHERE event_id = ?`);
  const delMember = db.prepare(`DELETE FROM index_source_member WHERE source_key = ?`);
  for (const member of members) {
    delEvent.run(member.memberId);
  }
  delMember.run(fileName);
  const abs = path.join(workspaceDir, "audit", fileName);
  if (!fs.existsSync(abs)) {
    db.prepare(`DELETE FROM index_source WHERE source_key = ?`).run(fileName);
    return false;
  }
  const matterMap = matterIdByTaskId(workspaceDir);
  const insert = db.prepare(
    `INSERT INTO audit_fts(event_id, task_id, matter_id, kind, body, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertMember = db.prepare(
    `INSERT OR IGNORE INTO index_source_member(source_key, member_id) VALUES (?, ?)`,
  );
  let count = (db.prepare(`SELECT count(*) AS c FROM audit_fts`).get() as { c: number }).c;
  let truncated = false;
  const raw = fs.readFileSync(abs, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (count >= maxRows) {
      truncated = true;
      break;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const event = JSON.parse(trimmed) as {
        eventId?: string;
        taskId?: string;
        kind?: string;
        detail?: string;
        actor?: string;
        actorId?: string;
        timestamp?: string;
      };
      if (!event.eventId || !event.taskId || !event.kind) {
        continue;
      }
      const body = [event.kind, event.detail ?? "", event.actor ?? "", event.actorId ?? ""]
        .join(" ")
        .trim();
      insert.run(
        event.eventId,
        event.taskId,
        matterMap.get(event.taskId) ?? "",
        event.kind,
        body,
        event.timestamp ?? "",
      );
      insertMember.run(fileName, event.eventId);
      count++;
    } catch {
      // 跳过坏行
    }
  }
  return truncated;
}

function replaceSession(
  db: DatabaseSync,
  workspaceDir: string,
  sessionId: string,
  maxRows: number,
): boolean {
  db.prepare(`DELETE FROM session_fts WHERE session_id = ?`).run(sessionId);
  const sessionsDir = path.join(workspaceDir, "sessions");
  const turnsPath = path.join(sessionsDir, `${sessionId}.turns.jsonl`);
  if (!fs.existsSync(turnsPath)) {
    db.prepare(`DELETE FROM index_source WHERE source_key = ?`).run(sessionId);
    return false;
  }
  let matterId = "";
  let sessionUpdated = "";
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(sessionsDir, `${sessionId}.json`), "utf8"),
    ) as {
      matterId?: string;
      updatedAt?: string;
    };
    matterId = meta.matterId?.trim() ?? "";
    sessionUpdated = meta.updatedAt ?? "";
  } catch {
    return false;
  }
  const insert = db.prepare(
    `INSERT INTO session_fts(session_id, turn_id, matter_id, role, body, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let count = (db.prepare(`SELECT count(*) AS c FROM session_fts`).get() as { c: number }).c;
  let truncated = false;
  const raw = fs.readFileSync(turnsPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (count >= maxRows) {
      truncated = true;
      break;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const turn = JSON.parse(trimmed) as {
        turnId?: string;
        instruction?: string;
        result?: string;
        messages?: Array<{ role?: string; content?: string }>;
      };
      const body = extractTurnText(turn);
      if (!body) {
        continue;
      }
      insert.run(sessionId, turn.turnId ?? "", matterId, "turn", body, sessionUpdated);
      count++;
    } catch {
      // 跳过坏行
    }
  }
  return truncated;
}

function syncStampedCorpus(
  db: DatabaseSync,
  kind: "session" | "audit",
  current: SourceStamp[],
  replace: (key: string) => boolean,
): { changed: number; truncated: boolean } {
  const stored = storedStamps(db, kind);
  const currentByKey = new Map(current.map((row) => [row.key, row]));
  let changed = 0;
  let truncated = false;
  for (const [key] of stored) {
    if (!currentByKey.has(key)) {
      truncated = replace(key) || truncated;
      db.prepare(`DELETE FROM index_source WHERE source_key = ?`).run(key);
      changed++;
    }
  }
  const fresh = storedStamps(db, kind);
  for (const row of current) {
    const prev = fresh.get(row.key);
    if (prev && prev.mtime === row.mtime && prev.size === row.size) {
      continue;
    }
    truncated = replace(row.key) || truncated;
    upsertSource(db, kind, row.key, row.mtime, row.size);
    changed++;
    if (truncated) {
      break;
    }
  }
  return { changed, truncated };
}

function refreshIndexCounts(db: DatabaseSync): void {
  const countOf = (table: string) =>
    (db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;
  setMeta(db, "auditRows", String(countOf("audit_fts")));
  setMeta(db, "sessionRows", String(countOf("session_fts")));
  setMeta(db, "knowledgeRows", String(countOf("knowledge_fts")));
  setMeta(db, "materialsRows", String(countOf("materials_fts")));
  setMeta(db, "lastRebuildAt", new Date().toISOString());
}

/**
 * 检索前调用：没有索引时整库建一次，之后只补改过的审计、会话、知识和材料。
 */
export async function syncWorkspaceSearchIndex(
  workspaceDir: string,
  opts?: RebuildIndexOptions,
): Promise<RebuildIndexResult & { mode: "rebuild" | "incremental" }> {
  const started = Date.now();
  if (!indexExists(workspaceDir)) {
    const rebuilt = await rebuildWorkspaceSearchIndex(workspaceDir, opts);
    return { ...rebuilt, mode: "rebuild" };
  }
  const db = openSearchIndexDb(workspaceDir);
  let closed = false;
  const closeDb = () => {
    if (!closed) {
      closed = true;
      db.close();
    }
  };
  try {
    const sourceCount = (
      db.prepare(`SELECT count(*) AS c FROM index_source`).get() as { c: number }
    ).c;
    const indexed =
      (db.prepare(`SELECT count(*) AS c FROM knowledge_fts`).get() as { c: number }).c +
      (db.prepare(`SELECT count(*) AS c FROM audit_fts`).get() as { c: number }).c +
      (db.prepare(`SELECT count(*) AS c FROM session_fts`).get() as { c: number }).c;
    if (sourceCount === 0 && indexed > 0) {
      closeDb();
      const rebuilt = await rebuildWorkspaceSearchIndex(workspaceDir, opts);
      return { ...rebuilt, mode: "rebuild" };
    }
    const maxAudit = opts?.maxAuditRows ?? DEFAULT_MAX_AUDIT;
    const maxSession = opts?.maxSessionRows ?? DEFAULT_MAX_SESSION;
    const knowledge = syncKnowledgeIncremental(
      db,
      workspaceDir,
      opts?.maxKnowledgeRows ?? DEFAULT_MAX_KNOWLEDGE,
    );
    const session = syncStampedCorpus(db, "session", listSessionStamps(workspaceDir), (key) =>
      replaceSession(db, workspaceDir, key, maxSession),
    );
    const audit = syncStampedCorpus(db, "audit", listAuditStamps(workspaceDir), (key) =>
      replaceAuditFile(db, workspaceDir, key, maxAudit),
    );
    await ingestMaterialsIncremental(db, workspaceDir);
    const truncated = knowledge.truncated || session.truncated || audit.truncated;
    if (truncated) {
      setMeta(db, "truncated", "1");
    }
    refreshIndexCounts(db);
    const statusAudit = Number(getMeta(db, "auditRows") ?? "0");
    const statusSession = Number(getMeta(db, "sessionRows") ?? "0");
    const statusKnowledge = Number(getMeta(db, "knowledgeRows") ?? "0");
    const statusMaterials = Number(getMeta(db, "materialsRows") ?? "0");
    return {
      ok: true,
      mode: "incremental",
      auditRows: statusAudit,
      sessionRows: statusSession,
      knowledgeRows: statusKnowledge,
      materialsRows: statusMaterials,
      truncated,
      durationMs: Date.now() - started,
    };
  } finally {
    closeDb();
  }
}
