import React from "react";
import type { CollabEvent, DelegationRow, TaskRow } from "../lawmind-app-data";
import { LawmindCollaborationSidebar } from "../LawmindCollaborationSidebar";
import { LawmindMatterSidebarList } from "../LawmindMatterSidebarList";
import type { MatterSidebarRow } from "../lawmind-records-desk-state";
import type { CollabSummaryState } from "../LawmindSettingsCollaboration";

export type LawmindAppSidebarProps = {
  showAppSidebar: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  showSidebarWorkbenchFiles: boolean;
  showCollaborationSidebar: boolean;
  onSidebarResizePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  setFileExplorerHost: (el: HTMLDivElement | null) => void;
  actionSummaryTotal: number;
  actionSummaryActiveJobs: number;
  delegations: DelegationRow[];
  collabEvents: CollabEvent[];
  collabTab: "delegations" | "timeline";
  onSelectCollabTab: (tab: "delegations" | "timeline") => void;
  filteredTasks: TaskRow[];
  matterSidebarRows: MatterSidebarRow[];
  selectedMatterKey: string | null;
  onSelectMatterKey: (matterId: string) => void;
  onSelectMatterForCockpit: (matterId: string) => void;
  matterCockpitOpen: boolean;
  mainView: "workspace" | "collaboration" | "review";
  formatRelativeTime: (iso: string) => string;
  legalStatusLabel: (status: string | undefined, kind?: string) => string;
  taskBadgeClass: (status: string, kind?: string) => string;
  onOpenDetail: (kind: "task" | "draft", id: string) => void | Promise<void>;
  onOpenDelegationTargetChat: (delegation: DelegationRow) => void | Promise<void>;
  onOpenActionHub: () => void;
  onRefreshCollaboration: () => void | Promise<void>;
  collabSummarySettings: CollabSummaryState | null | undefined;
};

function LawmindAppSidebarImpl({
  showAppSidebar,
  sidebarCollapsed,
  sidebarWidth,
  showSidebarWorkbenchFiles,
  showCollaborationSidebar,
  onSidebarResizePointerDown,
  onOpenHelp,
  onOpenSettings,
  setFileExplorerHost,
  actionSummaryTotal,
  actionSummaryActiveJobs,
  delegations,
  collabEvents,
  collabTab,
  onSelectCollabTab,
  filteredTasks,
  matterSidebarRows,
  selectedMatterKey,
  onSelectMatterKey,
  onSelectMatterForCockpit,
  matterCockpitOpen,
  mainView,
  formatRelativeTime,
  legalStatusLabel,
  taskBadgeClass,
  onOpenDetail,
  onOpenDelegationTargetChat,
  onOpenActionHub,
  onRefreshCollaboration,
  collabSummarySettings,
}: LawmindAppSidebarProps) {
  if (!showAppSidebar) {
    return null;
  }

  return (
    <>
      <aside
        className={`lm-side ${sidebarCollapsed ? "lm-side-collapsed" : ""} ${
          showSidebarWorkbenchFiles ? "lm-side-with-workbench-files" : ""
        }${showCollaborationSidebar ? " lm-side-with-collab-context" : ""}`}
        style={{
          width: sidebarCollapsed ? 0 : sidebarWidth,
          flexShrink: 0,
          borderRight: sidebarCollapsed ? "none" : undefined,
        }}
        aria-hidden={sidebarCollapsed}
      >
        <div className="lm-brand">
          <div className="lm-logo-mark">L</div>
          <div className="lm-brand-copy">
            <div className="lm-brand-title">LawMind</div>
            <div className="lm-brand-subtitle">法律工作台</div>
          </div>
          <button
            type="button"
            className="lm-gear-btn"
            onClick={onOpenHelp}
            aria-label="帮助"
            title="帮助"
          >
            ?
          </button>
          <button
            type="button"
            className="lm-gear-btn"
            onClick={onOpenSettings}
            aria-label="设置"
            title="设置"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6.5.75h3l.3 1.77a5.5 5.5 0 0 1 1.28.74l1.72-.58 1.5 2.6-1.42 1.19a5.6 5.6 0 0 1 0 1.06l1.42 1.19-1.5 2.6-1.72-.58a5.5 5.5 0 0 1-1.28.74l-.3 1.77h-3l-.3-1.77a5.5 5.5 0 0 1-1.28-.74l-1.72.58-1.5-2.6 1.42-1.19a5.6 5.6 0 0 1 0-1.06L1.7 5.28l1.5-2.6 1.72.58a5.5 5.5 0 0 1 1.28-.74L6.5.75Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
        </div>
        {showSidebarWorkbenchFiles ? (
          <div
            ref={setFileExplorerHost}
            className="lm-side-explorer-host"
            aria-label="材料资源树"
          />
        ) : null}
        {showCollaborationSidebar ? (
          <LawmindCollaborationSidebar
            actionSummaryTotal={actionSummaryTotal}
            activeJobs={actionSummaryActiveJobs}
            delegations={delegations}
            collabEvents={collabEvents}
            collabTab={collabTab}
            onSelectCollabTab={onSelectCollabTab}
            filteredTasks={filteredTasks}
            matterRows={matterSidebarRows}
            selectedMatterKey={selectedMatterKey}
            onSelectMatter={onSelectMatterForCockpit}
            formatRelativeTime={formatRelativeTime}
            legalStatusLabel={legalStatusLabel}
            taskBadgeClass={taskBadgeClass}
            onOpenDetail={onOpenDetail}
            onOpenDelegationTargetChat={(d) => void onOpenDelegationTargetChat(d)}
            onOpenActionHub={onOpenActionHub}
            onRefreshCollaboration={onRefreshCollaboration}
            collaborationHint={collabSummarySettings?.collaborationHint}
          />
        ) : null}
        {matterCockpitOpen && mainView === "workspace" ? (
          <LawmindMatterSidebarList
            rows={matterSidebarRows}
            selectedKey={selectedMatterKey}
            onSelect={(mid) => onSelectMatterKey(mid)}
          />
        ) : null}
        <div className="lm-side-footer">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm lm-side-action-hub-btn"
            onClick={onOpenActionHub}
          >
            <span>待办中心</span>
            {actionSummaryTotal > 0 ? (
              <span className="lm-side-action-hub-badge" aria-label={`${actionSummaryTotal} 项待处理`}>
                {actionSummaryTotal > 99 ? "99+" : actionSummaryTotal}
              </span>
            ) : null}
          </button>
        </div>
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
