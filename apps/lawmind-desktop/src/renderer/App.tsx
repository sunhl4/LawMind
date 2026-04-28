import { useEffect, useRef, useState } from "react";
import { FileWorkbench } from "./FileWorkbench";
import { MatterWorkbench } from "./MatterWorkbench";
import { ReviewWorkbench } from "./ReviewWorkbench";
import { HelpPanel } from "./HelpPanel";
import { LawmindApiSetupWizard } from "./LawmindApiSetupWizard";
import { LawmindAssistantEditorDialog } from "./lawmind-assistant-editor";
import { formatFileChatContextPill, useLawmindAppShell } from "./lawmind-app-shell";
import { LawmindChatShell } from "./lawmind-chat-shell";
import { LawmindDetailDialog } from "./lawmind-app-detail";
import { LawmindFirstRunDialog } from "./LawmindFirstRunDialog";
import { LawmindSettingsDialog } from "./lawmind-settings-shell";
import { LawmindSidebar } from "./lawmind-sidebar";
import { useEdition } from "./use-edition";
import {
  LM_PANE_MAX_WIDTH_PX,
  LM_PANE_MIN_WIDTH_PX,
  LM_SIDE_FILE_TREE_DEFAULT_HEIGHT_PX,
  LM_SIDE_FILE_TREE_MAX_HEIGHT_PX,
  LM_SIDE_FILE_TREE_MIN_HEIGHT_PX,
  readStoredBool,
  writeStoredBool,
} from "./lawmind-panel-layout";
import { usePaneResizePx, usePaneResizeVerticalPx } from "./use-pane-resize";
import { apiGetJson } from "./api-client";
import { useLawyerReviewDesktopNotify } from "./lawmind-lawyer-review-notify";

function resolveWorkspacePath(workspaceDir: string, rel: string): string {
  const r = rel.replace(/\\/g, "/").replace(/^\//, "");
  const w = workspaceDir.replace(/\\/g, "/").replace(/\/$/, "");
  return `${w}/${r}`;
}

/** Relative path for GET /api/artifact?path= (must stay under workspace `artifacts/`) */
function artifactApiRelFromOutput(outputPath?: string): string | null {
  if (!outputPath) {
    return null;
  }
  const norm = outputPath.replace(/\\/g, "/").replace(/^\//, "");
  if (norm.startsWith("artifacts/")) {
    return norm;
  }
  if (!norm.includes("/")) {
    return `artifacts/${norm}`;
  }
  return null;
}

function formatLocaleDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
  } catch {
    return iso;
  }
}

function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) {
      return iso;
    }
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) {
      return "刚刚";
    }
    if (diff < 3_600_000) {
      return `${Math.floor(diff / 60_000)} 分钟前`;
    }
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d >= today) {
      return `今天 ${hhmm}`;
    }
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d >= yesterday) {
      return `昨天 ${hhmm}`;
    }
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return iso;
  }
}

function legalStatusLabel(status: string | undefined, kind?: string): string {
  if (kind === "agent.instruction") {
    return "对话";
  }
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "done" || normalized === "completed") {
    return "已完成";
  }
  if (normalized === "running" || normalized === "processing") {
    return "处理中";
  }
  if (normalized === "error" || normalized === "failed") {
    return "处理失败";
  }
  if (normalized === "pending") {
    return "待处理";
  }
  if (normalized === "draft") {
    return "草稿";
  }
  if (normalized === "task") {
    return "任务";
  }
  return status ?? "任务";
}

function taskBadgeClass(status: string, kind?: string): string {
  if (kind === "agent.instruction") {
    return "lm-badge lm-badge-chat";
  }
  const normalized = status.toLowerCase();
  if (normalized === "done" || normalized === "completed") {
    return "lm-badge lm-badge-done";
  }
  if (normalized === "running" || normalized === "processing") {
    return "lm-badge lm-badge-running";
  }
  if (normalized === "error" || normalized === "failed") {
    return "lm-badge lm-badge-error";
  }
  return "lm-badge";
}

function historyBadgeClass(kind: string, taskRecordKind?: string, status?: string): string {
  if (kind === "draft") {
    return "lm-badge lm-badge-draft";
  }
  if (taskRecordKind === "agent.instruction") {
    return "lm-badge lm-badge-chat";
  }
  if (status) {
    return taskBadgeClass(status);
  }
  return "lm-badge";
}

export function App() {
  const {
    state,
    derived,
    actions,
  } = useLawmindAppShell();

  const {
    mainView,
    reviewFocusTaskId,
    reviewFocusMatterId,
    reviewFocusStatus,
    reviewFocusListMode,
    matterRefreshVersion,
    config,
    health,
    showWizard,
    wizApiKey,
    wizBaseUrl,
    wizModel,
    wizWorkspace,
    wizBusy,
    wizError,
    wizRetrievalMode,
    retrievalSaving,
    allowWebSearch,
    sideTab,
    taskListQuery,
    listTimeRange,
    tasks,
    history,
    assistants,
    presets,
    selectedAssistantId,
    showAssistantEditor,
    editingAssistantId,
    assistantDraft,
    asstBusy,
    asstError,
    input,
    loading,
    error,
    detailOpen,
    detailKind,
    detailId,
    detailLoading,
    detailError,
    detailTask,
    detailDraft,
    detailCitationIntegrity,
    detailCheckpoints,
    detailExecutionPlan,
    contextTaskId,
    contextMatterId,
    fileChatContextItems,
    copiedMessageIndex,
    recordsExpanded,
    showSettings,
    showHelp,
    collabSummarySettings,
    collabExpanded,
    delegations,
    collabEvents,
    collabTab,
    currentMessages,
  } = state;

  const {
    canUseFilesystemBridge,
    projectDir,
    filteredTasks,
    filteredHistory,
    selectedAssistant,
    selectedAssistantStats,
    workspaceLabel,
    retrievalLabel,
    currentMatterLabel,
  } = derived;

  const [chatMatterHeadline, setChatMatterHeadline] = useState<string | null>(null);
  /** 工作区资源管理器挂在左栏内（与助手 / 在办 同一列） */
  const [fileExplorerHost, setFileExplorerHost] = useState<HTMLDivElement | null>(null);
  const [fileEditorHost, setFileEditorHost] = useState<HTMLDivElement | null>(null);
  /** 从审核台点「返回案件」时一次性选中左侧案件，避免掉上下文 */
  const [focusMatterIdFromReview, setFocusMatterIdFromReview] = useState<string | null>(null);
  /** 从案件点「去复核」进入审核时为 true，点顶栏「审核」为 false，用于是否显示「返回案件」 */
  const [reviewLaunchedFromMatter, setReviewLaunchedFromMatter] = useState(false);
  const projectBasename = projectDir
    ? projectDir.split(/[\\/]/).filter(Boolean).pop() ?? null
    : null;

  useEffect(() => {
    if (!config?.apiBase || !contextMatterId?.trim()) {
      setChatMatterHeadline(null);
      return;
    }
    let cancel = false;
    void (async () => {
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          summary?: { headline?: string };
        }>(config.apiBase, `/api/matters/detail?matterId=${encodeURIComponent(contextMatterId)}`);
        if (cancel) {
          return;
        }
        if (!j.ok) {
          setChatMatterHeadline(null);
          return;
        }
        const h = typeof j.summary?.headline === "string" ? j.summary.headline.trim() : "";
        setChatMatterHeadline(h || null);
      } catch {
        if (!cancel) {
          setChatMatterHeadline(null);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [config?.apiBase, contextMatterId]);

  const {
    setMainView,
    setReviewFocusTaskId,
    setReviewFocusMatterId,
    setReviewFocusStatus,
    setReviewFocusListMode,
    setMatterRefreshVersion,
    setShowWizard,
    setWizApiKey,
    setWizBaseUrl,
    setWizModel,
    setWizRetrievalMode,
    setAllowWebSearch,
    setSideTab,
    setTaskListQuery,
    setListTimeRange,
    setSelectedAssistantId,
    setShowAssistantEditor,
    setAssistantDraft,
    setInput,
    setContextTaskId,
    setContextMatterId,
    setRecordsExpanded,
    setShowSettings,
    setShowHelp,
    setCollabExpanded,
    setCollabTab,
    refreshLists,
    openDetail,
    closeDetail,
    applyRetrievalMode,
    runWizardSave,
    pickWs,
    pickProject,
    clearProject,
    send,
    sendChatMessage,
    openNewAssistant,
    openEditAssistant,
    saveAssistant,
    removeAssistant,
    copyMessage,
    openApiWizard,
    clearContext,
    addFileToChatContext,
    removeFileChatContextItem,
    clearFileChatContext,
  } = actions;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const edition = useEdition(config?.apiBase ?? "");

  useEffect(() => {
    const unsub = window.lawmindDesktop?.onNotificationClick?.((payload) => {
      if (payload?.reason === "open_review") {
        setReviewLaunchedFromMatter(false);
        setMainView("review");
        setReviewFocusTaskId(payload.reviewTaskId?.trim() ? payload.reviewTaskId : null);
        setReviewFocusMatterId(payload.reviewMatterId?.trim() ? payload.reviewMatterId : null);
        setReviewFocusStatus("pending");
        setReviewFocusListMode("pending");
        return;
      }
      if (payload?.reason !== "open_settings_collaboration") {
        return;
      }
      setShowSettings(true);
      requestAnimationFrame(() => {
        document.getElementById("lawmind-settings-collaboration")?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    });
    return () => {
      unsub?.();
    };
  }, [
    setMainView,
    setReviewFocusListMode,
    setReviewFocusMatterId,
    setReviewFocusStatus,
    setReviewFocusTaskId,
    setShowSettings,
  ]);

  useLawyerReviewDesktopNotify({
    tasks,
    history,
    enabled: typeof window !== "undefined" && Boolean(window.lawmindDesktop?.showNotification),
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readStoredBool("lawmind.ui.sidebarCollapsed", false),
  );
  const [composeCollapsed, setComposeCollapsed] = useState(() =>
    readStoredBool("lawmind.ui.composeCollapsed", false),
  );

  useEffect(() => {
    writeStoredBool("lawmind.ui.sidebarCollapsed", sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    writeStoredBool("lawmind.ui.composeCollapsed", composeCollapsed);
  }, [composeCollapsed]);

  const { width: sidebarWidth, onResizePointerDown: onSidebarResizePointerDown } = usePaneResizePx({
    storageKey: "lawmind.ui.sidebarWidth",
    defaultWidth: 282,
    min: LM_PANE_MIN_WIDTH_PX,
    max: LM_PANE_MAX_WIDTH_PX,
  });

  const { height: sideFileTreeHeight, onResizePointerDown: onSideFileTreeResizePointerDown } =
    usePaneResizeVerticalPx({
      storageKey: "lawmind.ui.sideFileTreeHeight",
      defaultHeight: LM_SIDE_FILE_TREE_DEFAULT_HEIGHT_PX,
      min: LM_SIDE_FILE_TREE_MIN_HEIGHT_PX,
      max: LM_SIDE_FILE_TREE_MAX_HEIGHT_PX,
    });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages]);

  const previewArtifact = (outputPath?: string) => {
    if (!config) {
      return;
    }
    const rel = artifactApiRelFromOutput(outputPath);
    if (!rel) {
      return;
    }
    const url = `${config.apiBase}/api/artifact?path=${encodeURIComponent(rel)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const openOutputInFolder = (outputPath?: string) => {
    if (!config || !outputPath || !canUseFilesystemBridge) {
      return;
    }
    const full = resolveWorkspacePath(config.workspaceDir, outputPath);
    void window.lawmindDesktop?.showItemInFolder?.(full);
  };

  return (
    <div className="lm-shell">
      {showWizard && (
        <LawmindApiSetupWizard
          wizApiKey={wizApiKey}
          setWizApiKey={setWizApiKey}
          wizBaseUrl={wizBaseUrl}
          setWizBaseUrl={setWizBaseUrl}
          wizModel={wizModel}
          setWizModel={setWizModel}
          wizWorkspace={wizWorkspace}
          wizRetrievalMode={wizRetrievalMode}
          setWizRetrievalMode={setWizRetrievalMode}
          wizError={wizError}
          wizBusy={wizBusy}
          onPickWorkspace={() => void pickWs()}
          onCancel={() => setShowWizard(false)}
          onSave={() => void runWizardSave()}
        />
      )}
      <LawmindDetailDialog
        open={detailOpen}
        detailKind={detailKind}
        detailId={detailId}
        detailLoading={detailLoading}
        detailError={detailError}
        detailTask={detailTask}
        detailDraft={detailDraft}
        detailCitationIntegrity={detailCitationIntegrity}
        detailCheckpoints={detailCheckpoints}
        detailExecutionPlan={detailExecutionPlan}
        canUseFilesystemBridge={canUseFilesystemBridge}
        apiBase={config?.apiBase}
        onClose={closeDetail}
        onPreviewArtifact={previewArtifact}
        onOpenOutputInFolder={openOutputInFolder}
        onUseTaskContext={(taskId, matterId) => {
          setContextTaskId(taskId);
          setContextMatterId(matterId);
          closeDetail();
        }}
        formatLocaleDateTime={formatLocaleDateTime}
        artifactApiRelFromOutput={artifactApiRelFromOutput}
      />
      <LawmindAssistantEditorDialog
        open={showAssistantEditor}
        editingAssistantId={editingAssistantId}
        draft={assistantDraft}
        presets={presets}
        assistantLinkOptions={assistants
          .filter((a) => a.assistantId !== editingAssistantId)
          .map((a) => ({ assistantId: a.assistantId, displayName: a.displayName }))}
        busy={asstBusy}
        error={asstError}
        onChange={setAssistantDraft}
        onClose={() => setShowAssistantEditor(false)}
        onSave={() => void saveAssistant()}
      />
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      <LawmindFirstRunDialog
        apiBase={config?.apiBase ?? ""}
        onClose={() => {
          /* dismiss handled inside the dialog */
        }}
        onSeedReady={({ matterId, seedPrompt }) => {
          setContextMatterId(matterId);
          setInput(seedPrompt);
          textareaRef.current?.focus();
        }}
      />
      <LawmindSettingsDialog
        open={showSettings}
        config={config}
        projectDir={projectDir}
        workspaceLabel={workspaceLabel}
        health={health}
        collabSummarySettings={collabSummarySettings}
        assistants={assistants}
        selectedAssistantId={selectedAssistantId}
        onSelectAssistantId={setSelectedAssistantId}
        selectedAssistant={selectedAssistant}
        selectedAssistantStats={selectedAssistantStats}
        retrievalLabel={retrievalLabel}
        retrievalSaving={retrievalSaving}
        onClose={() => setShowSettings(false)}
        onOpenNewAssistant={openNewAssistant}
        onOpenEditAssistant={openEditAssistant}
        onRemoveAssistant={() => void removeAssistant()}
        onApplyRetrievalMode={applyRetrievalMode}
        onOpenApiWizard={openApiWizard}
        onPickProject={() => void pickProject()}
        onClearProject={() => void clearProject()}
      />
      <aside
        className={`lm-side ${sidebarCollapsed ? "lm-side-collapsed" : ""}`}
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
            <div className="lm-brand-subtitle">Legal Workbench</div>
          </div>
          <button
            type="button"
            className="lm-gear-btn"
            onClick={() => setShowHelp(true)}
            aria-label="帮助"
            title="帮助"
          >
            ?
          </button>
          <button
            type="button"
            className="lm-gear-btn"
            onClick={() => setShowSettings(true)}
            aria-label="设置"
            title="设置"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6.5.75h3l.3 1.77a5.5 5.5 0 0 1 1.28.74l1.72-.58 1.5 2.6-1.42 1.19a5.6 5.6 0 0 1 0 1.06l1.42 1.19-1.5 2.6-1.72-.58a5.5 5.5 0 0 1-1.28.74l-.3 1.77h-3l-.3-1.77a5.5 5.5 0 0 1-1.28-.74l-1.72.58-1.5-2.6 1.42-1.19a5.6 5.6 0 0 1 0-1.06L1.7 5.28l1.5-2.6 1.72.58a5.5 5.5 0 0 1 1.28-.74L6.5.75Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
        </div>
        <div className="lm-side-stack">
          {canUseFilesystemBridge && config?.workspaceDir ? (
            <>
              <div
                className="lm-side-files-host"
                ref={setFileExplorerHost}
                style={{ height: sideFileTreeHeight, flex: "0 0 auto" }}
              />
              <div
                className="lm-split-handle lm-split-handle-horizontal"
                role="separator"
                aria-orientation="horizontal"
                aria-label="调整文件树与下方侧栏高度"
                title="拖动调整文件区高度"
                onPointerDown={onSideFileTreeResizePointerDown}
              />
            </>
          ) : null}
          <LawmindSidebar
            projectDir={projectDir}
            assistants={assistants}
            selectedAssistantId={selectedAssistantId}
            recordsExpanded={recordsExpanded}
            collabExpanded={collabExpanded}
            collabTab={collabTab}
            sideTab={sideTab}
            taskListQuery={taskListQuery}
            listTimeRange={listTimeRange}
            filteredTasks={filteredTasks}
            filteredHistory={filteredHistory}
            delegations={delegations}
            collabEvents={collabEvents}
            onSelectAssistantId={setSelectedAssistantId}
            onToggleRecordsExpanded={() => setRecordsExpanded((value) => !value)}
            onToggleCollabExpanded={() => setCollabExpanded((value) => !value)}
            onSelectCollabTab={setCollabTab}
            onSelectSideTab={setSideTab}
            onTaskListQueryChange={setTaskListQuery}
            onListTimeRangeChange={setListTimeRange}
            onOpenDetail={(kind, id) => void openDetail(kind, id)}
            formatRelativeTime={formatRelativeTime}
            legalStatusLabel={legalStatusLabel}
            taskBadgeClass={taskBadgeClass}
            historyBadgeClass={historyBadgeClass}
          />
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
      <main className="lm-main">
        <div className="lm-main-header">
          <div className="lm-main-title-block">
            <div className="lm-main-eyebrow">律师工作台</div>
            <div className="lm-main-title">{selectedAssistant?.displayName ?? "LawMind"}</div>
            <div className="lm-main-subtitle">
              {selectedAssistant?.introduction?.trim() ||
                "交办任务、查卷、起草与协作：像安排团队一样用多个智能体即可；出具对外稿件前请走审核把关。"}
            </div>
            {mainView === "chat" ? (
              <p className="lm-main-microcopy">
                顶栏四格：<strong>对话</strong>（交办当前智能体）· <strong>文件</strong>（材料）· <strong>案件</strong>（归档）·{" "}
                <strong>审核</strong>（交付前必过）。需要多智能体按模板衔接时，到「设置 → 协作与多智能体流程」。
              </p>
            ) : null}
          </div>
          <div className="lm-header-spacer" aria-hidden />
          <div className="lm-panel-toggles" role="toolbar" aria-label="面板布局">
            <button
              type="button"
              className={`lm-panel-toggle ${sidebarCollapsed ? "lm-panel-toggle-off" : ""}`}
              title={sidebarCollapsed ? "显示左侧栏（任务与历史）" : "隐藏左侧栏"}
              aria-pressed={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((v) => !v)}
            >
              <span className="lm-panel-toggle-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="9" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
                </svg>
              </span>
              <span className="lm-panel-toggle-label">左栏</span>
            </button>
            <button
              type="button"
              className={`lm-panel-toggle ${composeCollapsed ? "lm-panel-toggle-off" : ""}`}
              title={composeCollapsed ? "展开底部输入区" : "收起底部输入区"}
              aria-pressed={!composeCollapsed}
              disabled={mainView !== "chat"}
              onClick={() => {
                if (mainView === "chat") {
                  setComposeCollapsed((v) => !v);
                }
              }}
            >
              <span className="lm-panel-toggle-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="12" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
                  <rect x="2" y="9" width="12" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </span>
              <span className="lm-panel-toggle-label">输入</span>
            </button>
          </div>
          <nav className="lm-tabs lm-main-nav lm-main-nav-tabs" aria-label="工作台模块">
            <button
              type="button"
              className={`lm-tab ${mainView === "chat" ? "active" : ""}`}
              aria-current={mainView === "chat" ? "page" : undefined}
              onClick={() => setMainView("chat")}
            >
              对话
            </button>
            <button
              type="button"
              className={`lm-tab ${mainView === "files" ? "active" : ""}`}
              aria-current={mainView === "files" ? "page" : undefined}
              onClick={() => setMainView("files")}
            >
              文件
            </button>
            <button
              type="button"
              className={`lm-tab ${mainView === "matters" ? "active" : ""}`}
              aria-current={mainView === "matters" ? "page" : undefined}
              onClick={() => setMainView("matters")}
            >
              案件
            </button>
            <button
              type="button"
              className={`lm-tab ${mainView === "review" ? "active" : ""}`}
              aria-current={mainView === "review" ? "page" : undefined}
              onClick={() => {
                setReviewLaunchedFromMatter(false);
                setMainView("review");
              }}
            >
              审核
            </button>
          </nav>
          {projectDir && (
            <div className="lm-header-meta lm-header-project" title={projectDir}>
              {projectDir.split(/[\\/]/).filter(Boolean).pop()}
            </div>
          )}
          {currentMatterLabel && <div className="lm-header-meta">案件 {currentMatterLabel}</div>}
          {!edition.loading && (
            <div
              className={`lm-header-meta lm-edition-badge lm-edition-${edition.edition}`}
              title={`版本来源：${edition.source}`}
            >
              {edition.label}
            </div>
          )}
        </div>
        <div className="lm-main-body">
          {canUseFilesystemBridge ? (
            <div
              ref={setFileEditorHost}
              className="lm-file-editor-host"
              style={{
                display: mainView === "files" ? "flex" : "none",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                minWidth: 0,
              }}
              aria-hidden={mainView !== "files"}
            />
          ) : null}
          {mainView === "matters" && config ? (
          <div className="lm-main-workbench">
            <MatterWorkbench
              apiBase={config.apiBase}
              refreshVersion={matterRefreshVersion}
              assistantId={selectedAssistantId}
              focusMatterId={focusMatterIdFromReview}
              onFocusMatterIdApplied={() => setFocusMatterIdFromReview(null)}
              onUseInChat={(matterId) => {
                setContextMatterId(matterId);
                setMainView("chat");
              }}
              onOpenReview={({ taskId, matterId, statusFilter = "all", listMode = "all" }) => {
                setReviewLaunchedFromMatter(true);
                setReviewFocusTaskId(taskId);
                setReviewFocusMatterId(matterId ?? null);
                setReviewFocusStatus(statusFilter);
                setReviewFocusListMode(listMode);
                if (matterId) {
                  setContextMatterId(matterId);
                }
                setMainView("review");
              }}
            />
          </div>
        ) : mainView === "review" && config ? (
          <div className="lm-main-workbench">
            <ReviewWorkbench
              apiBase={config.apiBase}
              assistantId={selectedAssistantId}
              initialTaskId={reviewFocusTaskId}
              initialMatterId={reviewFocusMatterId}
              initialStatusFilter={reviewFocusStatus}
              initialListMode={reviewFocusListMode}
              returnMatterId={reviewLaunchedFromMatter ? reviewFocusMatterId : null}
              onReturnToMatter={() => {
                if (reviewFocusMatterId) {
                  setFocusMatterIdFromReview(reviewFocusMatterId);
                }
                setReviewLaunchedFromMatter(false);
                setMainView("matters");
              }}
              onShowArtifact={(relPath) => openOutputInFolder(relPath)}
              onRecordsChanged={() => {
                setMatterRefreshVersion((v) => v + 1);
                void refreshLists();
              }}
            />
          </div>
        ) : (
          <LawmindChatShell
            selectedAssistantId={selectedAssistantId}
            currentMessages={currentMessages}
            copiedMessageIndex={copiedMessageIndex}
            input={input}
            loading={loading}
            error={error}
            allowWebSearch={allowWebSearch}
            webSearchApiKeyConfigured={health?.webSearchApiKeyConfigured}
            contextTaskId={contextTaskId}
            contextMatterId={contextMatterId}
            textareaRef={textareaRef}
            messagesEndRef={messagesEndRef}
            onInputChange={setInput}
            onAllowWebSearchChange={setAllowWebSearch}
            onSend={() => void send()}
            onCopyMessage={(text, index) => void copyMessage(text, index)}
            onApplyPrompt={(prompt) => {
              setInput(prompt);
              textareaRef.current?.focus();
            }}
            onSendClarificationMessage={(text) => void sendChatMessage(text)}
            onClearContext={clearContext}
            composeCollapsed={composeCollapsed}
            onToggleComposeCollapsed={() => setComposeCollapsed((v) => !v)}
            assistantDisplayName={selectedAssistant?.displayName?.trim() || "未命名智能体"}
            matterTitle={chatMatterHeadline}
            projectBasename={projectBasename}
            onOpenSettings={() => setShowSettings(true)}
            onGoToMatters={() => setMainView("matters")}
            fileChatPills={fileChatContextItems.map((it) => ({ id: it.id, ...formatFileChatContextPill(it) }))}
            onRemoveFileChatPill={removeFileChatContextItem}
            onClearFileChatPills={clearFileChatContext}
          />
        )}
        </div>
      </main>
      {canUseFilesystemBridge &&
        config?.workspaceDir &&
        fileExplorerHost &&
        fileEditorHost && (
          <FileWorkbench
            workspaceDir={config.workspaceDir}
            projectDir={projectDir}
            canUseFilesystemBridge
            onAddToChatContext={(payload) => {
              addFileToChatContext(payload);
              setMainView("chat");
            }}
            portalHosts={{
              explorer: fileExplorerHost,
              editor: fileEditorHost,
            }}
          />
        )}
    </div>
  );
}
