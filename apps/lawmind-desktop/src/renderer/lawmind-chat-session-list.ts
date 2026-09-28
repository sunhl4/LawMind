import { DEFAULT_CHAT_SESSION_TITLE, type ChatSessionListEntry } from "./lawmind-chat-active-storage";

const PLACEHOLDER_CHAT_TITLES = new Set(["", "New Chat", DEFAULT_CHAT_SESSION_TITLE]);

/** 引擎默认名是英文 New Chat；侧栏对律师显示「新对话」。 */
export function isPlaceholderChatTitle(title: string | undefined): boolean {
  return PLACEHOLDER_CHAT_TITLES.has((title ?? "").trim());
}

export function lawyerChatListTitle(title: string | undefined): string {
  const trimmed = title?.trim() ?? "";
  return isPlaceholderChatTitle(trimmed) ? DEFAULT_CHAT_SESSION_TITLE : trimmed;
}

/** 与会话自动标题同一规则的浏览器侧预览：首段第一句，点发送后立刻写进左栏。 */
export function previewTitleFromUtterance(raw: string): string | undefined {
  const block = raw.replace(/^\uFEFF/, "").trim();
  if (!block) {
    return undefined;
  }
  const firstPara = block.split(/\r?\n\s*\r?\n/)[0]?.trim() ?? block;
  let sentence = firstPara;
  const terminators = /[.!?。！？…]/;
  for (let i = 0; i < firstPara.length; i++) {
    const ch = firstPara[i] ?? "";
    if (terminators.test(ch)) {
      sentence = firstPara.slice(0, i + 1);
      break;
    }
  }
  const collapsed = sentence.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return undefined;
  }
  const clipped = collapsed.length > 72 ? collapsed.slice(0, 72).trimEnd() : collapsed;
  return clipped.length > 0 ? clipped : undefined;
}

export function upsertChatSessionAtFront(
  sessions: readonly ChatSessionListEntry[],
  row: ChatSessionListEntry,
): ChatSessionListEntry[] {
  const existing = sessions.find((item) => item.sessionId === row.sessionId);
  const next =
    existing && !isPlaceholderChatTitle(existing.title) && isPlaceholderChatTitle(row.title)
      ? { ...row, title: existing.title }
      : row;
  return [next, ...sessions.filter((item) => item.sessionId !== row.sessionId)];
}

/** 目录接口仍是「新对话」时，保留律师刚发出的那句标题。 */
export function mergeChatSessionListRefresh(
  previous: readonly ChatSessionListEntry[],
  incoming: readonly ChatSessionListEntry[],
): ChatSessionListEntry[] {
  const prevById = new Map(previous.map((row) => [row.sessionId, row]));
  return incoming.map((row) => {
    const prior = prevById.get(row.sessionId);
    if (prior && isPlaceholderChatTitle(row.title) && !isPlaceholderChatTitle(prior.title)) {
      return { ...row, title: prior.title };
    }
    return row;
  });
}

/**
 * 占位标题才改名。左栏里还没有这条时补上一行，避免要等本轮结束才出现。
 */
export function retitlePlaceholderChatSession(
  sessions: readonly ChatSessionListEntry[],
  sessionId: string,
  utterance: string,
  seed?: { assistantId?: string; matterId?: string | null },
): ChatSessionListEntry[] {
  const id = sessionId.trim();
  const title = previewTitleFromUtterance(utterance);
  if (!id || !title) {
    return sessions as ChatSessionListEntry[];
  }
  const index = sessions.findIndex((row) => row.sessionId === id);
  if (index < 0) {
    const matterId = seed?.matterId?.trim() ?? "";
    const assistantId = seed?.assistantId?.trim() ?? "";
    return upsertChatSessionAtFront(sessions, {
      sessionId: id,
      title,
      updatedAt: new Date().toISOString(),
      ...(matterId ? { matterId } : {}),
      ...(assistantId ? { assistantId } : {}),
    });
  }
  const row = sessions[index];
  if (!row || !isPlaceholderChatTitle(row.title)) {
    return sessions as ChatSessionListEntry[];
  }
  const next = sessions.slice();
  next[index] = { ...row, title };
  return next;
}

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
    title: lawyerChatListTitle(session.title),
    updatedAt: session.updatedAt ?? "",
    lastPreview: typeof session.lastPreview === "string" ? session.lastPreview : undefined,
    ...(matterId ? { matterId } : {}),
    ...(assistantId ? { assistantId } : {}),
    ...(forkedToSessionId ? { forkedToSessionId } : {}),
  };
}
