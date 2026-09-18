/**
 * Follow-up inbox (classifySessionInbox("followup")).
 * Sidecar so a live turn cannot wipe queued next-turn text.
 * Claimed only after the live turn ends — opens a new turn (not mid-turn steer).
 * Compose 「下一轮再发」 uses this; Enter while loading uses steer.
 */

import fs from "node:fs";
import path from "node:path";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";

const MAX_PENDING_FOLLOWUP = 8;
const MAX_FOLLOWUP_CHARS = 8_000;

export function pendingFollowupPath(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, "sessions", `${sessionId}.pending-followup.json`);
}

type PendingFollowupFile = {
  notes: string[];
  updatedAt: string;
};

function readPendingFile(filePath: string): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as PendingFollowupFile;
    if (!Array.isArray(raw.notes)) {
      return [];
    }
    return raw.notes
      .filter((note): note is string => typeof note === "string")
      .map((note) => note.trim())
      .filter((note) => note.length > 0);
  } catch {
    return [];
  }
}

export function normalizeFollowupNote(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_FOLLOWUP_CHARS);
}

export function queuePendingFollowup(
  workspaceDir: string,
  sessionId: string,
  text: string,
): { queued: number; pendingCount: number } {
  const note = normalizeFollowupNote(text);
  if (!note) {
    return {
      queued: 0,
      pendingCount: readPendingFile(pendingFollowupPath(workspaceDir, sessionId)).length,
    };
  }
  const filePath = pendingFollowupPath(workspaceDir, sessionId);
  return withExclusiveFileLock(`${filePath}.lock`, () => {
    const existing = readPendingFile(filePath);
    const next = [...existing, note].slice(-MAX_PENDING_FOLLOWUP);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeJsonAtomic(filePath, {
      notes: next,
      updatedAt: new Date().toISOString(),
    } satisfies PendingFollowupFile);
    return { queued: 1, pendingCount: next.length };
  });
}

export function claimPendingFollowup(workspaceDir: string, sessionId: string): string[] {
  const filePath = pendingFollowupPath(workspaceDir, sessionId);
  return withExclusiveFileLock(`${filePath}.lock`, () => {
    const notes = readPendingFile(filePath);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      /* best-effort */
    }
    return notes;
  });
}

export function peekPendingFollowup(workspaceDir: string, sessionId: string): string[] {
  return readPendingFile(pendingFollowupPath(workspaceDir, sessionId));
}
