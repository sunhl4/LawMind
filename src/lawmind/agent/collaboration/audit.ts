/**
 * Collaboration audit — logs inter-assistant communication events.
 *
 * Events are appended to workspace/collaboration-audit.jsonl for full
 * provenance tracking. Lawyers can see which assistant produced which
 * insight and who reviewed it.
 */

import fs from "node:fs";
import path from "node:path";
import type { CollaborationEvent } from "./types.js";

const AUDIT_FILE = "collaboration-audit.jsonl";

export function emitCollaborationEvent(workspaceDir: string, event: CollaborationEvent): void {
  try {
    const filePath = path.join(workspaceDir, AUDIT_FILE);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(event) + "\n", "utf8");
  } catch {
    /* best-effort audit; do not block agent operation */
  }
}

export function readCollaborationEvents(workspaceDir: string): CollaborationEvent[] {
  const filePath = path.join(workspaceDir, AUDIT_FILE);
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
