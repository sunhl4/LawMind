import { useEffect, useRef } from "react";
import { FileWorkbench } from "./FileWorkbench";
import { MatterWorkbench } from "./MatterWorkbench";
import { ReviewWorkbench } from "./ReviewWorkbench";
import { HelpPanel } from "./HelpPanel";
import { LawmindApiSetupWizard } from "./LawmindApiSetupWizard";
import { LawmindAssistantEditorDialog } from "./lawmind-assistant-editor";
import { useLawmindAppShell } from "./lawmind-app-shell";
import { LawmindChatShell } from "./lawmind-chat-shell";
import { LawmindDetailDialog } from "./lawmind-app-detail";
import { LawmindSettingsDialog } from "./lawmind-settings-shell";
import { LawmindSidebar } from "./lawmind-sidebar";

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
    contextTaskId,
    contextMatterId,
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
    openNewAssistant,
    openEditAssistant,
    saveAssistant,
    removeAssistant,
    copyMessage,
    openApiWizard,
    clearContext,
  } = actions;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

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
        canUseFilesystemBridge={canUseFilesystemBridge}
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
        busy={asstBusy}
        error={asstError}
        onChange={setAssistantDraft}
        onClose={() => setShowAssistantEditor(false)}
        onSave={() => void saveAssistant()}
      />
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
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
      <aside className="lm-side">
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
      </aside>
      <main className="lm-main">
        <div className="lm-main-header">
          <div>
            <div className="lm-main-eyebrow">法律工作台</div>
            <div className="lm-main-title">{selectedAssistant?.displayName ?? "LawMind"}</div>
            <div className="lm-main-subtitle">
              {selectedAssistant?.introduction?.trim() || "起草文书、法规检索、合同审查与案件跟进。"}
            </div>
          </div>
          <div className="lm-header-spacer" />
          <div className="lm-tabs lm-main-nav-tabs" style={{ marginBottom: 0, minWidth: 280 }}>
            <button
              type="button"
              className={`lm-tab ${mainView === "chat" ? "active" : ""}`}
              onClick={() => setMainView("chat")}
            >
              对话
            </button>
            <button
              type="button"
              className={`lm-tab ${mainView === "files" ? "active" : ""}`}
              onClick={() => setMainView("files")}
            >
              文件
            </button>
            <button
              type="button"
              className={`lm-tab ${mainView === "matters" ? "active" : ""}`}
              onClick={() => setMainView("matters")}
            >
              案件
            </button>
            <button
              type="button"
              className={`lm-tab ${mainView === "review" ? "active" : ""}`}
              onClick={() => setMainView("review")}
            >
              审核
            </button>
          </div>
          {projectDir && (
            <div className="lm-header-meta lm-header-project" title={projectDir}>
              {projectDir.split(/[\\/]/).filter(Boolean).pop()}
            </div>
          )}
          {currentMatterLabel && <div className="lm-header-meta">案件 {currentMatterLabel}</div>}
        </div>
        {mainView === "files" ? (
          <FileWorkbench
            workspaceDir={config?.workspaceDir ?? ""}
            projectDir={projectDir}
            canUseFilesystemBridge={canUseFilesystemBridge}
          />
        ) : mainView === "matters" && config ? (
          <div className="lm-main-workbench">
            <MatterWorkbench
              apiBase={config.apiBase}
              refreshVersion={matterRefreshVersion}
              assistantId={selectedAssistantId}
              onUseInChat={(matterId) => {
                setContextMatterId(matterId);
                setMainView("chat");
              }}
              onOpenReview={({ taskId, matterId, statusFilter = "all", listMode = "all" }) => {
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
            onClearContext={clearContext}
          />
        )}
      </main>
    </div>
  );
}
