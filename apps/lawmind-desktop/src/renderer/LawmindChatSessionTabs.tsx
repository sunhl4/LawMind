import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

export type LawmindChatSessionTab = {
  sessionId: string;
  title: string;
};

export type LawmindChatSessionTabsProps = {
  sessions: LawmindChatSessionTab[];
  activeSessionId?: string;
  loading?: boolean;
  busy?: boolean;
  onSelect: (sessionId: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  onRename: (sessionId: string, title: string) => void | Promise<void>;
  onDelete: (sessionId: string) => void | Promise<void>;
  /** Right-side tools (history, filters) — keeps one chrome row. */
  trailing?: ReactNode;
};

type ContextMenuState = { x: number; y: number; sessionId: string; title: string };

function PlusIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function LawmindChatSessionTabs({
  sessions,
  activeSessionId,
  loading,
  busy,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  trailing,
}: LawmindChatSessionTabsProps) {
  const tabListId = "lawmind-chat-session-tabs";
  const panelId = "lawmind-chat-messages-panel";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!activeSessionId || !scrollRef.current) {
      return;
    }
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-session-tab="${activeSessionId}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeSessionId, sessions]);

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

  const cancelRename = useCallback(() => {
    setEditingId(null);
  }, []);

  const openTabContextMenu = useCallback(
    (e: ReactMouseEvent, s: LawmindChatSessionTab) => {
      e.preventDefault();
      e.stopPropagation();
      void onSelect(s.sessionId);
      setContextMenu({ x: e.clientX, y: e.clientY, sessionId: s.sessionId, title: s.title });
    },
    [onSelect],
  );

  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, currentSessionId: string) => {
      if (sessions.length <= 1) {
        return;
      }
      const currentIndex = sessions.findIndex((item) => item.sessionId === currentSessionId);
      if (currentIndex < 0) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (currentIndex + step + sessions.length) % sessions.length;
        void onSelect(sessions[nextIndex]?.sessionId ?? currentSessionId);
      }
      if (event.key === "Home") {
        event.preventDefault();
        void onSelect(sessions[0]?.sessionId ?? currentSessionId);
      }
      if (event.key === "End") {
        event.preventDefault();
        void onSelect(sessions[sessions.length - 1]?.sessionId ?? currentSessionId);
      }
    },
    [onSelect, sessions],
  );

  return (
    <div className="lm-chat-session-tabs" role="tablist" aria-label="对话" id={tabListId}>
      <div ref={scrollRef} className="lm-chat-session-tabs-scroll">
        {loading && sessions.length === 0 ? (
          <span className="lm-chat-session-tabs-hint">加载中…</span>
        ) : null}
        {sessions.map((s) => {
          const active = s.sessionId === activeSessionId;
          if (editingId === s.sessionId) {
            return (
              <div key={s.sessionId} className="lm-chat-session-tab-edit-wrap">
                <input
                  ref={inputRef}
                  className="lm-chat-session-tab-input"
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
                      cancelRename();
                    }
                  }}
                />
              </div>
            );
          }
          return (
            <div
              key={s.sessionId}
              className={`lm-chat-session-tab-wrap ${active ? "lm-chat-session-tab-wrap-active" : ""}`}
              data-session-tab={s.sessionId}
              onContextMenuCapture={(e) => openTabContextMenu(e, s)}
            >
              <button
                type="button"
                role="tab"
                id={`lawmind-chat-tab-${s.sessionId}`}
                aria-selected={active}
                aria-controls={panelId}
                aria-haspopup="menu"
                aria-label={`切换到对话：${s.title}`}
                className="lm-chat-session-tab"
                title={`${s.title} — 左键切换；右键可重命名或删除`}
                disabled={Boolean(busy)}
                tabIndex={active ? 0 : -1}
                onKeyDown={(event) => handleTabKeyDown(event, s.sessionId)}
                onClick={() => void onSelect(s.sessionId)}
              >
                <span className="lm-chat-session-tab-label">{s.title}</span>
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="lm-chat-session-tab-new"
        aria-label="新建对话"
        title="新建对话"
        disabled={Boolean(busy) || Boolean(loading)}
        onClick={() => void onNewChat()}
      >
        <PlusIcon />
      </button>

      {trailing ? <div className="lm-chat-session-tabs-trailing">{trailing}</div> : null}

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
