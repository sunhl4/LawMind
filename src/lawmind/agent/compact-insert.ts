/**
 * Compact / 红线 notes sit immediately before the last real user message
 * so the static system prefix stays cacheable and the reminder stays in-window.
 */

import type { AgentMessage } from "./types.js";

/** Shared with compact-reinjection — keep the heading text identical. */
export const COMPACT_REINJECTION_MARKER = "压缩后红线重注（仍有效）";

export const COMPACT_SYNTHETIC_USER_MARKERS = [
  "【压缩前对话蒸馏】",
  "【压缩后上下文锚点】",
  "【案件会话摘要】",
  "【案件记忆摘录】",
  COMPACT_REINJECTION_MARKER,
] as const;

export function isCompactSyntheticUserMessage(content: string): boolean {
  const text = content.trim();
  if (!text) {
    return false;
  }
  if (text.includes(COMPACT_REINJECTION_MARKER)) {
    return true;
  }
  return COMPACT_SYNTHETIC_USER_MARKERS.some(
    (marker) => marker !== COMPACT_REINJECTION_MARKER && text.includes(marker),
  );
}

export function findLastRealUserIndex(messages: readonly AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user") {
      continue;
    }
    if (isCompactSyntheticUserMessage(msg.content ?? "")) {
      continue;
    }
    return i;
  }
  return -1;
}

export function insertBeforeLastUserMessage(
  messages: AgentMessage[],
  toInsert: AgentMessage[],
): AgentMessage[] {
  if (toInsert.length === 0) {
    return messages;
  }
  const idx = findLastRealUserIndex(messages);
  if (idx < 0) {
    return [...messages, ...toInsert];
  }
  return [...messages.slice(0, idx), ...toInsert, ...messages.slice(idx)];
}
