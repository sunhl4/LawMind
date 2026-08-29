/**
 * Cursor-style session message surgery: truncate / delete Q&A pairs by UI index.
 * UI indices match `sessionHistoryToSimpleMessages` (user/assistant bubbles only).
 */

import type { AgentMessage, AgentSession } from "./types.js";

export type UiHistoryMapEntry = {
  uiIndex: number;
  historyIndex: number;
  role: "user" | "assistant";
};

/** Map desktop bubble indices → conversationHistory indices (same filter as simple messages). */
export function listUiHistoryMap(session: AgentSession): UiHistoryMapEntry[] {
  const out: UiHistoryMapEntry[] = [];
  let uiIndex = 0;
  for (let historyIndex = 0; historyIndex < session.conversationHistory.length; historyIndex++) {
    const msg = session.conversationHistory[historyIndex];
    if (msg.role !== "user" && msg.role !== "assistant") {
      continue;
    }
    const text = (msg.content ?? "").trim();
    if (!text && !msg.liveTrace?.steps?.length) {
      continue;
    }
    out.push({ uiIndex, historyIndex, role: msg.role });
    uiIndex += 1;
  }
  return out;
}

function lastAssistantHistoryIndex(history: AgentMessage[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "assistant") {
      return i;
    }
  }
  return -1;
}

/**
 * Pending tool-approval / clarification is always attached to the last assistant bubble.
 * Clear it when that assistant (or every assistant) is removed by truncate/delete.
 */
function clearPendingIfLastAssistantRemoved(
  session: AgentSession,
  lastAssistantBefore: number,
  removedStart: number,
  removedEndExclusive: number,
): void {
  const lastAssistantGone =
    lastAssistantBefore >= 0 &&
    lastAssistantBefore >= removedStart &&
    lastAssistantBefore < removedEndExclusive;
  const hasAssistant = session.conversationHistory.some((m) => m.role === "assistant");
  if (lastAssistantGone || !hasAssistant) {
    session.pendingRequiresAction = undefined;
    session.pendingClarificationKeys = undefined;
  }
}

/**
 * Remove from the given UI bubble onward (inclusive), keeping earlier history.
 * Used for in-place edit → resend (Cursor-style).
 */
export function truncateSessionFromUiIndex(
  session: AgentSession,
  fromUiIndex: number,
): { ok: true; removedCount: number } | { ok: false; error: string } {
  if (!Number.isInteger(fromUiIndex) || fromUiIndex < 0) {
    return { ok: false, error: "invalid_from_ui_index" };
  }
  const map = listUiHistoryMap(session);
  const entry = map.find((e) => e.uiIndex === fromUiIndex);
  if (!entry) {
    return { ok: false, error: "ui_index_out_of_range" };
  }
  const lastAssistantBefore = lastAssistantHistoryIndex(session.conversationHistory);
  const before = session.conversationHistory.length;
  const removedStart = entry.historyIndex;
  session.conversationHistory = session.conversationHistory.slice(0, removedStart);
  clearPendingIfLastAssistantRemoved(session, lastAssistantBefore, removedStart, before);
  return { ok: true, removedCount: before - session.conversationHistory.length };
}

/**
 * Delete a user instruction and its immediate assistant answer (and intervening tool rows).
 * Later turns are kept. If `uiIndex` points at an assistant bubble, deletes that assistant only.
 */
export function deleteSessionMessagePairAtUiIndex(
  session: AgentSession,
  uiIndex: number,
): { ok: true; removedCount: number } | { ok: false; error: string } {
  if (!Number.isInteger(uiIndex) || uiIndex < 0) {
    return { ok: false, error: "invalid_ui_index" };
  }
  const map = listUiHistoryMap(session);
  const entry = map.find((e) => e.uiIndex === uiIndex);
  if (!entry) {
    return { ok: false, error: "ui_index_out_of_range" };
  }

  let startHist = entry.historyIndex;
  let endHistExclusive = entry.historyIndex + 1;

  if (entry.role === "user") {
    const next = map.find((e) => e.uiIndex === uiIndex + 1);
    if (next?.role === "assistant") {
      endHistExclusive = next.historyIndex + 1;
    } else {
      // Include trailing tool/system rows until next UI bubble or end.
      const following = map.find((e) => e.uiIndex > uiIndex);
      endHistExclusive = following ? following.historyIndex : session.conversationHistory.length;
    }
  } else if (entry.role === "assistant") {
    // Also drop preceding tool rows after previous UI bubble.
    const prev = [...map].toReversed().find((e) => e.uiIndex < uiIndex);
    startHist = prev ? prev.historyIndex + 1 : entry.historyIndex;
    endHistExclusive = entry.historyIndex + 1;
  }

  const lastAssistantBefore = lastAssistantHistoryIndex(session.conversationHistory);
  const before = session.conversationHistory.length;
  const nextHistory: AgentMessage[] = [
    ...session.conversationHistory.slice(0, startHist),
    ...session.conversationHistory.slice(endHistExclusive),
  ];
  session.conversationHistory = nextHistory;
  clearPendingIfLastAssistantRemoved(session, lastAssistantBefore, startHist, endHistExclusive);
  return { ok: true, removedCount: before - session.conversationHistory.length };
}
