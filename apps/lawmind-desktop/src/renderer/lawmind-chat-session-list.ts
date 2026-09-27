import { DEFAULT_CHAT_SESSION_TITLE, type ChatSessionListEntry } from "./lawmind-chat-active-storage";

export type ChatSessionListWire = {
  sessionId?: string;
  title?: string;
  updatedAt?: string;
  lastPreview?: string;
  matterId?: string | null;
  assistantId?: string;
  forkedToSessionId?: string;
};

export function mapChatSessionListPayload(
  sessions: ChatSessionListWire[] | undefined,
): ChatSessionListEntry[] | null {
  if (!Array.isArray(sessions)) {
    return null;
  }
  return sessions
    .map((session) => mapChatSessionListRow(session))
    .filter((session): session is ChatSessionListEntry => session !== null);
}

export function mapChatSessionListRow(session: ChatSessionListWire): ChatSessionListEntry | null {
  const sessionId = session.sessionId?.trim() ?? "";
  if (!sessionId) {
    return null;
  }
  const matterId = session.matterId?.trim() ?? "";
  const assistantId = session.assistantId?.trim() ?? "";
  const forkedToSessionId = session.forkedToSessionId?.trim() ?? "";
  return {
    sessionId,
    title: session.title?.trim() ? session.title.trim() : DEFAULT_CHAT_SESSION_TITLE,
    updatedAt: session.updatedAt ?? "",
    lastPreview: typeof session.lastPreview === "string" ? session.lastPreview : undefined,
    ...(matterId ? { matterId } : {}),
    ...(assistantId ? { assistantId } : {}),
    ...(forkedToSessionId ? { forkedToSessionId } : {}),
  };
}
