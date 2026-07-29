import React from "react";
import { LawmindMatterSidebarList } from "../LawmindMatterSidebarList";
import {
  LawmindSideChatSessions,
  type SideChatSessionRow,
} from "../LawmindSideChatSessions";
import type { MatterSidebarRow } from "../lawmind-records-desk-state";

import { LawmindSideExplorerSkeleton } from "./LawmindSideExplorerSkeleton";
import type { LawmindMainView } from "../lawmind-main-view";

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
  /** 近 48h 互审/委派完成（信息角标，不计入待拍板） */
  recentCollabCompleted?: number;
  matterSidebarRows: MatterSidebarRow[];
  selectedMatterKey: string | null;
  onSelectMatterKey: (matterId: string) => void;
  onSelectMatterForCockpit: (matterId: string) => void;
  /** Scope fleet / workflow without opening matter cockpit. */
  onSelectMatterScope?: (matterId: string) => void;
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
  onSelectChatSession?: (sessionId: string) => void | Promise<void>;
  onCreateNewChatSession?: () => void | Promise<void>;
  onRenameChatSession?: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteChatSession?: (sessionId: string) => void | Promise<void>;
  /** Opens create-matter dialog from the matter list (no-FS / empty list). */
  onCreateMatter?: () => void;
};

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
  recentCollabCompleted = 0,
  matterSidebarRows,
  selectedMatterKey,
  onSelectMatterKey,
  onSelectMatterForCockpit,
  onSelectMatterScope: _onSelectMatterScope,
  matterCockpitOpen,
  mainView,
  onOpenNeedsDecisionDesk,
  chatSessions,
  activeChatSessionId,
  chatSessionsLoading,
  chatBusy,
  onSelectChatSession,
  onCreateNewChatSession,
  onRenameChatSession,
  onDeleteChatSession,
  onCreateMatter,
}: LawmindAppSidebarProps) {
  // Settings owns the full shell width; do not keep the workspace rail beside it.
  if (!showAppSidebar || settingsOpen) {
    return null;
  }

  // 对话 / 会议室 / 在办：有材料树时不再叠案件列表；无材料树时仍用列表作回退。
  const showWorkspaceMatterList =
    (mainView === "workspace" || mainView === "meeting" || mainView === "agents") &&
    !showSidebarWorkbenchFiles;
  const showMatterList = showWorkspaceMatterList;
  const showWorkbenchExplorer =
    showSidebarWorkbenchFiles &&
    (mainView === "workspace" || mainView === "meeting" || mainView === "agents");
  const showSideChat =
    (mainView === "workspace" || mainView === "meeting" || mainView === "agents") &&
    Boolean(onSelectChatSession) &&
    Boolean(onCreateNewChatSession) &&
    Boolean(onRenameChatSession) &&
    Boolean(onDeleteChatSession);

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

        {showSideChat &&
        onSelectChatSession &&
        onCreateNewChatSession &&
        onRenameChatSession &&
        onDeleteChatSession ? (
          <LawmindSideChatSessions
            sessions={chatSessions ?? []}
            activeSessionId={activeChatSessionId}
            loading={chatSessionsLoading}
            busy={chatBusy}
            onSelect={onSelectChatSession}
            onNewChat={onCreateNewChatSession}
            onRename={onRenameChatSession}
            onDelete={onDeleteChatSession}
          />
        ) : null}

        {actionSummaryTotal > 0 || recentCollabCompleted > 0 ? (
          <div className="lm-side-footer">
            {actionSummaryTotal > 0 ? (
              <button
                type="button"
                className="lm-btn lm-btn-sm lm-side-needs-decision-btn lm-side-needs-decision-btn--brass"
                onClick={onOpenNeedsDecisionDesk}
                data-testid="lm-side-needs-decision"
                title="打开「在办」处理澄清、批准与待审"
              >
                <span>待我拍板</span>
                <span className="lm-side-needs-decision-badge" aria-label={`${actionSummaryTotal} 项待处理`}>
                  {actionSummaryTotal > 99 ? "99+" : actionSummaryTotal}
                </span>
              </button>
            ) : null}
            {recentCollabCompleted > 0 ? (
              <button
                type="button"
                className="lm-btn lm-btn-sm lm-side-collab-done-btn"
                onClick={onOpenNeedsDecisionDesk}
                data-testid="lm-side-collab-completed"
                title="近 48 小时互审/委派完成（信息提示，不计入待拍板）"
              >
                <span>工作流完成</span>
                <span className="lm-side-needs-decision-badge" aria-label={`${recentCollabCompleted} 项工作流完成`}>
                  {recentCollabCompleted > 99 ? "99+" : recentCollabCompleted}
                </span>
              </button>
            ) : null}
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
