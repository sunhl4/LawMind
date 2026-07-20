import React from "react";
import { LawmindAutomationsSidebarList } from "../LawmindAutomationsSidebarList";
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
  matterSidebarRows: MatterSidebarRow[];
  selectedMatterKey: string | null;
  onSelectMatterKey: (matterId: string) => void;
  onSelectMatterForCockpit: (matterId: string) => void;
  /** Scope fleet / workflow without opening matter cockpit. */
  onSelectMatterScope?: (matterId: string) => void;
  matterCockpitOpen: boolean;
  mainView: LawmindMainView;
  /** Local API base for 自动办件侧栏列表；其它视图可省略。 */
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
  matterSidebarRows,
  selectedMatterKey,
  onSelectMatterKey,
  onSelectMatterForCockpit,
  onSelectMatterScope,
  matterCockpitOpen,
  mainView,
  apiBase,
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
  if (!showAppSidebar) {
    return null;
  }

  // 对话页已有「案件材料」树时不再叠一份案件列表；无材料树时仍用列表作回退。
  const showWorkspaceMatterList =
    mainView === "workspace" && !showSidebarWorkbenchFiles;
  const showAgentsMatterList = mainView === "agents";
  const showMeetingMatterList = mainView === "meeting";
  const showMatterList = showWorkspaceMatterList || showAgentsMatterList || showMeetingMatterList;
  const showAutomationsList =
    mainView === "automations" && Boolean(apiBase?.trim());
  const showSideChat =
    mainView === "workspace" &&
    Boolean(onSelectChatSession) &&
    Boolean(onCreateNewChatSession) &&
    Boolean(onRenameChatSession) &&
    Boolean(onDeleteChatSession);

  const matterListClassName = (() => {
    if (!showMatterList) {
      return undefined;
    }
    if (showAgentsMatterList || showMeetingMatterList) {
      return "lm-matter-sidebar-list--fill lm-matter-sidebar-list--agents";
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
          showSidebarWorkbenchFiles && mainView === "workspace" ? "lm-side-with-workbench-files" : ""
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

        {showSidebarWorkbenchFiles && mainView === "workspace" ? (
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
              if (mainView === "agents" || mainView === "meeting") {
                (onSelectMatterScope ?? onSelectMatterKey)(mid);
                return;
              }
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

        {showAutomationsList && apiBase ? (
          <LawmindAutomationsSidebarList apiBase={apiBase} />
        ) : mainView === "automations" ? (
          <p className="lm-meta lm-matter-sidebar-empty">本地服务未就绪，无法加载交办任务。</p>
        ) : null}

        {actionSummaryTotal > 0 ? (
          <div className="lm-side-footer">
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm lm-side-needs-decision-btn"
              onClick={onOpenNeedsDecisionDesk}
              data-testid="lm-side-needs-decision"
              title="打开「在办」处理澄清、批准与待审"
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
