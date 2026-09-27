import React from "react";
import { LawmindMatterSidebarList } from "../LawmindMatterSidebarList";
import {
  LawmindSideChatSessions,
  type SideChatSessionRow,
} from "../LawmindSideChatSessions";
import type { MatterSidebarRow } from "../lawmind-records-desk-state";

import { LawmindSideExplorerSkeleton } from "./LawmindSideExplorerSkeleton";
import type { LawmindMainView } from "../lawmind-main-view";
import { LawmindBrandMark } from "./LawmindBrandMark";

export type LawmindAppSidebarProps = {
  showAppSidebar: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  showSidebarWorkbenchFiles: boolean;
  showExplorerSkeleton: boolean;
  onSidebarResizePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  settingsOpen: boolean;
  setFileExplorerHost: (el: HTMLDivElement | null) => void;
  actionSummaryTotal: number;
  matterSidebarRows: MatterSidebarRow[];
  selectedMatterKey: string | null;
  onSelectMatterKey: (matterId: string) => void;
  onSelectMatterForCockpit: (matterId: string) => void;
  matterCockpitOpen: boolean;
  mainView: LawmindMainView;
  /** Reserved for sidebar fetches that need the local API. */
  apiBase?: string;
  onOpenNeedsDecisionDesk: () => void;
  /** Workspace chat list in the left rail (Cursor-style). */
  chatSessions?: SideChatSessionRow[];
  activeChatSessionId?: string;
  chatSessionsLoading?: boolean;
  chatBusy?: boolean;
  chatAssistantId?: string;
  /** null = 未归案。不传则列表不过滤。 */
  chatListScope?: string | null;
  onOpenChatScope?: (scope: string | null) => void;
  assistantDisplayById?: Record<string, string>;
  /** 切换器用全量案件，不受工作台搜索过滤。 */
  chatMatterRows?: MatterSidebarRow[];
  chatMattersReady?: boolean;
  onSelectChatSession?: (sessionId: string) => void | Promise<void>;
  onCreateNewChatSession?: () => void | Promise<void>;
  onRenameChatSession?: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteChatSession?: (sessionId: string) => void | Promise<void>;
  /** Opens create-matter dialog from the matter list (no-FS / empty list). */
  onCreateMatter?: () => void;
};

function knownMatterIdsFromRows(
  rows: MatterSidebarRow[],
  ready: boolean,
): ReadonlySet<string> | null {
  if (!ready) {
    return null;
  }
  return new Set(rows.flatMap((row) => (row.matterId?.trim() ? [row.matterId.trim()] : [])));
}

function matterTitleByIdFromRows(rows: MatterSidebarRow[]): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const row of rows) {
    const id = row.matterId?.trim();
    if (id) {
      titles[id] = row.title;
    }
  }
  return titles;
}

function ChatScopeSwitcher(props: {
  open: boolean;
  onToggle: () => void;
  scope: string | null;
  rows: MatterSidebarRow[];
  onOpenScope: (scope: string | null) => void;
  onCreateMatter?: () => void;
}) {
  const matters = props.rows.filter((row) => row.matterId?.trim());
  const current = props.scope
    ? matters.find((row) => row.matterId === props.scope)?.title || props.scope
    : "未归案";
  return (
    <div className="lm-chat-scope">
      <button
        type="button"
        className="lm-chat-scope-btn"
        aria-haspopup="listbox"
        aria-expanded={props.open}
        data-testid="lm-chat-scope-switcher"
        onClick={props.onToggle}
      >
        <span className="lm-chat-scope-copy">
          <span className="lm-chat-scope-kicker">当前案件</span>
          <span className="lm-chat-scope-name">{current}</span>
        </span>
        <span aria-hidden>▾</span>
      </button>
      {props.open ? (
        <ul className="lm-chat-scope-menu" role="listbox" aria-label="切换案件">
          {matters.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                className={`lm-chat-scope-item${row.matterId === props.scope ? " is-active" : ""}`}
                onClick={() => props.onOpenScope(row.matterId)}
              >
                {row.title}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={`lm-chat-scope-item${props.scope === null ? " is-active" : ""}`}
              data-testid="lm-chat-scope-unbound"
              onClick={() => props.onOpenScope(null)}
            >
              未归案
            </button>
          </li>
          {props.onCreateMatter ? (
            <li>
              <button type="button" className="lm-chat-scope-item" onClick={props.onCreateMatter}>
                新建案件
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function LawmindAppSidebarImpl({
  showAppSidebar,
  sidebarCollapsed,
  sidebarWidth,
  showSidebarWorkbenchFiles,
  showExplorerSkeleton,
  onSidebarResizePointerDown,
  onOpenSettings,
  onCloseSettings,
  settingsOpen,
  setFileExplorerHost,
  actionSummaryTotal,
  matterSidebarRows,
  selectedMatterKey,
  onSelectMatterKey,
  onSelectMatterForCockpit,
  matterCockpitOpen,
  mainView,
  apiBase,
  onOpenNeedsDecisionDesk,
  chatSessions,
  activeChatSessionId,
  chatSessionsLoading,
  chatBusy,
  chatAssistantId,
  chatListScope,
  onOpenChatScope,
  assistantDisplayById,
  chatMatterRows,
  chatMattersReady = false,
  onSelectChatSession,
  onCreateNewChatSession,
  onRenameChatSession,
  onDeleteChatSession,
  onCreateMatter,
}: LawmindAppSidebarProps) {
  const [scopeMenuOpen, setScopeMenuOpen] = React.useState(false);
  // Settings owns the full shell width; do not keep the workspace rail beside it.
  if (!showAppSidebar || settingsOpen) {
    return null;
  }

  // 对话 / 会议室 / 在办：有材料树时不再叠案件列表；无材料树时仍用列表作回退。
  // 工作台不占用全局侧栏，案件只在驾驶舱里。
  const showSideChat =
    (mainView === "workspace" || mainView === "meeting" || mainView === "agents") &&
    Boolean(onSelectChatSession) &&
    Boolean(onCreateNewChatSession) &&
    Boolean(onRenameChatSession) &&
    Boolean(onDeleteChatSession);
  const showWorkspaceMatterList =
    (mainView === "workspace" || mainView === "meeting" || mainView === "agents") &&
    !showSidebarWorkbenchFiles;
  const showMatterList = showWorkspaceMatterList && !showSideChat;
  const showWorkbenchExplorer =
    showSidebarWorkbenchFiles &&
    (mainView === "workspace" || mainView === "meeting" || mainView === "agents");

  const matterListClassName = (() => {
    if (!showMatterList) {
      return undefined;
    }
    if (showSidebarWorkbenchFiles && !matterCockpitOpen) {
      return "lm-matter-sidebar-list--stacked";
    }
    if (!showSidebarWorkbenchFiles && !matterCockpitOpen) {
      return "lm-matter-sidebar-list--fill";
    }
    return undefined;
  })();

  return (
    <>
      <aside
        className={`lm-side ${sidebarCollapsed ? "lm-side-collapsed" : ""} ${
          showWorkbenchExplorer ? "lm-side-with-workbench-files" : ""
        }${showSideChat ? " lm-side-with-chat-sessions" : ""}`}
        style={{
          width: sidebarCollapsed ? 0 : sidebarWidth,
          flexShrink: 0,
          borderRight: sidebarCollapsed ? "none" : undefined,
        }}
        aria-hidden={sidebarCollapsed}
        aria-label="侧栏"
      >
        <div className="lm-brand">
          <div className="lm-logo-mark" aria-hidden="true">
            <LawmindBrandMark size={28} />
          </div>
          <div className="lm-brand-copy">
            <div className="lm-brand-title">LawMind</div>
          </div>
          <button
            type="button"
            className={`lm-gear-btn${settingsOpen ? " is-active" : ""}`}
            onClick={settingsOpen ? onCloseSettings : onOpenSettings}
            aria-label={settingsOpen ? "关闭设置" : "设置"}
            aria-pressed={settingsOpen}
            title={settingsOpen ? "关闭设置" : "设置"}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M6.5.75h3l.3 1.77a5.5 5.5 0 0 1 1.28.74l1.72-.58 1.5 2.6-1.42 1.19a5.6 5.6 0 0 1 0 1.06l1.42 1.19-1.5 2.6-1.72-.58a5.5 5.5 0 0 1-1.28.74l-.3 1.77h-3l-.3-1.77a5.5 5.5 0 0 1-1.28-.74l-1.72.58-1.5-2.6 1.42-1.19a5.6 5.6 0 0 1 0-1.06L1.7 5.28l1.5-2.6 1.72.58a5.5 5.5 0 0 1 1.28-.74L6.5.75Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>

        {showSideChat &&
        onSelectChatSession &&
        onCreateNewChatSession &&
        onRenameChatSession &&
        onDeleteChatSession ? (
          <>
            <ChatScopeSwitcher
              open={scopeMenuOpen}
              onToggle={() => setScopeMenuOpen((value) => !value)}
              scope={chatListScope === undefined ? null : chatListScope}
              rows={chatMatterRows ?? matterSidebarRows}
              onOpenScope={(scope) => {
                setScopeMenuOpen(false);
                onOpenChatScope?.(scope);
              }}
              onCreateMatter={onCreateMatter}
            />
            <LawmindSideChatSessions
              sessions={chatSessions ?? []}
              activeSessionId={activeChatSessionId}
              loading={chatSessionsLoading}
              busy={chatBusy}
              apiBase={apiBase}
              assistantId={chatAssistantId}
              scopeMatterId={chatListScope}
              knownMatterIds={knownMatterIdsFromRows(chatMatterRows ?? matterSidebarRows, chatMattersReady)}
              matterTitleById={matterTitleByIdFromRows(chatMatterRows ?? matterSidebarRows)}
              assistantDisplayById={assistantDisplayById}
              onShowUnbound={
                onOpenChatScope
                  ? () => {
                      onOpenChatScope(null);
                    }
                  : undefined
              }
              onSelect={onSelectChatSession}
              onNewChat={onCreateNewChatSession}
              onRename={onRenameChatSession}
              onDelete={onDeleteChatSession}
            />
          </>
        ) : null}

        {showWorkbenchExplorer ? (
          <div
            ref={setFileExplorerHost}
            className="lm-side-explorer-host"
            aria-label="材料资源树"
          >
            {showExplorerSkeleton ? <LawmindSideExplorerSkeleton /> : null}
          </div>
        ) : null}

        {showMatterList ? (
          <LawmindMatterSidebarList
            className={matterListClassName}
            rows={matterSidebarRows}
            selectedKey={selectedMatterKey}
            onCreateMatter={onCreateMatter}
            onSelect={(mid) => {
              if (matterCockpitOpen) {
                onSelectMatterKey(mid);
              } else {
                onSelectMatterForCockpit(mid);
              }
            }}
          />
        ) : null}

        {actionSummaryTotal > 0 ? (
          <div className="lm-side-footer">
            <button
              type="button"
              className="lm-btn lm-btn-sm lm-side-needs-decision-btn lm-side-needs-decision-btn--brass"
              onClick={onOpenNeedsDecisionDesk}
              data-testid="lm-side-needs-decision"
              title="打开「在办」处理澄清、签批与待审"
            >
              <span>待我拍板</span>
              <span className="lm-side-needs-decision-badge" aria-label={`${actionSummaryTotal} 项待处理`}>
                {actionSummaryTotal > 99 ? "99+" : actionSummaryTotal}
              </span>
            </button>
          </div>
        ) : null}
      </aside>
      {!sidebarCollapsed ? (
        <div
          className="lm-split-handle lm-split-handle-vertical"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左栏宽度"
          title="拖动调整侧栏宽度"
          onPointerDown={onSidebarResizePointerDown}
        />
      ) : null}
    </>
  );
}

export const LawmindAppSidebar = React.memo(LawmindAppSidebarImpl);
