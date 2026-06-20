import React from "react";
import { LawmindActionHubButton } from "../LawmindActionHub";
import { LawmindReadinessStrip } from "../LawmindReadinessStrip";
import { LawmindReviewPaneToggles } from "../LawmindReviewPaneToggles";
import { LawmindWorkspaceLayoutToggles } from "../LawmindWorkspaceLayoutToggles";
import type { HealthPayload } from "../lawmind-app-data";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import type { ReviewPaneId, ReviewPaneVisibility } from "../lawmind-review-pane-prefs";
import type { AssistantRow } from "../lawmind-settings-models.ts";

export type LawmindAppHeaderProps = {
  mainView: "workspace" | "collaboration" | "review";
  assistants: AssistantRow[];
  selectedAssistantId: string;
  onSelectAssistantId: (id: string) => void;
  matterCockpitOpen: boolean;
  onExitMatterCockpit: () => void;
  onSetMainView: (view: "workspace" | "collaboration" | "review") => void;
  onOpenCollaborationOverview: () => void;
  onOpenReviewTab: () => void;
  apiBase: string | undefined;
  actionSummaryTotal: number;
  onOpenActionHub: () => void;
  projectDir: string | null;
  currentMatterLabel: string | null;
  sidebarCollapsed: boolean;
  wsShowEditor: boolean;
  wsShowChat: boolean;
  canUseFilesystemBridge: boolean;
  onToggleSidebar: () => void;
  onToggleEditor: () => void;
  onToggleChat: () => void;
  reviewPaneVisibility: ReviewPaneVisibility;
  onToggleReviewPane: (id: ReviewPaneId) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  settingsOpen: boolean;
  showReadinessStrip: boolean;
  health: HealthPayload | null | undefined;
  workspaceDir: string | undefined;
  localServiceReconnecting: boolean;
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  onOpenApiWizard: () => void;
  onOpenDoctor: () => void;
  onVerifyModel: () => void | Promise<void>;
  composeModelQuickTestBusy: boolean;
};

function LawmindAppHeaderImpl({
  mainView,
  assistants,
  selectedAssistantId,
  onSelectAssistantId,
  matterCockpitOpen,
  onExitMatterCockpit,
  onSetMainView,
  onOpenCollaborationOverview,
  onOpenReviewTab,
  apiBase,
  actionSummaryTotal,
  onOpenActionHub,
  projectDir,
  currentMatterLabel,
  sidebarCollapsed,
  wsShowEditor,
  wsShowChat,
  canUseFilesystemBridge,
  onToggleSidebar,
  onToggleEditor,
  onToggleChat,
  reviewPaneVisibility,
  onToggleReviewPane,
  onOpenSettings,
  onCloseSettings,
  settingsOpen,
  showReadinessStrip,
  health,
  workspaceDir,
  localServiceReconnecting,
  modelCatalog,
  selectedModelId,
  onOpenApiWizard,
  onOpenDoctor,
  onVerifyModel,
}: LawmindAppHeaderProps) {
  return (
    <>
      <div
        className={`lm-main-header lm-main-header-compact${mainView === "review" ? " lm-main-header-review" : ""}${settingsOpen ? " lm-main-header-settings" : ""}`}
      >
        <div className="lm-main-header-row">
          {settingsOpen ? (
            <>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm lm-settings-back-btn"
                onClick={onCloseSettings}
                aria-label="关闭设置并返回"
              >
                ← 返回
              </button>
              <h1 className="lm-main-settings-title">设置</h1>
              <span className="lm-settings-esc-hint">Esc 关闭</span>
              <div className="lm-header-spacer" aria-hidden />
              <div className="lm-main-header-right">
                <button
                  type="button"
                  className="lm-main-header-gear-btn lm-main-header-gear-btn-active"
                  onClick={onCloseSettings}
                  aria-label="关闭设置"
                  aria-pressed
                  title="关闭设置"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
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
            </>
          ) : (
            <>
          {assistants.length > 1 ? (
            <div className="lm-main-title-block">
              <div className="lm-main-assistant-line">
                <select
                  className="lm-asst-select lm-main-asst-select"
                  value={selectedAssistantId}
                  aria-label="选择助手"
                  onChange={(e) => onSelectAssistantId(e.target.value)}
                >
                  {assistants.map((assistant) => (
                    <option key={assistant.assistantId} value={assistant.assistantId}>
                      {assistant.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          {mainView === "workspace" && matterCockpitOpen ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm lm-exit-cockpit-btn"
              onClick={onExitMatterCockpit}
            >
              返回对话
            </button>
          ) : null}
          <nav className="lm-tabs lm-main-nav lm-main-nav-compact" aria-label="功能模块">
            <button
              type="button"
              className={`lm-tab ${mainView === "workspace" ? "active" : ""}`}
              aria-current={mainView === "workspace" ? "page" : undefined}
              onClick={() => onSetMainView("workspace")}
            >
              对话
            </button>
            <button
              type="button"
              className={`lm-tab ${mainView === "collaboration" ? "active" : ""}`}
              aria-current={mainView === "collaboration" ? "page" : undefined}
              onClick={onOpenCollaborationOverview}
            >
              协作
            </button>
            <button
              type="button"
              className={`lm-tab ${mainView === "review" ? "active" : ""}`}
              aria-current={mainView === "review" ? "page" : undefined}
              onClick={onOpenReviewTab}
            >
              审核
            </button>
          </nav>
          {apiBase ? (
            <LawmindActionHubButton total={actionSummaryTotal} onClick={onOpenActionHub} />
          ) : null}
          <div className="lm-header-spacer" aria-hidden />
          {(projectDir || currentMatterLabel) && !matterCockpitOpen ? (
            <div className="lm-header-breadcrumb" title={projectDir ?? undefined}>
              {projectDir ? (
                <span className="lm-header-breadcrumb-seg">
                  {projectDir.split(/[\\/]/).filter(Boolean).pop()}
                </span>
              ) : null}
              {projectDir && currentMatterLabel ? (
                <span className="lm-header-breadcrumb-sep" aria-hidden>
                  /
                </span>
              ) : null}
              {currentMatterLabel ? (
                <span className="lm-header-breadcrumb-seg lm-header-breadcrumb-matter">
                  {currentMatterLabel}
                </span>
              ) : null}
            </div>
          ) : null}
          {matterCockpitOpen && currentMatterLabel ? (
            <div className="lm-header-breadcrumb lm-header-breadcrumb-cockpit">
              <span className="lm-header-breadcrumb-seg">案件工作台</span>
              <span className="lm-header-breadcrumb-sep" aria-hidden>
                /
              </span>
              <span className="lm-header-breadcrumb-seg lm-header-breadcrumb-matter">
                {currentMatterLabel}
              </span>
            </div>
          ) : null}
          <div className="lm-main-header-right">
            {mainView === "workspace" || mainView === "review" ? (
              <div className="lm-main-header-layout-toggles" role="toolbar" aria-label="面板布局">
                {mainView === "review" ? (
                  <LawmindReviewPaneToggles
                    visibility={reviewPaneVisibility}
                    onToggle={onToggleReviewPane}
                    iconOnly
                  />
                ) : (
                  <LawmindWorkspaceLayoutToggles
                    sidebarCollapsed={sidebarCollapsed}
                    wsShowEditor={wsShowEditor}
                    wsShowChat={wsShowChat}
                    canUseFilesystemBridge={canUseFilesystemBridge}
                    matterCockpitOpen={matterCockpitOpen}
                    onToggleSidebar={onToggleSidebar}
                    onToggleEditor={onToggleEditor}
                    onToggleChat={onToggleChat}
                  />
                )}
              </div>
            ) : null}
            <button
              type="button"
              className={`lm-main-header-gear-btn${settingsOpen ? " lm-main-header-gear-btn-active" : ""}`}
              onClick={onOpenSettings}
              aria-label="设置"
              aria-pressed={settingsOpen}
              title="设置"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
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
            </>
          )}
        </div>
      </div>
      {showReadinessStrip && apiBase ? (
        <LawmindReadinessStrip
          health={health ?? undefined}
          workspaceDir={workspaceDir}
          apiReachable={!localServiceReconnecting}
          modelCatalog={modelCatalog}
          selectedModelId={selectedModelId}
          onOpenApiWizard={onOpenApiWizard}
          onOpenSettings={onOpenSettings}
          onOpenDoctor={onOpenDoctor}
          onVerifyModel={onVerifyModel}
        />
      ) : null}
    </>
  );
}

export const LawmindAppHeader = React.memo(LawmindAppHeaderImpl);
