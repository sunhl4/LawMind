/**
 * Deep-link bus: open another LawMind chat from markdown cites or tool chips.
 */

import type { ChatSessionRef } from "./lawmind-session-link";
import { isSafeLmSessionId } from "./lawmind-session-link";

type Listener = (ref: ChatSessionRef) => void;

const listeners = new Set<Listener>();

export function subscribeOpenChatSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestOpenChatSession(ref: ChatSessionRef): void {
  const sessionId = ref.sessionId.trim();
  if (!isSafeLmSessionId(sessionId)) {
    return;
  }
  const title = ref.title.trim() || sessionId;
  const next: ChatSessionRef = {
    sessionId,
    title,
    ...(ref.matterId?.trim() ? { matterId: ref.matterId.trim() } : {}),
    ...(ref.assistantId?.trim() && isSafeLmSessionId(ref.assistantId.trim())
      ? { assistantId: ref.assistantId.trim() }
      : {}),
  };
  for (const listener of listeners) {
    listener(next);
  }
}
