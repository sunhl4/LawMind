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
import { fetchApiJson } from "./api-client-proxy";
import {
  isChatSearchFocusHotkey,
  LAWMIND_FOCUS_CHAT_SEARCH_EVENT,
} from "./lawmind-chat-search-focus";
import { isSafeLmSessionId } from "./lawmind-session-link";

export type SideChatSessionRow = {
  sessionId: string;
  title: string;
  lastPreview?: string;
};

export type LawmindSideChatSessionsProps = {
  sessions: SideChatSessionRow[];
  activeSessionId?: string;
  loading?: boolean;
  busy?: boolean;
  apiBase?: string;
  /** Kept for callers; search is workspace-wide like the agent tool. */
  assistantId?: string;
  onSelect: (sessionId: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  onRename: (sessionId: string, title: string) => void | Promise<void>;
  onDelete: (sessionId: string) => void | Promise<void>;
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

type ContextMenuState = { x: number; y: number; sessionId: string; title: string };

/**
 * Left-rail chat list (Cursor-style): third sidebar section under 工作区 / 案件材料.
 */
export function LawmindSideChatSessions(props: LawmindSideChatSessionsProps): ReactNode {
  const {
    sessions,
    activeSessionId,
    loading,
    busy,
    apiBase,
    onSelect,
    onNewChat,
    onRename,
    onDelete,
  } = props;
  const [sectionOpen, setSectionOpen] = useState(true);
  /** Filter is off by default (Cursor-style list + ＋). Reveal via ⌘⇧F / palette only. */
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

  const localMatches = useMemo(() => filterSideChatSessions(sessions, query), [sessions, query]);
  const shown = query.trim() === "" ? sessions : mergeSideChatSearchRows(remoteHits, localMatches);
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
        sessions?: Array<{ sessionId: string; title?: string; lastPreview?: string }>;
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
      void onSelect(row.sessionId);
      setContextMenu({ x: e.clientX, y: e.clientY, sessionId: row.sessionId, title: row.title });
    },
    [onSelect],
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
        <div
          className="lm-fs-dual-header-body"
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
          <span className="lm-section-label">对话</span>
        </div>
        <button
          type="button"
          className="lm-fs-root-add"
          title="新建对话"
          aria-label="新建对话"
          disabled={Boolean(busy) || Boolean(loading)}
          onClick={() => void onNewChat()}
        >
          ＋
        </button>
      </div>

      {sectionOpen ? (
        <div className="lm-side-chat-sessions-body">
          {searchOpen && sessions.length > 0 ? (
            <input
              ref={searchInputRef}
              className="lm-sidebar-search lm-side-chat-sessions-search"
              type="search"
              value={query}
              placeholder="筛选对话…"
              aria-label="筛选对话"
              data-testid="lm-side-chat-search"
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  setQuery("");
                  setSearchOpen(false);
                  setRemoteHits(null);
                }
              }}
            />
          ) : null}
          <div className="lm-side-chat-sessions-list lm-scroll" role="listbox" aria-label="对话列表">
            {loading && sessions.length === 0 ? (
              <p className="lm-meta lm-side-chat-sessions-empty">加载中…</p>
            ) : null}
            {!loading && sessions.length === 0 ? (
              <p className="lm-meta lm-side-chat-sessions-empty">还没有对话。点 ＋ 新建。</p>
            ) : null}
            {showEmpty ? (
              <p className="lm-meta lm-side-chat-sessions-empty">没有匹配的对话。</p>
            ) : null}
            {shown.map((row) => {
              const active = row.sessionId === activeSessionId;
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
                <button
                  key={row.sessionId}
                  type="button"
                  className={`lm-side-chat-session-row${active ? " is-active" : ""}`}
                  data-testid={`lm-side-chat-session-${row.sessionId}`}
                  disabled={Boolean(busy)}
                  aria-current={active ? "true" : undefined}
                  title={`${row.title} — 左键切换；右键可重命名或删除`}
                  onClick={() => void onSelect(row.sessionId)}
                  onContextMenu={(e) => openContextMenu(e, row)}
                >
                  <span className="lm-side-chat-session-title">{row.title}</span>
                  {row.lastPreview ? (
                    <span className="lm-side-chat-session-preview">{row.lastPreview}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
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
          <button
            type="button"
            role="menuitem"
            className="lm-chat-session-tab-menu-item lm-chat-session-tab-menu-item-danger"
            onClick={() => {
              void onDelete(contextMenu.sessionId);
              setContextMenu(null);
            }}
          >
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}
