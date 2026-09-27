const CHAT_ACTIVE_STORAGE_KEY = "lawmind.chat.activeSession.v1";

/** Stable localStorage partition for browser/E2E (no real workspace path). */
export const BROWSER_DEV_SESSION_STORE_KEY = "__browser_dev__";

type ChatActiveStore = { byWorkspace: Record<string, Record<string, string>> };

/** Map config workspaceDir to a key safe for chat active-session storage. */
export function chatSessionStoreKey(workspaceDir: string | undefined | null): string {
  const raw = workspaceDir?.trim() ?? "";
  if (!raw || raw.startsWith("(")) {
    return BROWSER_DEV_SESSION_STORE_KEY;
  }
  return raw;
}

export function readChatActiveStore(): ChatActiveStore {
  if (typeof window === "undefined") {
    return { byWorkspace: {} };
  }
  try {
    const raw = window.localStorage.getItem(CHAT_ACTIVE_STORAGE_KEY);
    if (!raw?.trim()) {
      return { byWorkspace: {} };
    }
    const parsed = JSON.parse(raw) as ChatActiveStore;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("byWorkspace" in parsed) ||
      typeof parsed.byWorkspace !== "object" ||
      parsed.byWorkspace === null
    ) {
      return { byWorkspace: {} };
    }
    return parsed;
  } catch {
    return { byWorkspace: {} };
  }
}

export function getStoredActiveChatSessionId(
  workspaceDir: string,
  assistantId: string,
): string | undefined {
  const sid = readChatActiveStore().byWorkspace[workspaceDir]?.[assistantId];
  return typeof sid === "string" && sid.trim() ? sid.trim() : undefined;
}

export function persistActiveChatSessionId(
  workspaceDir: string,
  assistantId: string,
  sessionId: string,
): void {
  if (typeof window === "undefined") {
    return;
  }
  const store = readChatActiveStore();
  if (!store.byWorkspace[workspaceDir]) {
    store.byWorkspace[workspaceDir] = {};
  }
  store.byWorkspace[workspaceDir][assistantId] = sessionId;
  window.localStorage.setItem(CHAT_ACTIVE_STORAGE_KEY, JSON.stringify(store));
}

const CHAT_SCOPE_STORAGE_KEY = "lawmind.chat.listScope.v1";

type ChatScopeBucket = { scope: string | null; byScope: Record<string, string> };
type ChatScopeStore = { byWorkspace: Record<string, ChatScopeBucket> };

function readChatScopeStore(): ChatScopeStore {
  if (typeof window === "undefined") {
    return { byWorkspace: {} };
  }
  try {
    const raw = window.localStorage.getItem(CHAT_SCOPE_STORAGE_KEY);
    if (!raw?.trim()) {
      return { byWorkspace: {} };
    }
    const parsed = JSON.parse(raw) as ChatScopeStore;
    if (!parsed || typeof parsed !== "object" || typeof parsed.byWorkspace !== "object" || !parsed.byWorkspace) {
      return { byWorkspace: {} };
    }
    return parsed;
  } catch {
    return { byWorkspace: {} };
  }
}

function writeChatScopeStore(store: ChatScopeStore): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(CHAT_SCOPE_STORAGE_KEY, JSON.stringify(store));
}

function scopeBucketKey(scope: string | null): string {
  const id = scope?.trim() ?? "";
  return id || "__unbound__";
}

/** `undefined`：这台机器还没记过左栏范围。`null`：上次停在未归案。 */
export function readStoredChatListScope(workspaceDir: string): string | null | undefined {
  const bucket = readChatScopeStore().byWorkspace[workspaceDir];
  if (!bucket || !("scope" in bucket)) {
    return undefined;
  }
  if (bucket.scope === null) {
    return null;
  }
  return typeof bucket.scope === "string" && bucket.scope.trim() ? bucket.scope.trim() : null;
}

export function persistChatListScope(workspaceDir: string, scope: string | null): void {
  const store = readChatScopeStore();
  const prev = store.byWorkspace[workspaceDir] ?? { scope: null, byScope: {} };
  store.byWorkspace[workspaceDir] = { ...prev, scope };
  writeChatScopeStore(store);
}

export function getStoredScopeSessionId(
  workspaceDir: string,
  scope: string | null,
): string | undefined {
  const sid = readChatScopeStore().byWorkspace[workspaceDir]?.byScope?.[scopeBucketKey(scope)];
  return typeof sid === "string" && sid.trim() ? sid.trim() : undefined;
}

export function persistScopeSessionId(
  workspaceDir: string,
  scope: string | null,
  sessionId: string,
): void {
  const store = readChatScopeStore();
  const prev = store.byWorkspace[workspaceDir] ?? { scope, byScope: {} };
  store.byWorkspace[workspaceDir] = {
    scope: prev.scope,
    byScope: { ...prev.byScope, [scopeBucketKey(scope)]: sessionId },
  };
  writeChatScopeStore(store);
}

export function clearStoredActiveChatSessionForAssistant(
  workspaceDir: string,
  assistantId: string,
): void {
  if (typeof window === "undefined") {
    return;
  }
  const store = readChatActiveStore();
  if (!store.byWorkspace[workspaceDir]?.[assistantId]) {
    return;
  }
  delete store.byWorkspace[workspaceDir][assistantId];
  window.localStorage.setItem(CHAT_ACTIVE_STORAGE_KEY, JSON.stringify(store));
}

export type ChatSessionListEntry = {
  sessionId: string;
  title: string;
  updatedAt: string;
  lastPreview?: string;
  matterId?: string;
  assistantId?: string;
  /**
   * 这条对话已被「另起新对话（带上文）」承前到哪条。侧栏据此显示「→ 由此续接」，
   * 免得律师在两条几乎同名的对话里点错（见 `src/lawmind/agent/session-carryover.ts`）。
   */
  forkedToSessionId?: string;
};

export function formatDelegationFollowUpBubble(
  item: {
    delegationId: string;
    status: string;
    toAssistant: string;
    result?: string;
    error?: string;
  },
  assistantDisplayById?: Record<string, string>,
): string {
  const ok = item.status === "completed";
  const label = ok ? "【委派结果 · 已自动回传】" : "【委派结果 · 未成功】";
  const body = ok
    ? (item.result ?? "").trim() || "（子助手未返回正文）"
    : (item.error ?? "").trim() || "（无错误详情）";
  const who =
    assistantDisplayById?.[item.toAssistant.trim()]?.trim() || item.toAssistant.trim() || "子助手";
  const statusLabel =
    item.status === "completed"
      ? "已完成"
      : item.status === "failed"
        ? "失败"
        : item.status === "timeout"
          ? "超时"
          : item.status;
  return `${label}\n- 目标助手：**${who}**\n- 状态：**${statusLabel}**\n\n---\n\n${body}`.slice(
    0,
    48_000,
  );
}
