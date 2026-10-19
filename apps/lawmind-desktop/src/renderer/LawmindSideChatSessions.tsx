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
import {
  groupSideChatSessions,
  sideChatAgeLabel,
  sideChatFolderHoverMeta,
  sideChatFolderTitle,
} from "./lawmind-chat-folder-groups";
import { fetchApiJson } from "./api-client-proxy";
import {
  isChatSearchFocusHotkey,
  LAWMIND_FOCUS_CHAT_SEARCH_EVENT,
} from "./lawmind-chat-search-focus";
import { isSafeLmSessionId } from "./lawmind-session-link";
import { useQueuedChatSessionIds, useRunningChatSessionIds } from "./lawmind-live-turns";
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
  /** 本机文件夹内的相对路径。 */
  folderRel?: string;
  /** 新建时绑定的工作区绝对路径。 */
  workDir?: string;
  updatedAt?: string;
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
  /** 当前打开的本机文件夹名。没有子文件夹的对话归在这个名字下面。 */
  workspaceFolderLabel?: string | null;
  /** 本机文件夹全路径，悬停文件夹标题时给律师看。 */
  workspaceFolderPath?: string | null;
  /** 设置里的默认工作区。有对话时排在各组最前。 */
  preferredWorkDir?: string | null;
  /** 在该文件夹下新建对话。不传路径表示当前工作区根目录。 */
  onNewChatInFolder?: (folderRel?: string) => void | Promise<void>;
  /** 用一个绝对路径作为新对话的工作区。不改已有对话。 */
  onCreateChatWorkspace?: (workDir: string) => void | Promise<void>;
  onShowUnbound?: () => void;
  onSelect: (sessionId: string) => void | Promise<void>;
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
  live: {
    activeSessionId?: string;
    runningSessionIds: ReadonlySet<string>;
    queuedSessionIds?: ReadonlySet<string>;
  },
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
  for (const id of live.queuedSessionIds ?? []) {
    ensure(id);
  }
  ensure(live.activeSessionId);
  return visible;
}

type FolderMenuState = {
  x: number;
  y: number;
  label: string;
  path: string;
  folderRel?: string;
  workDir?: string;
  collapsed: boolean;
  groupKey: string;
};

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
 * 左栏对话：按本机文件夹分组。从最上面新建的对话不挂文件夹。
 */
export function LawmindSideChatSessions(props: LawmindSideChatSessionsProps): ReactNode {
  const {
    sessions,
    activeSessionId,
    loading,
    apiBase,
    onSelect,
    onRename,
    onDelete,
    scopeMatterId,
    knownMatterIds = null,
    matterTitleById,
    assistantDisplayById,
    workspaceFolderLabel,
    workspaceFolderPath,
    preferredWorkDir,
    onNewChatInFolder,
    onCreateChatWorkspace,
    onShowUnbound,
  } = props;
  const [sectionOpen, setSectionOpen] = useState(true);
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(() => readCollapsedChatFolders());
  /** 对话优先：搜索默认收起，⌘⇧O / 点「搜」再展开。 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteHits, setRemoteHits] = useState<SideChatSessionRow[] | null>(null);
  const [remotePending, setRemotePending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [folderMenu, setFolderMenu] = useState<FolderMenuState | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);
  const runningSessionIds = useRunningChatSessionIds();
  const queuedSessionIds = useQueuedChatSessionIds();

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

  useLayoutEffect(() => {
    if (!folderMenu || !folderMenuRef.current) {
      return;
    }
    const el = folderMenuRef.current;
    const rect = el.getBoundingClientRect();
    let x = folderMenu.x;
    let y = folderMenu.y;
    if (x + rect.width > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (y + rect.height > window.innerHeight - 8) {
      y = Math.max(8, window.innerHeight - rect.height - 8);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [folderMenu]);

  useEffect(() => {
    if (!contextMenu && !folderMenu) {
      return undefined;
    }
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || folderMenuRef.current?.contains(target)) {
        return;
      }
      setContextMenu(null);
      setFolderMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setFolderMenu(null);
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [contextMenu, folderMenu]);

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
          queuedSessionIds,
        })
      : mergeSideChatSearchRows(remoteHits, localMatches);
  const shownIds = useMemo(() => shown.map((row) => row.sessionId), [shown]);
  const groups = useMemo(
    () =>
      groupSideChatSessions(shown, {
        matterTitleById,
        knownMatterIds,
        workspaceFolderLabel,
        preferredWorkDir,
      }),
    [knownMatterIds, matterTitleById, preferredWorkDir, shown, workspaceFolderLabel],
  );
  const selection = useChatSessionMultiSelect(shownIds, activeSessionId);
  const startChatWorkspace = useCallback(
    (workDir: string) => {
      setFolderMenu(null);
      const groupKey = `work:${workDir}`;
      setCollapsedFolders((prev) => {
        if (!prev.has(groupKey)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(groupKey);
        writeCollapsedChatFolders(next);
        return next;
      });
      void onCreateChatWorkspace?.(workDir);
    },
    [onCreateChatWorkspace],
  );
  const startChatInFolder = useCallback(
    (folderRel?: string) => {
      setFolderMenu(null);
      const groupKey = folderRel ? `folder:${folderRel}` : "workspace";
      setCollapsedFolders((prev) => {
        if (!prev.has(groupKey)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(groupKey);
        writeCollapsedChatFolders(next);
        return next;
      });
      void onNewChatInFolder?.(folderRel);
    },
    [onNewChatInFolder],
  );
  const toggleFolder = useCallback((key: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      writeCollapsedChatFolders(next);
      return next;
    });
  }, []);
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
      setFolderMenu(null);
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
            <span className="lm-side-chat-running-count" title="这些对话正在同时生成">
              {runningSessionIds.size} 在办
            </span>
          ) : null}
          {queuedSessionIds.size > 0 ? (
            <span className="lm-side-chat-queued-count" title="这些对话在等模型空位，空出来就接着办">
              {queuedSessionIds.size} 排队
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
              <p className="lm-meta lm-side-chat-sessions-empty">还没有对话。</p>
            ) : null}
            {!loading && !query.trim() && shown.length === 0 && sessions.length > 0 ? (
              <p className="lm-meta lm-side-chat-sessions-empty">
                {scopeMatterId ? "这个案件还没有对话。" : "还没有未放入文件夹的对话。"}
              </p>
            ) : null}
            {showEmpty ? (
              <p className="lm-meta lm-side-chat-sessions-empty">没有匹配的对话。</p>
            ) : null}
            {groups.map((group) => {
              const folderMeta = sideChatFolderHoverMeta(group.sessions);
              const folderPath = group.workDir
                ? group.workDir
                : group.label
                  ? sideChatFolderTitle({
                      label: group.label,
                      folder: group.folder,
                      workspace: false,
                      workspaceFolderPath,
                    })
                  : "";
              const folderCollapsed = Boolean(group.label) && !query.trim() && collapsedFolders.has(group.key);
              const folderRel = group.folder && group.key !== "workspace" ? group.label ?? undefined : undefined;
              return (
              <div key={group.key} className="lm-side-chat-folder">
                {group.label ? (
                  <div
                    className={`lm-side-chat-folder-label${folderCollapsed ? " is-collapsed" : ""}`}
                    onContextMenu={
                      group.folder
                        ? (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setContextMenu(null);
                            setFolderMenu({
                              x: e.clientX,
                              y: e.clientY,
                              label: group.label ?? "",
                              path: folderPath,
                              folderRel,
                              workDir: group.workDir,
                              collapsed: folderCollapsed,
                              groupKey: group.key,
                            });
                          }
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      className="lm-side-chat-folder-toggle"
                      data-testid={`lm-side-chat-folder-${group.key}`}
                      aria-expanded={!folderCollapsed}
                      aria-label={`${folderCollapsed ? "展开" : "折叠"}${group.label}`}
                      title={`${folderPath} · ${folderMeta}`}
                      onClick={() => toggleFolder(group.key)}
                    >
                      <span className={`lm-fs-arrow${folderCollapsed ? "" : " open"}`} aria-hidden="true">
                        ▸
                      </span>
                      {group.folder ? (
                        <span className="lm-fs-icon" aria-hidden="true">
                          📁
                        </span>
                      ) : null}
                      <span className="lm-side-chat-folder-name">{group.label}</span>
                      <span className="lm-side-chat-folder-meta">{folderMeta}</span>
                    </button>
                    {group.folder && (group.workDir ? onCreateChatWorkspace : onNewChatInFolder) ? (
                      <button
                        type="button"
                        className="lm-fs-root-add lm-side-chat-folder-new"
                        data-testid={`lm-side-chat-folder-new-${group.key}`}
                        aria-label={`在${group.label}下新建对话`}
                        title="在工作区下新建对话"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (group.workDir) {
                            startChatWorkspace(group.workDir);
                          } else {
                            startChatInFolder(folderRel);
                          }
                        }}
                      >
                        ＋
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {folderCollapsed ? null : group.sessions.map((row) => {
              const active = row.sessionId === activeSessionId;
              const selected = selection.selectedSet.has(row.sessionId);
              const running = runningSessionIds.has(row.sessionId);
              const queued = queuedSessionIds.has(row.sessionId);
              const assistantLabel = row.assistantId
                ? assistantDisplayById?.[row.assistantId]?.trim() || row.assistantId
                : "";
              const age = sideChatAgeLabel(row.updatedAt);
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
                  className={`lm-side-chat-session-row${active ? " is-active" : ""}${selected ? " is-selected" : ""}${running ? " is-running" : ""}${queued ? " is-queued" : ""}`}
                  data-testid={`lm-side-chat-session-${row.sessionId}`}
                  aria-selected={selected}
                  aria-current={active ? "true" : undefined}
                  tabIndex={0}
                  aria-label={
                    queued ? `${row.title}，排队` : running ? `${row.title}，执行中` : row.title
                  }
                  title={
                    [
                      queued ? `${row.title} · 排队` : running ? `${row.title} · 执行中` : row.title,
                      age,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  }
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
                  {age ? <span className="lm-side-chat-session-age">{age}</span> : null}
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
      {folderMenu ? (
        <div
          ref={folderMenuRef}
          className="lm-chat-session-tab-menu"
          role="menu"
          aria-label={`${folderMenu.label}的操作`}
          data-testid="lm-side-chat-folder-menu"
          style={{ position: "fixed", left: folderMenu.x, top: folderMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {folderMenu.workDir && onCreateChatWorkspace ? (
            <button
              type="button"
              role="menuitem"
              className="lm-chat-session-tab-menu-item"
              onClick={() => startChatWorkspace(folderMenu.workDir!)}
            >
              在工作区下新建对话
            </button>
          ) : onNewChatInFolder ? (
            <button
              type="button"
              role="menuitem"
              className="lm-chat-session-tab-menu-item"
              onClick={() => startChatInFolder(folderMenu.folderRel)}
            >
              在此文件夹新建对话
            </button>
          ) : null}
          {canRevealLocalFolder(folderMenu.path) ? (
            <button
              type="button"
              role="menuitem"
              className="lm-chat-session-tab-menu-item"
              onClick={() => {
                const path = folderMenu.path;
                setFolderMenu(null);
                void window.lawmindDesktop?.showItemInFolder(path);
              }}
            >
              在访达中显示
            </button>
          ) : null}
          {folderMenu.path ? (
            <button
              type="button"
              role="menuitem"
              className="lm-chat-session-tab-menu-item"
              onClick={() => {
                const path = folderMenu.path;
                setFolderMenu(null);
                void navigator.clipboard?.writeText(path);
              }}
            >
              复制路径
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="lm-chat-session-tab-menu-item"
            onClick={() => {
              toggleFolder(folderMenu.groupKey);
              setFolderMenu(null);
            }}
          >
            {folderMenu.collapsed ? "展开此文件夹" : "收起此文件夹"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function canRevealLocalFolder(path: string): boolean {
  if (typeof window === "undefined" || typeof window.lawmindDesktop?.showItemInFolder !== "function") {
    return false;
  }
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

const COLLAPSED_CHAT_FOLDERS_KEY = "lawmind.chat.collapsedFolders.v1";

function collapsedFolderStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storage = window.localStorage;
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function"
  ) {
    return null;
  }
  return storage;
}

function readCollapsedChatFolders(): Set<string> {
  const storage = collapsedFolderStorage();
  if (!storage) {
    return new Set();
  }
  try {
    const raw = storage.getItem(COLLAPSED_CHAT_FOLDERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((key): key is string => typeof key === "string" && key.length > 0));
  } catch {
    return new Set();
  }
}

function writeCollapsedChatFolders(keys: ReadonlySet<string>): void {
  const storage = collapsedFolderStorage();
  if (!storage) {
    return;
  }
  storage.setItem(COLLAPSED_CHAT_FOLDERS_KEY, JSON.stringify([...keys]));
}
