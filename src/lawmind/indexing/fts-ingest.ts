import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readAllAuditLogs } from "../audit/index.js";
import { listTaskRecords } from "../tasks/index.js";
import { ingestKnowledgeRows } from "./fts-ingest-knowledge.js";
import { clearFtsTables, initSearchIndexSchema, setMeta } from "./fts-schema.js";
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
  const truncated = audit.truncated || session.truncated || knowledge.truncated;
  setMeta(db, "schemaVersion", String(SEARCH_INDEX_SCHEMA_VERSION));
  setMeta(db, "lastRebuildAt", new Date().toISOString());
  setMeta(db, "auditRows", String(audit.count));
  setMeta(db, "sessionRows", String(session.count));
  setMeta(db, "knowledgeRows", String(knowledge.count));
  setMeta(db, "truncated", truncated ? "1" : "0");
  db.close();
  return {
    ok: true,
    auditRows: audit.count,
    sessionRows: session.count,
    knowledgeRows: knowledge.count,
    truncated,
    durationMs: Date.now() - started,
  };
}

export function indexExists(workspaceDir: string): boolean {
  return fs.existsSync(searchIndexPath(workspaceDir));
}
