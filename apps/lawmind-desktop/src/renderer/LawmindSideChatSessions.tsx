import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

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
  onSelect: (sessionId: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  onRename: (sessionId: string, title: string) => void | Promise<void>;
  onDelete: (sessionId: string) => void | Promise<void>;
};

type ContextMenuState = { x: number; y: number; sessionId: string; title: string };

/**
 * Left-rail chat list (Cursor-style): third sidebar section under 工作区 / 案件材料.
 */
export function LawmindSideChatSessions(props: LawmindSideChatSessionsProps): ReactNode {
  const { sessions, activeSessionId, loading, busy, onSelect, onNewChat, onRename, onDelete } = props;
  const [sectionOpen, setSectionOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editingId) {
      return;
    }
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [editingId]);

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
          aria-label={sectionOpen ? "折叠对话" : "展开对话"}
          title={sectionOpen ? "折叠" : "展开"}
          onClick={() => setSectionOpen((v) => !v)}
        >
          <span className={`lm-fs-arrow ${sectionOpen ? "open" : ""}`}>▸</span>
        </button>
        <div
          className="lm-fs-dual-header-body"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setSectionOpen((v) => !v);
            }
          }}
          onClick={() => setSectionOpen((v) => !v)}
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
        <div className="lm-side-chat-sessions-body" role="list" aria-label="对话列表">
          {loading && sessions.length === 0 ? (
            <p className="lm-meta lm-side-chat-sessions-empty">加载中…</p>
          ) : null}
          {!loading && sessions.length === 0 ? (
            <p className="lm-meta lm-side-chat-sessions-empty">还没有对话。点 ＋ 新建。</p>
          ) : null}
          {sessions.map((row) => {
            const active = row.sessionId === activeSessionId;
            if (editingId === row.sessionId) {
              return (
                <div key={row.sessionId} className="lm-side-chat-session-edit" role="listitem">
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
                role="listitem"
                className={`lm-side-chat-session-row${active ? " is-active" : ""}`}
                data-testid={`lm-side-chat-session-${row.sessionId}`}
                disabled={Boolean(busy)}
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
            zIndex: 99_999,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="lm-chat-session-tab-menu-item"
            disabled={Boolean(busy)}
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
            disabled={Boolean(busy)}
            onClick={() => {
              setContextMenu(null);
              void onDelete(contextMenu.sessionId);
            }}
          >
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}
