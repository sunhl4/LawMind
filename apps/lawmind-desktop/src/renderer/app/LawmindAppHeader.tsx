import React from "react";
import { LawmindReadinessStrip } from "../LawmindReadinessStrip";
import { LawmindReviewPaneToggles } from "../LawmindReviewPaneToggles";
import { LawmindWorkspaceLayoutToggles } from "../LawmindWorkspaceLayoutToggles";
import type { HealthPayload } from "../lawmind-app-data";
import type { LawmindMainView } from "../lawmind-main-view";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import type { ReviewPaneId, ReviewPaneVisibility } from "../lawmind-review-pane-prefs";
import { ASSISTANT_PRESENCE_LABEL } from "../../../../../src/lawmind/assistants/presence.ts";
import { assistantsForDailySwitcher } from "../../../../../src/lawmind/assistants/roster.ts";
import type { AssistantRow } from "../lawmind-settings-models.ts";
export type LawmindAppHeaderProps = {
  mainView: LawmindMainView;
  assistants: AssistantRow[];
  selectedAssistantId: string;
  onSelectAssistantId: (id: string) => void;
  matterCockpitOpen: boolean;
  onExitMatterCockpit: () => void;
  onSetMainView: (view: LawmindMainView) => void;
  onOpenMatterCockpit?: () => void;
  apiBase: string | undefined;
  /** Clear needs-decision filter when opening plain「在办」. */
  onClearNeedsDecisionFocus?: () => void;
  projectDir: string | null;
  currentMatterLabel: string | null;
  sidebarCollapsed: boolean;
  wsShowEditor: boolean;
  wsShowChat: boolean;
  canUseFilesystemBridge: boolean;
  /** 核对纸正占着中栏时，编辑区开关改为「显示文件」。 */
  editorCoveredBySheet?: boolean;
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
  /** Workspace-wide inbox count. Header shows the entry only when the sidebar cannot. */
  needsDecisionTotal?: number;
  onOpenNeedsDecision?: () => void;
};

function LawmindAppHeaderImpl({
  mainView,
  assistants,
  selectedAssistantId,
  onSelectAssistantId,
  matterCockpitOpen,
  onExitMatterCockpit,
  onSetMainView,
  onOpenMatterCockpit,
  apiBase,
  onClearNeedsDecisionFocus,
  projectDir,
  currentMatterLabel,
  sidebarCollapsed,
  wsShowEditor,
  wsShowChat,
  canUseFilesystemBridge,
  editorCoveredBySheet = false,
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
  needsDecisionTotal = 0,
  onOpenNeedsDecision,
}: LawmindAppHeaderProps) {
  /** Sidebar already hosts the settings gear; keep one gear in the header only when the sidebar is unavailable. */
  const showHeaderSettingsGear =
    sidebarCollapsed || mainView === "review" || mainView === "desk" || mainView === "archive";
  const sidebarHostsNeedsDecision =
    !sidebarCollapsed && mainView !== "review" && mainView !== "desk" && mainView !== "archive";
  const showHeaderNeedsDecision =
    !settingsOpen &&
    !sidebarHostsNeedsDecision &&
    needsDecisionTotal > 0 &&
    Boolean(onOpenNeedsDecision);
  const showAssistantSwitcher = assistants.length > 1;
  const currentAssistant = assistants.find(
    (assistant) => assistant.assistantId === selectedAssistantId,
  );
  const presence = currentAssistant?.presence ?? "idle";
  const presenceLabel = ASSISTANT_PRESENCE_LABEL[presence];

  return (
    <>
      <div
        className={`lm-main-header lm-main-header-compact${mainView === "review" ? " lm-main-header-review" : ""}${mainView === "desk" ? " lm-main-header-desk" : ""}${settingsOpen ? " lm-main-header-settings" : ""}`}
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
              {showHeaderSettingsGear ? (
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
              ) : null}
            </>
          ) : (
            <>
              {showAssistantSwitcher ? (
                <div className="lm-main-title-block">
                  <div className="lm-main-assistant-line">
                    <span
                      className={`lm-presence-dot lm-presence-dot--${presence}`}
                      title={presenceLabel}
                      aria-label={presenceLabel}
                      data-testid="lm-assistant-presence"
                    />
                    <select
                      className="lm-asst-select lm-main-asst-select"
                      value={selectedAssistantId}
                      aria-label="选择助手"
                      onChange={(e) => onSelectAssistantId(e.target.value)}
                    >
                      {assistantsForDailySwitcher(assistants, selectedAssistantId).map((assistant) => (
                        <option key={assistant.assistantId} value={assistant.assistantId}>
                          {assistant.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : null}
              <nav className="lm-tabs lm-main-nav lm-main-nav-compact" aria-label="功能模块">
                <button
                  type="button"
                  className={`lm-tab ${mainView === "workspace" && !matterCockpitOpen ? "active" : ""}`}
                  aria-current={mainView === "workspace" && !matterCockpitOpen ? "page" : undefined}
                  data-testid="lm-tab-workspace"
                  onClick={() => {
                    onClearNeedsDecisionFocus?.();
                    if (matterCockpitOpen) {
                      onExitMatterCockpit();
                      return;
                    }
                    onSetMainView("workspace");
                  }}
                >
                  对话
                </button>
                <button
                  type="button"
                  className={`lm-tab ${mainView === "desk" ? "active" : ""}`}
                  aria-current={mainView === "desk" ? "page" : undefined}
                  data-testid="lm-tab-desk"
                  onClick={() => {
                    onClearNeedsDecisionFocus?.();
                    onSetMainView("desk");
                  }}
                  title="今日计划、案件、期限与邮件待回复"
                >
                  工作台
                </button>
                <button
                  type="button"
                  className={`lm-tab ${mainView === "agents" ? "active" : ""}`}
                  aria-current={mainView === "agents" ? "page" : undefined}
                  data-testid="lm-tab-agents"
                  onClick={() => {
                    onClearNeedsDecisionFocus?.();
                    onSetMainView("agents");
                  }}
                  title="要你处理的、正在办的、今天办完的"
                >
                  在办
                </button>
                {/* 整理资料不占一级 Tab；从设置 → 工作区进入。已打开时显示次级以便定位。 */}
                {mainView === "archive" ? (
                  <button
                    type="button"
                    className="lm-tab lm-tab-secondary active"
                    aria-current="page"
                    data-testid="lm-tab-archive"
                    onClick={() => onSetMainView("archive")}
                    title="整理指定范围里的文件：建案、归入已有案件，或收好一般资料"
                  >
                    整理资料
                  </button>
                ) : null}
              </nav>
              {!matterCockpitOpen && currentMatterLabel && onOpenMatterCockpit ? (
                <button
                  type="button"
                  className="lm-header-matter-chip"
                  data-testid="lm-open-matter-cockpit"
                  onClick={onOpenMatterCockpit}
                  title={projectDir ? `${currentMatterLabel} · ${projectDir}` : `当前案件：${currentMatterLabel}`}
                  aria-label={`当前案件：${currentMatterLabel}，打开工作台本案卷宗`}
                >
                  <span className="lm-header-matter-chip-kicker">案件</span>
                  {currentMatterLabel}
                </button>
              ) : null}
              <div className="lm-header-spacer" aria-hidden />
              {showHeaderNeedsDecision ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-sm lm-side-needs-decision-btn lm-side-needs-decision-btn--brass"
                  data-testid="lm-header-needs-decision"
                  title="打开「在办」处理澄清、签批与待审"
                  onClick={() => onOpenNeedsDecision?.()}
                >
                  <span>待我拍板</span>
                  <span
                    className="lm-side-needs-decision-badge"
                    aria-label={`${needsDecisionTotal} 项待处理`}
                  >
                    {needsDecisionTotal > 99 ? "99+" : needsDecisionTotal}
                  </span>
                </button>
              ) : null}
              <div className="lm-main-header-right">
                {mainView === "workspace" ||
                mainView === "review" ||
                mainView === "meeting" ||
                mainView === "agents" ? (
                  <div className="lm-main-header-layout-toggles" role="toolbar" aria-label="面板布局">
                    {mainView === "review" ? (
                      <LawmindReviewPaneToggles
                        visibility={reviewPaneVisibility}
                        onToggle={onToggleReviewPane}
                        iconOnly
                      />
                    ) : mainView === "agents" ? (
                      <div className="lm-panel-toggles" role="group" aria-label="侧栏">
                        <button
                          type="button"
                          className={`lm-panel-toggle ${sidebarCollapsed ? "lm-panel-toggle-off" : ""}`}
                          data-testid="lm-agents-toggle-sidebar"
                          title={sidebarCollapsed ? "显示侧栏" : "隐藏侧栏"}
                          aria-label={sidebarCollapsed ? "显示侧栏" : "隐藏侧栏"}
                          aria-pressed={!sidebarCollapsed}
                          onClick={onToggleSidebar}
                        >
                          <span className="lm-panel-toggle-icon" aria-hidden>
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                              <rect
                                x="2"
                                y="2"
                                width="5"
                                height="12"
                                rx="1"
                                stroke="currentColor"
                                strokeWidth="1.2"
                              />
                              <rect
                                x="9"
                                y="2"
                                width="5"
                                height="12"
                                rx="1"
                                stroke="currentColor"
                                strokeWidth="1.2"
                                opacity="0.35"
                              />
                            </svg>
                          </span>
                        </button>
                      </div>
                    ) : (
                      <LawmindWorkspaceLayoutToggles
                        sidebarCollapsed={sidebarCollapsed}
                        wsShowEditor={wsShowEditor}
                        wsShowChat={wsShowChat}
                        canUseFilesystemBridge={canUseFilesystemBridge}
                        matterCockpitOpen={matterCockpitOpen}
                        editorCoveredBySheet={editorCoveredBySheet}
                        onToggleSidebar={onToggleSidebar}
                        onToggleEditor={onToggleEditor}
                        onToggleChat={onToggleChat}
                      />
                    )}
                  </div>
                ) : null}
                {showHeaderSettingsGear ? (
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
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
      {showReadinessStrip && apiBase ? (
        <LawmindReadinessStrip
          health={health ?? undefined}
          workspaceDir={workspaceDir}
          // health 拉取成功且不在重连窗口才算服务可达（不再仅按重连反转判断）。
          apiReachable={Boolean(health) && !localServiceReconnecting}
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
