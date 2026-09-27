/**
 * Mid-turn steer inbox (classifySessionInbox("steer")).
 * Sidecar so saveSession during a turn cannot wipe notes.
 * Claimed only at the start of a model round (after prior tool results, before the next fetch).
 * Same-turn: next model sample. Does not open a new turn. Compose Enter while loading uses this.
 */

import fs from "node:fs";
import path from "node:path";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { claimSidecarBatch } from "./session-sidecar-claim.js";
import type { AgentSession } from "./types.js";

const MAX_PENDING_STEER = 8;
const MAX_STEER_CHARS = 2_000;

export function pendingSteerPath(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, "sessions", `${sessionId}.pending-steer.json`);
}

type PendingSteerFile = {
  notes: string[];
  updatedAt: string;
};

function readPendingFile(filePath: string): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as PendingSteerFile;
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

const STEER_TRUNCATION_MARK = "…（后文已截断）";

/** Keep paragraph breaks. Legal corrections are often one clause per line. */
export function normalizeSteerNote(text: string): { text: string; truncated: boolean } {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= MAX_STEER_CHARS) {
    return { text: cleaned, truncated: false };
  }
  const keep = Math.max(0, MAX_STEER_CHARS - STEER_TRUNCATION_MARK.length);
  return { text: `${cleaned.slice(0, keep)}${STEER_TRUNCATION_MARK}`, truncated: true };
}

export function queuePendingSteer(
  workspaceDir: string,
  sessionId: string,
  text: string,
): { queued: number; pendingCount: number; dropped: number; truncated: boolean } {
  const normalized = normalizeSteerNote(text);
  const note = normalized.text;
  if (!note) {
    return {
      queued: 0,
      pendingCount: readPendingFile(pendingSteerPath(workspaceDir, sessionId)).length,
      dropped: 0,
      truncated: false,
    };
  }
  const filePath = pendingSteerPath(workspaceDir, sessionId);
  return withExclusiveFileLock(`${filePath}.lock`, () => {
    const existing = readPendingFile(filePath);
    const combined = [...existing, note];
    const next = combined.slice(-MAX_PENDING_STEER);
    const dropped = combined.length - next.length;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeJsonAtomic(filePath, {
      notes: next,
      updatedAt: new Date().toISOString(),
    } satisfies PendingSteerFile);
    return { queued: 1, pendingCount: next.length, dropped, truncated: normalized.truncated };
  });
}

export function claimPendingSteer(
  workspaceDir: string,
  sessionId: string,
  opts?: { alreadyApplied?: (notes: string[]) => boolean },
): string[] {
  return claimSidecarBatch({
    filePath: pendingSteerPath(workspaceDir, sessionId),
    read: readPendingFile,
    alreadyApplied: opts?.alreadyApplied ?? (() => true),
  });
}

export function formatSteerUserMessage(notes: string[]): string {
  const body =
    notes.length === 1 ? notes[0] : notes.map((note, index) => `${index + 1}. ${note}`).join("\n");
  return `【律师中途指示】请按以下纠正调整后续步骤，勿忽略。\n\n${body}`;
}

/** Append claimed steer as a user note. Call only at model-round start (not between tool_calls and tool results). */
export function applyClaimedSteerToHistory(session: AgentSession, notes: string[]): boolean {
  if (notes.length === 0) {
    return false;
  }
  session.conversationHistory.push({
    role: "user",
    content: formatSteerUserMessage(notes),
    timestamp: new Date().toISOString(),
  });
  return true;
}

function historyHasSteer(session: AgentSession, notes: string[]): boolean {
  const expected = formatSteerUserMessage(notes);
  return session.conversationHistory.some((m) => m.role === "user" && m.content === expected);
}

export function claimAndApplyPendingSteer(session: AgentSession, workspaceDir: string): string[] {
  const notes = claimPendingSteer(workspaceDir, session.sessionId, {
    alreadyApplied: (held) => historyHasSteer(session, held),
  });
  applyClaimedSteerToHistory(session, notes);
  return notes;
}
