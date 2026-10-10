import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { parseConversationSearchQuery } from "../../../../src/lawmind/agent/conversation-search-query.ts";
import {
  chatScopeForMatterId,
  countUnboundChatSessions,
  isSessionInChatScope,
} from "./lawmind-chat-scope";
import { fetchApiJson } from "./api-client-proxy";
import {
  isChatSearchFocusHotkey,
  LAWMIND_FOCUS_CHAT_SEARCH_EVENT,
} from "./lawmind-chat-search-focus";
import { isSafeLmSessionId } from "./lawmind-session-link";
import { useRunningChatSessionIds } from "./lawmind-live-turns";
import {
  chatSessionDeleteLabel,
  chatSessionListKeyAction,
  resolveChatSessionContextTarget,
  useChatSessionMultiSelect,
} from "./lawmind-chat-session-selection";

export type SideChatSessionRow = {
  sessionId: string;
  title: string;
  lastPreview?: string;
  matterId?: string;
  assistantId?: string;
  /** 已被「另起新对话（带上文）」承前到哪条（见 `session-carryover.ts`）。 */
  forkedToSessionId?: string;
};

export type LawmindSideChatSessionsProps = {
  sessions: SideChatSessionRow[];
  activeSessionId?: string;
  loading?: boolean;
  apiBase?: string;
  /** Kept for callers; search is workspace-wide like the agent tool. */
  assistantId?: string;
  /** 不传表示不过滤。null 是「未归案」。 */
  scopeMatterId?: string | null;
  knownMatterIds?: ReadonlySet<string> | null;
  matterTitleById?: Record<string, string>;
  assistantDisplayById?: Record<string, string>;
  onShowUnbound?: () => void;
  onSelect: (sessionId: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  onRename: (sessionId: string, title: string) => void | Promise<void>;
  onDelete: (sessionId: string | readonly string[]) => void | Promise<void>;
};

export function filterSideChatSessions(
  sessions: SideChatSessionRow[],
  query: string,
): SideChatSessionRow[] {
  const parsed = parseConversationSearchQuery(query);
  const tokens = [...parsed.phrases, ...parsed.keywords];
  if (tokens.length === 0) {
    // Relative-only queries (e.g. 「上周」) keep showing the list until the engine returns.
    return sessions;
  }
  return sessions.filter((row) => {
    const hay = `${row.title} ${row.lastPreview ?? ""}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

export function mergeSideChatSearchRows(
  remote: SideChatSessionRow[] | null,
  local: SideChatSessionRow[],
): SideChatSessionRow[] {
  const primary = remote ?? [];
  const seen = new Set(primary.map((r) => r.sessionId));
  return [...primary, ...local.filter((r) => !seen.has(r.sessionId))];
}

const LIVE_CHAT_PLACEHOLDER_TITLE = "新对话";

/**
 * 当前这场、以及正在办的对话，不因案件筛选或列表还没刷新而从左栏消失。
 * 点加号后即使目录接口还没带回这条，也先占一行。
 */
export function pinLiveSideChatSessions(
  sessions: readonly SideChatSessionRow[],
  scoped: readonly SideChatSessionRow[],
  live: { activeSessionId?: string; runningSessionIds: ReadonlySet<string> },
): SideChatSessionRow[] {
  const byId = new Map(sessions.map((row) => [row.sessionId, row]));
  const visible = [...scoped];
  const seen = new Set(visible.map((row) => row.sessionId));
  const ensure = (id: string | undefined) => {
    const sessionId = id?.trim() ?? "";
    if (!sessionId || seen.has(sessionId)) {
      return;
    }
    seen.add(sessionId);
    visible.unshift(byId.get(sessionId) ?? { sessionId, title: LIVE_CHAT_PLACEHOLDER_TITLE });
  };
  for (const id of live.runningSessionIds) {
    ensure(id);
  }
  ensure(live.activeSessionId);
  return visible;
}

type ContextMenuState = {
  x: number;
  y: number;
  sessionId: string;
  title: string;
  actionIds: string[];
};

function deleteTarget(ids: readonly string[]): string | readonly string[] {
  return ids.length === 1 ? (ids[0] ?? "") : ids;
}

function eventTargetIsField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/**
 * Left-rail chat list (Cursor-style): primary section under 工作区 / 案件材料 / 当前案件。
 */
export function LawmindSideChatSessions(props: LawmindSideChatSessionsProps): ReactNode {
  const {
    sessions,
    activeSessionId,
    loading,
    apiBase,
    onSelect,
    onNewChat,
    onRename,
    onDelete,
    scopeMatterId,
    knownMatterIds = null,
    matterTitleById,
    assistantDisplayById,
    onShowUnbound,
  } = props;
  const [sectionOpen, setSectionOpen] = useState(true);
  /** 对话优先：搜索默认收起，⌘⇧O / 点「搜」再展开。 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteHits, setRemoteHits] = useState<SideChatSessionRow[] | null>(null);
  const [remotePending, setRemotePending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const runningSessionIds = useRunningChatSessionIds();

  useEffect(() => {
    if (!editingId) {
      return undefined;
    }
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [editingId]);

  const focusSearch = useCallback(() => {
    setSectionOpen(true);
    setSearchOpen(true);
    window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
  }, []);

  useEffect(() => {
    const onFocusSearch = () => {
      focusSearch();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!isChatSearchFocusHotkey(e)) {
        return;
      }
      e.preventDefault();
      focusSearch();
    };
    window.addEventListener(LAWMIND_FOCUS_CHAT_SEARCH_EVENT, onFocusSearch);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(LAWMIND_FOCUS_CHAT_SEARCH_EVENT, onFocusSearch);
      window.removeEventListener("keydown", onKey);
    };
  }, [focusSearch]);

  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) {
      return;
    }
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    let x = contextMenu.x;
    let y = contextMenu.y;
    if (x + rect.width > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (y + rect.height > window.innerHeight - 8) {
      y = Math.max(8, window.innerHeight - rect.height - 8);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) {
        return;
      }
      setContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [contextMenu]);

  const scopedSessions = useMemo(() => {
    if (scopeMatterId === undefined) {
      return sessions;
    }
    return sessions.filter((row) => isSessionInChatScope(row, scopeMatterId, knownMatterIds));
  }, [knownMatterIds, scopeMatterId, sessions]);
  const unboundCount = useMemo(
    () => (scopeMatterId ? countUnboundChatSessions(sessions, knownMatterIds) : 0),
    [knownMatterIds, scopeMatterId, sessions],
  );
  const showAssistantBadge = useMemo(() => {
    const ids = new Set(
      scopedSessions.map((row) => row.assistantId?.trim()).filter((id): id is string => Boolean(id)),
    );
    return ids.size > 1;
  }, [scopedSessions]);
  const localMatches = useMemo(
    () => filterSideChatSessions(query.trim() ? sessions : scopedSessions, query),
    [query, scopedSessions, sessions],
  );
  const shown =
    query.trim() === ""
      ? pinLiveSideChatSessions(sessions, scopedSessions, {
          activeSessionId,
          runningSessionIds,
        })
      : mergeSideChatSearchRows(remoteHits, localMatches);
  const shownIds = useMemo(() => shown.map((row) => row.sessionId), [shown]);
  const selection = useChatSessionMultiSelect(shownIds, activeSessionId);
  const showEmpty =
    query.trim().length > 0 && shown.length === 0 && sessions.length > 0 && !remotePending;

  useEffect(() => {
    const q = query.trim();
    const base = apiBase?.trim();
    if (!base || q.length < 2) {
      setRemoteHits(null);
      setRemotePending(false);
      return undefined;
    }
    setRemotePending(true);
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      const params = new URLSearchParams({ q });
      void fetchApiJson<{
        ok?: boolean;
        sessions?: Array<{
          sessionId: string;
          title?: string;
          lastPreview?: string;
          matterId?: string | null;
          assistantId?: string;
          forkedToSessionId?: string;
        }>;
      }>(`${base}/api/sessions/search?${params.toString()}`, { signal: ac.signal }, { tag: "chat-sessions:search" })
        .then((body) => {
          if (ac.signal.aborted) {
            return;
          }
          const rows = Array.isArray(body.sessions) ? body.sessions : [];
          setRemoteHits(
            rows
              .filter((s) => isSafeLmSessionId(s.sessionId))
              .map((s) => ({
                sessionId: s.sessionId,
                title: typeof s.title === "string" && s.title.trim() ? s.title : s.sessionId,
                lastPreview: typeof s.lastPreview === "string" ? s.lastPreview : undefined,
                matterId: s.matterId?.trim() || undefined,
                assistantId: s.assistantId?.trim() || undefined,
                forkedToSessionId: s.forkedToSessionId?.trim() || undefined,
              })),
          );
          setRemotePending(false);
        })
        .catch(() => {
          if (!ac.signal.aborted) {
            setRemotePending(false);
          }
        });
    }, 220);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [apiBase, query]);

  const startRename = useCallback((sessionId: string, title: string) => {
    setDraftTitle(title);
    setEditingId(sessionId);
  }, []);

  const commitRename = useCallback(async () => {
    if (!editingId) {
      return;
    }
    const next = draftTitle.trim();
    setEditingId(null);
    if (!next) {
      return;
    }
    await onRename(editingId, next);
  }, [draftTitle, editingId, onRename]);

  const openContextMenu = useCallback(
    (e: ReactMouseEvent, row: SideChatSessionRow) => {
      e.preventDefault();
      e.stopPropagation();
      selection.markContextMenu();
      const target = resolveChatSessionContextTarget(selection.selectedIds, row.sessionId);
      if (target.replaceSelection) {
        selection.selectOnly(row.sessionId);
        void onSelect(row.sessionId);
      }
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        sessionId: row.sessionId,
        title: row.title,
        actionIds: target.actionIds,
      });
    },
    [onSelect, selection],
  );

  const deleteSessions = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) {
        return;
      }
      void onDelete(deleteTarget(ids));
    },
    [onDelete],
  );

  return (
    <div className="lm-side-chat-sessions" data-testid="lm-side-chat-sessions">
      <div className="lm-fs-dual-root-header lm-side-chat-sessions-header">
        <button
          type="button"
          className="lm-fs-dual-expander"
          aria-expanded={sectionOpen}
          aria-label={`${sectionOpen ? "折叠" : "展开"}对话`}
          title={sectionOpen ? "折叠" : "展开"}
          onClick={() => setSectionOpen((v) => !v)}
        >
          <span className={`lm-fs-arrow ${sectionOpen ? "open" : ""}`} aria-hidden>
            ▸
          </span>
        </button>
        <div className="lm-fs-dual-header-body lm-side-chat-sessions-heading">
          <span
            className="lm-section-label"
            role="button"
            tabIndex={0}
            onClick={() => setSectionOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSectionOpen((v) => !v);
              }
            }}
          >
            对话
          </span>
          {searchOpen ? (
            <input
              ref={searchInputRef}
              className="lm-sidebar-search lm-side-chat-sessions-search"
              type="search"
              value={query}
              placeholder="搜索对话…"
              aria-label="筛选对话"
              data-testid="lm-side-chat-search"
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  if (query.trim()) {
                    setQuery("");
                    setRemoteHits(null);
                  } else {
                    setSearchOpen(false);
                  }
                }
              }}
            />
          ) : null}
          {runningSessionIds.size > 0 ? (
            <span className="lm-side-chat-running-count" title="这些对话同时在办，互不等待">
              {runningSessionIds.size} 在办
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="lm-side-chat-search-toggle"
          aria-label={searchOpen ? "关闭搜索" : "搜索对话"}
          aria-pressed={searchOpen}
          title="搜索对话（⌘⇧O）"
          data-testid="lm-side-chat-search-toggle"
          onClick={(e) => {
            e.stopPropagation();
            if (searchOpen) {
              setSearchOpen(false);
              setQuery("");
              setRemoteHits(null);
            } else {
              focusSearch();
            }
          }}
        >
          搜
        </button>
        <button
          type="button"
          className="lm-fs-root-add"
          title={
            runningSessionIds.size > 0
              ? "新建对话。正在办的那些会继续，不用等它们结束"
              : "新建对话"
          }
          aria-label="新建对话"
          disabled={Boolean(loading)}
          onClick={() => void onNewChat()}
        >
          ＋
        </button>
      </div>

      {sectionOpen ? (
        <div className="lm-side-chat-sessions-body">
          {selection.selectedIds.length > 1 ? (
            <div className="lm-side-chat-session-batch" data-testid="lm-side-chat-session-batch">
              <span>已选 {selection.selectedIds.length}</span>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-small lm-side-chat-session-batch-delete"
                onClick={() => deleteSessions(selection.selectedIds)}
              >
                删除
              </button>
            </div>
          ) : null}
          <div
            className="lm-side-chat-sessions-list lm-scroll"
            role="listbox"
            aria-multiselectable="true"
            aria-label="对话列表"
            title="Shift 连选，Ctrl 或 ⌘ 加选"
            onKeyDown={(e) => {
              const action = chatSessionListKeyAction(
                {
                  key: e.key,
                  metaKey: e.metaKey,
                  ctrlKey: e.ctrlKey,
                  altKey: e.altKey,
                  shiftKey: e.shiftKey,
                  targetIsField: eventTargetIsField(e.target),
                },
                selection.selectedIds.length,
              );
              if (action === "none") {
                return;
              }
              e.preventDefault();
              if (action === "select-all") {
                selection.selectAll();
                return;
              }
              if (action === "collapse") {
                selection.collapseTo(activeSessionId);
                return;
              }
              deleteSessions(selection.selectedIds);
            }}
          >
            {loading && sessions.length === 0 ? (
              <p className="lm-meta lm-side-chat-sessions-empty">加载中…</p>
            ) : null}
            {!loading && shown.length === 0 && sessions.length === 0 ? (
              <p className="lm-meta lm-side-chat-sessions-empty">还没有对话。点 ＋ 新建。</p>
            ) : null}
            {!loading && !query.trim() && shown.length === 0 && sessions.length > 0 ? (
              <p className="lm-meta lm-side-chat-sessions-empty">
                {scopeMatterId ? "这个案件还没有对话。点 ＋ 新建。" : "还没有未归案的对话。"}
              </p>
            ) : null}
            {showEmpty ? (
              <p className="lm-meta lm-side-chat-sessions-empty">没有匹配的对话。</p>
            ) : null}
            {shown.map((row) => {
              const active = row.sessionId === activeSessionId;
              const selected = selection.selectedSet.has(row.sessionId);
              const running = runningSessionIds.has(row.sessionId);
              const assistantLabel = row.assistantId
                ? assistantDisplayById?.[row.assistantId]?.trim() || row.assistantId
                : "";
              const rowScope = chatScopeForMatterId(row.matterId, knownMatterIds);
              const scopeLabel =
                query.trim() && rowScope !== (scopeMatterId === undefined ? rowScope : scopeMatterId)
                  ? row.matterId
                    ? knownMatterIds && !knownMatterIds.has(row.matterId)
                      ? "原案件已不在"
                      : matterTitleById?.[row.matterId] || row.matterId
                    : "未归案"
                  : null;
              if (editingId === row.sessionId) {
                return (
                  <div key={row.sessionId} className="lm-side-chat-session-edit">
                    <input
                      ref={inputRef}
                      className="lm-side-chat-session-input"
                      aria-label="编辑对话名称"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onBlur={() => void commitRename()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitRename();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingId(null);
                        }
                      }}
                    />
                  </div>
                );
              }
              return (
                <div
                  key={row.sessionId}
                  role="option"
                  className={`lm-side-chat-session-row${active ? " is-active" : ""}${selected ? " is-selected" : ""}${running ? " is-running" : ""}`}
                  data-testid={`lm-side-chat-session-${row.sessionId}`}
                  aria-selected={selected}
                  aria-current={active ? "true" : undefined}
                  tabIndex={0}
                  aria-label={running ? `${row.title}，执行中` : row.title}
                  title={running ? `${row.title} · 执行中` : row.title}
                  onClick={(e) => {
                    if (selection.consumeSuppressedClick()) {
                      return;
                    }
                    if (e.shiftKey) {
                      e.preventDefault();
                    }
                    const next = selection.applyPointer(e, row.sessionId);
                    if (next.open) {
                      void onSelect(row.sessionId);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") {
                      return;
                    }
                    e.preventDefault();
                    selection.selectOnly(row.sessionId);
                    void onSelect(row.sessionId);
                  }}
                  onContextMenu={(e) => openContextMenu(e, row)}
                >
                  <span className="lm-side-chat-session-title">{row.title}</span>
                  {scopeLabel ? <span className="lm-side-chat-session-forked">{scopeLabel}</span> : null}
                  {showAssistantBadge && assistantLabel ? (
                    <span className="lm-side-chat-session-forked">{assistantLabel}</span>
                  ) : null}
                  {row.forkedToSessionId ? (
                    <button
                      type="button"
                      className="lm-side-chat-session-forked lm-side-chat-session-forked-btn"
                      data-testid={`lm-side-chat-session-forked-${row.sessionId}`}
                      title="已用「另起新对话（带上文）」承前；点开可回到那条新对话"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        void onSelect(row.forkedToSessionId!);
                      }}
                    >
                      续接
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {unboundCount > 0 && onShowUnbound ? (
            <button
              type="button"
              className="lm-side-chat-unbound"
              data-testid="lm-side-chat-show-unbound"
              onClick={onShowUnbound}
            >
              未归案 {unboundCount}
            </button>
          ) : null}
        </div>
      ) : null}

      {contextMenu ? (
        <div
          ref={menuRef}
          className="lm-chat-session-tab-menu"
          role="menu"
          aria-label="对话操作"
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {contextMenu.actionIds.length === 1 ? (
            <button
              type="button"
              role="menuitem"
              className="lm-chat-session-tab-menu-item"
              onClick={() => {
                startRename(contextMenu.sessionId, contextMenu.title);
                setContextMenu(null);
              }}
            >
              重命名
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="lm-chat-session-tab-menu-item lm-chat-session-tab-menu-item-danger"
            onClick={() => {
              deleteSessions(contextMenu.actionIds);
              setContextMenu(null);
            }}
          >
            {chatSessionDeleteLabel(contextMenu.actionIds.length)}
          </button>
        </div>
      ) : null}
    </div>
  );
}
