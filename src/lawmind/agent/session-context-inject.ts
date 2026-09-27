/**
 * Mid-turn inject inbox (classifySessionInbox("inject")).
 * Sidecar so saveSession during a turn cannot wipe pins.
 * Claimed only at the start of a model round (after prior tool results, before the next fetch).
 * Same-turn pins. Does not open a new turn.
 */

import fs from "node:fs";
import path from "node:path";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";
import {
  makeContextPinId,
  parseContextPins,
  type ComposeContextPin,
} from "../platform/compose-context-pin.js";
import { resolvePinnedContextSummary } from "../runtime/pinned-context.js";
import { claimSidecarBatch } from "./session-sidecar-claim.js";
import type { AgentSession } from "./types.js";

const MAX_PENDING_PINS = 16;

export function pendingContextPinsPath(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, "sessions", `${sessionId}.pending-pins.json`);
}

type PendingPinsFile = {
  pins: ComposeContextPin[];
  updatedAt: string;
};

function readPendingFile(filePath: string): ComposeContextPin[] {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as PendingPinsFile;
    const parsed = parseContextPins(raw.pins);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dedupePins(pins: ComposeContextPin[]): ComposeContextPin[] {
  const seen = new Set<string>();
  const out: ComposeContextPin[] = [];
  for (const pin of pins) {
    const id = makeContextPinId(pin);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(pin);
  }
  return out;
}

export function queuePendingContextPins(
  workspaceDir: string,
  sessionId: string,
  pins: ComposeContextPin[],
): { queued: number; pendingCount: number; dropped: number } {
  if (pins.length === 0) {
    return {
      queued: 0,
      pendingCount: readPendingFile(pendingContextPinsPath(workspaceDir, sessionId)).length,
      dropped: 0,
    };
  }
  const filePath = pendingContextPinsPath(workspaceDir, sessionId);
  return withExclusiveFileLock(`${filePath}.lock`, () => {
    const existing = readPendingFile(filePath);
    const merged = dedupePins([...existing, ...pins]);
    // Latest pin wins. Dropping the head used to discard the file the lawyer just added.
    const next = merged.slice(-MAX_PENDING_PINS);
    const dropped = merged.length - next.length;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeJsonAtomic(filePath, {
      pins: next,
      updatedAt: new Date().toISOString(),
    } satisfies PendingPinsFile);
    return { queued: pins.length, pendingCount: next.length, dropped };
  });
}

export function appendContextPins(
  current: ComposeContextPin[] | undefined,
  extra: ComposeContextPin[],
): ComposeContextPin[] {
  return dedupePins([...(current ?? []), ...extra]);
}

export function claimPendingContextPins(
  workspaceDir: string,
  sessionId: string,
  opts?: { alreadyApplied?: (pins: ComposeContextPin[]) => boolean },
): ComposeContextPin[] {
  return claimSidecarBatch({
    filePath: pendingContextPinsPath(workspaceDir, sessionId),
    read: readPendingFile,
    alreadyApplied: opts?.alreadyApplied ?? (() => true),
  });
}

export function formatInjectedPinsUserMessage(
  workspaceDir: string,
  pins: ComposeContextPin[],
): string {
  const summary = resolvePinnedContextSummary({ workspaceDir, pins });
  const lines = [
    "【本轮补充材料】律师在本轮推理进行中补充了以下材料，请在后续步骤中使用。可用 list_dir / read_project_file / read_case_file / analyze_document 读取路径，勿忽略。",
  ];
  if (summary.evidence.length > 0) {
    lines.push("", ...summary.evidence.map((item) => `- ${item}`));
  }
  if (summary.markdownBlock?.trim()) {
    lines.push("", summary.markdownBlock.trim());
  }
  return lines.join("\n");
}

/** Append claimed pins as a user note. Call only at model-round start (not between tool_calls and tool results). */
export function applyClaimedPinsToHistory(
  session: AgentSession,
  workspaceDir: string,
  pins: ComposeContextPin[],
): boolean {
  if (pins.length === 0) {
    return false;
  }
  session.conversationHistory.push({
    role: "user",
    content: formatInjectedPinsUserMessage(workspaceDir, pins),
    timestamp: new Date().toISOString(),
  });
  return true;
}

function historyHasPins(
  session: AgentSession,
  workspaceDir: string,
  pins: ComposeContextPin[],
): boolean {
  const expected = formatInjectedPinsUserMessage(workspaceDir, pins);
  return session.conversationHistory.some((m) => m.role === "user" && m.content === expected);
}

export function claimAndApplyPendingContextPins(
  session: AgentSession,
  workspaceDir: string,
): ComposeContextPin[] {
  const pins = claimPendingContextPins(workspaceDir, session.sessionId, {
    alreadyApplied: (held) => historyHasPins(session, workspaceDir, held),
  });
  applyClaimedPinsToHistory(session, workspaceDir, pins);
  return pins;
}
