import type { ChatSessionListEntry } from "./lawmind-chat-active-storage";

/** 侧栏「未归案」在本地存储里的键。界面上用 null 表示这一档。 */
export const UNBOUND_CHAT_SCOPE_KEY = "__unbound__";

export function chatScopeStorageKey(scope: string | null): string {
  const id = scope?.trim() ?? "";
  return id || UNBOUND_CHAT_SCOPE_KEY;
}

/**
 * 列表上的一档。`knownMatterIds === null` 表示案件目录还没加载完，
 * 此时不把「目录里没有的案件号」当成已删除。
 */
export function chatScopeForMatterId(
  matterId: string | null | undefined,
  knownMatterIds: ReadonlySet<string> | null,
): string | null {
  const id = matterId?.trim() ?? "";
  if (!id) {
    return null;
  }
  if (knownMatterIds && !knownMatterIds.has(id)) {
    return null;
  }
  return id;
}

export function isSessionInChatScope(
  session: { matterId?: string | null },
  scope: string | null,
  knownMatterIds: ReadonlySet<string> | null,
): boolean {
  return chatScopeForMatterId(session.matterId, knownMatterIds) === scope;
}

export function countUnboundChatSessions(
  sessions: readonly { matterId?: string | null }[],
  knownMatterIds: ReadonlySet<string> | null,
): number {
  return sessions.filter((session) => chatScopeForMatterId(session.matterId, knownMatterIds) === null)
    .length;
}

function byUpdatedDesc(a: { updatedAt: string }, b: { updatedAt: string }): number {
  return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
}

/**
 * 在某一档里选要打开的对话。指定助手时只看该助手的场次。
 * 没有对话时返回 undefined：调用方留空白，不要自动新建。
 */
export function pickChatSessionForScope<
  T extends { sessionId: string; updatedAt: string; assistantId?: string; matterId?: string | null },
>(
  sessions: readonly T[],
  scope: string | null,
  knownMatterIds: ReadonlySet<string> | null,
  opts?: { storedSessionId?: string; assistantId?: string },
): T | undefined {
  let rows = sessions.filter((session) => isSessionInChatScope(session, scope, knownMatterIds));
  const assistantId = opts?.assistantId?.trim();
  if (assistantId) {
    rows = rows.filter((session) => (session.assistantId?.trim() || "") === assistantId);
  }
  rows = [...rows].toSorted(byUpdatedDesc);
  const stored = opts?.storedSessionId?.trim();
  if (stored) {
    const hit = rows.find((session) => session.sessionId === stored);
    if (hit) {
      return hit;
    }
  }
  return rows[0];
}

/** 冷启动还没有记过范围时，用上次那场对话（否则用最近一场）所在的档。 */
export function inferInitialChatScope(
  sessions: readonly ChatSessionListEntry[],
  storedSessionId: string | undefined,
  knownMatterIds: ReadonlySet<string> | null,
): string | null {
  const stored = storedSessionId
    ? sessions.find((session) => session.sessionId === storedSessionId)
    : undefined;
  const seed = stored ?? [...sessions].toSorted(byUpdatedDesc)[0];
  if (!seed) {
    return null;
  }
  return chatScopeForMatterId(seed.matterId, knownMatterIds);
}
