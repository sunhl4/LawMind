/**
 * Collaboration audit — logs inter-assistant communication events.
 *
 * New writes go to workspace/collaboration-audit/YYYY-MM-DD.jsonl (day-split).
 * Legacy single-file collaboration-audit.jsonl is still read for compatibility.
 */

import fs from "node:fs";
import path from "node:path";
import type { CollaborationEvent } from "./types.js";

const AUDIT_FILE_LEGACY = "collaboration-audit.jsonl";
const AUDIT_DIR = "collaboration-audit";

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayFilePath(workspaceDir: string, day: string): string {
  return path.join(workspaceDir, AUDIT_DIR, `${day}.jsonl`);
}

export function emitCollaborationEvent(workspaceDir: string, event: CollaborationEvent): void {
  try {
    const filePath = dayFilePath(workspaceDir, todayStamp());
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(event) + "\n", "utf8");
  } catch {
    /* best-effort audit; do not block agent operation */
  }
}

function readJsonlFile(filePath: string): CollaborationEvent[] {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CollaborationEvent);
  } catch {
    return [];
  }
}

export function readCollaborationEvents(workspaceDir: string): CollaborationEvent[] {
  const out: CollaborationEvent[] = [];
  const legacy = path.join(workspaceDir, AUDIT_FILE_LEGACY);
  out.push(...readJsonlFile(legacy));
  const dir = path.join(workspaceDir, AUDIT_DIR);
  try {
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".jsonl"))
      .toSorted();
    // 默认只合并最近 120 天，避免多年协作日志一次读完
    const selected = files.length > 120 ? files.slice(-120) : files;
    for (const name of selected) {
      out.push(...readJsonlFile(path.join(dir, name)));
    }
  } catch {
    /* no day-split dir yet */
  }
  return out.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function readCollaborationEventsSince(
  workspaceDir: string,
  since: string,
): CollaborationEvent[] {
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) {
    return readCollaborationEvents(workspaceDir);
  }
  return readCollaborationEvents(workspaceDir).filter((e) => Date.parse(e.timestamp) >= sinceMs);
}
