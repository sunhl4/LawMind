import React, { useEffect, useRef, useState } from "react";
import { LawmindNeedsDecisionButton } from "../LawmindNeedsDecisionButton";
import { LawmindReadinessStrip } from "../LawmindReadinessStrip";
import { LawmindReviewPaneToggles } from "../LawmindReviewPaneToggles";
import { LawmindWorkspaceLayoutToggles } from "../LawmindWorkspaceLayoutToggles";
import type { HealthPayload } from "../lawmind-app-data";
import type { LawmindMainView } from "../lawmind-main-view";
import { lawmindMainViewLabel } from "../lawmind-main-view";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import type { ReviewPaneId, ReviewPaneVisibility } from "../lawmind-review-pane-prefs";
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
  actionSummaryTotal: number;
  /** Open「在办」with needs-decision focus (待我拍板). */
  onOpenNeedsDecisionDesk: () => void;
  /** Clear needs-decision filter when opening plain「在办」. */
  onClearNeedsDecisionFocus?: () => void;
  /** @deprecated Use onOpenNeedsDecisionDesk */
  onOpenAgentsDesk?: () => void;
  /** @deprecated Use onOpenNeedsDecisionDesk */
  onOpenActionHub?: () => void;
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
  onOpenMatterCockpit,
  apiBase,
  actionSummaryTotal,
  onOpenNeedsDecisionDesk,
  onClearNeedsDecisionFocus,
  onOpenAgentsDesk,
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
  /** Sidebar already hosts the settings gear; keep one gear in the header only when the sidebar is unavailable. */
  const showHeaderSettingsGear = sidebarCollapsed || mainView === "review";
  const openNeedsDecisionDesk =
    onOpenNeedsDecisionDesk ?? onOpenAgentsDesk ?? onOpenActionHub ?? (() => undefined);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const moreActive = mainView === "meeting" || mainView === "automations";

  useEffect(() => {
    if (!moreOpen) {
      return;
    }
    const onDoc = (event: MouseEvent) => {
      const t = event.target as Node | null;
      if (!t || moreRef.current?.contains(t)) {
        return;
      }
      setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

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
              {assistants.length > 0 ? (
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
                {mainView === "workspace" && matterCockpitOpen ? (
                  <button
                    type="button"
                    className="lm-tab active"
                    aria-current="page"
                    data-testid="lm-tab-matter"
                    title="本案办案台：概览、档案、任务与审查"
                  >
                    案件
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`lm-tab ${mainView === "agents" ? "active" : ""}`}
                  aria-current={mainView === "agents" ? "page" : undefined}
                  data-testid="lm-tab-agents"
                  onClick={() => {
                    onClearNeedsDecisionFocus?.();
                    onSetMainView("agents");
                  }}
                  title="进度与待办"
                >
                  在办
                </button>
                <button
                  type="button"
                  className={`lm-tab ${mainView === "review" ? "active" : ""}`}
                  aria-current={mainView === "review" ? "page" : undefined}
                  data-testid="lm-tab-review"
                  onClick={() => {
                    onClearNeedsDecisionFocus?.();
                    onSetMainView("review");
                  }}
                  title="撰写、预览与导出文书"
                >
                  文书台
                </button>
                {moreActive ? (
                  <span className="lm-tab active" aria-current="page" data-testid={`lm-tab-${mainView}`}>
                    {lawmindMainViewLabel(mainView)}
                  </span>
                ) : null}
                <div className="lm-nav-more" ref={moreRef}>
                  <button
                    type="button"
                    className={`lm-tab lm-nav-more-trigger${moreActive || moreOpen ? " active" : ""}`}
                    aria-expanded={moreOpen}
                    aria-haspopup="menu"
                    data-testid="lm-nav-more"
                    aria-label="会议室与自动办件"
                    title="会议室、自动办件"
                    onClick={() => setMoreOpen((v) => !v)}
                  >
                    会议室·办件
                  </button>
                  {moreOpen ? (
                    <div className="lm-nav-more-menu" role="menu" data-testid="lm-nav-more-menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="lm-nav-more-item"
                        data-testid="lm-tab-meeting"
                        onClick={() => {
                          setMoreOpen(false);
                          onSetMainView("meeting");
                        }}
                      >
                        会议室
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="lm-nav-more-item"
                        data-testid="lm-tab-automations"
                        onClick={() => {
                          setMoreOpen(false);
                          onSetMainView("automations");
                        }}
                      >
                        自动办件
                      </button>
                    </div>
                  ) : null}
                </div>
              </nav>
              {apiBase && (mainView === "review" || sidebarCollapsed) ? (
                <LawmindNeedsDecisionButton
                  total={actionSummaryTotal}
                  onClick={openNeedsDecisionDesk}
                />
              ) : null}
              {!matterCockpitOpen && currentMatterLabel && onOpenMatterCockpit ? (
                <button
                  type="button"
                  className="lm-header-matter-chip"
                  data-testid="lm-open-matter-cockpit"
                  onClick={onOpenMatterCockpit}
                  title={projectDir ? `${currentMatterLabel} · ${projectDir}` : `当前案件：${currentMatterLabel}`}
                  aria-label={`当前案件：${currentMatterLabel}，打开案件工作台`}
                >
                  <span className="lm-header-matter-chip-kicker">案件</span>
                  {currentMatterLabel}
                </button>
              ) : null}
              <div className="lm-header-spacer" aria-hidden />
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
