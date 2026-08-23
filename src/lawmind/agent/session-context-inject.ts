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
): { queued: number; pendingCount: number } {
  if (pins.length === 0) {
    return {
      queued: 0,
      pendingCount: readPendingFile(pendingContextPinsPath(workspaceDir, sessionId)).length,
    };
  }
  const filePath = pendingContextPinsPath(workspaceDir, sessionId);
  return withExclusiveFileLock(`${filePath}.lock`, () => {
    const existing = readPendingFile(filePath);
    const next = dedupePins([...existing, ...pins]).slice(0, MAX_PENDING_PINS);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeJsonAtomic(filePath, {
      pins: next,
      updatedAt: new Date().toISOString(),
    } satisfies PendingPinsFile);
    return { queued: pins.length, pendingCount: next.length };
  });
}

export function claimPendingContextPins(
  workspaceDir: string,
  sessionId: string,
): ComposeContextPin[] {
  const filePath = pendingContextPinsPath(workspaceDir, sessionId);
  return withExclusiveFileLock(`${filePath}.lock`, () => {
    const pins = readPendingFile(filePath);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      /* best-effort */
    }
    return pins;
  });
}

export function formatInjectedPinsUserMessage(
  workspaceDir: string,
  pins: ComposeContextPin[],
): string {
  const summary = resolvePinnedContextSummary({ workspaceDir, pins });
  const lines = [
    "【本轮补充材料】律师在本轮推理进行中补充了以下材料，请在后续步骤中使用。可用 read_project_file / read_case_file / analyze_document 读取路径，勿忽略。",
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

export function claimAndApplyPendingContextPins(
  session: AgentSession,
  workspaceDir: string,
): ComposeContextPin[] {
  const pins = claimPendingContextPins(workspaceDir, session.sessionId);
  applyClaimedPinsToHistory(session, workspaceDir, pins);
  return pins;
}
