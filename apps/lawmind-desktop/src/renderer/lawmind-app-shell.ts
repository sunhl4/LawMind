import { useCallback, useRef, useState } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { createAssistantDraft, type AssistantEditorDraft } from "./lawmind-assistant-editor";
import type { LawmindMainView } from "./lawmind-main-view";
import {
  type LawmindSettingsScrollAnchorId,
  type LawmindSettingsSectionId,
  LAWMIND_SETTINGS_DEFAULT_SECTION,
  readStoredSettingsSection,
  type SetShowSettings,
} from "./lawmind-settings-shell";
import type { TimeRangeFilter } from "./lawmind-time-range";
import { type AppConfig } from "./lawmind-app-bootstrap";
import { useLawmindModelConfig } from "./useLawmindModelConfig";
import {
  useLawmindChatShell,
  type ChatSessionListEntry,
} from "./useLawmindChatShell";
import { useLawmindCollaborationWatch } from "./useLawmindCollaborationWatch";
import { useLawmindBackgroundWatch } from "./useLawmindBackgroundWatch";
import { useLawmindChatSessions } from "./useLawmindChatSessions";
import { useLawmindChatSend } from "./useLawmindChatSend";
import { useLawmindComposeExtras } from "./useLawmindComposeExtras";
import { useLawmindDetailDomain, useLawmindRecordsDomain } from "./lawmind-app-shell-domains";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
import {
  writeAllowWebSearchPreference,
} from "./lawmind-web-search-prefs.js";
import type { HealthPayload } from "./lawmind-app-data.js";
import { useFileChatContext } from "./lawmind-file-chat-context";
import { useComposeTruthPins } from "./useComposeTruthPins";
import {
  useLawmindAppBootstrapEffects,
  type LawmindHealthState,
} from "./useLawmindAppBootstrapEffects";
import { useLawmindAppSetupActions } from "./useLawmindAppSetupActions";
import { useLawmindAssistantActions } from "./useLawmindAssistantActions";

export type { ChatSessionListEntry } from "./useLawmindChatShell";
export type { FileChatContextItem } from "./lawmind-file-chat-context";
export { formatFileChatContextPill } from "./lawmind-file-chat-context";
export type { LawmindHealthState } from "./useLawmindAppBootstrapEffects";
export { mapHealthState } from "./useLawmindAppBootstrapEffects";

export function useLawmindAppShell() {
  const [mainView, setMainView] = useState<LawmindMainView>("workspace");
  const [reviewFocusTaskId, setReviewFocusTaskId] = useState<string | null>(null);
  const [reviewFocusMatterId, setReviewFocusMatterId] = useState<string | null>(null);
  const [reviewFocusStatus, setReviewFocusStatus] = useState<ArtifactDraft["reviewStatus"] | "all">("all");
  const [reviewFocusListMode, setReviewFocusListMode] = useState<"pending" | "all">("pending");
  const [matterRefreshVersion, setMatterRefreshVersion] = useState(0);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [health, setHealth] = useState<LawmindHealthState>(null);
  const [healthPayload, setHealthPayload] = useState<HealthPayload | null>(null);
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>(DEFAULT_ASSISTANT_ID);
  const modelConfig = useLawmindModelConfig({
    apiBase: config?.apiBase,
    selectedAssistantId,
  });
  const {
    modelCatalog,
    modelProviders,
    platformProviders,
    platformMode,
    selectedModelId,
    setSelectedModelId: _setSelectedModelId,
    composeModelHint,
    setComposeModelHint,
    composeModelQuickTestBusy,
    refreshModelsCatalog,
    handleModelSelect,
    flashComposeModelHint,
    clearComposeModelHintSoon,
    composeModelQuickTest,
  } = modelConfig;
  const [showWizard, setShowWizard] = useState(false);
  const [wizApiKey, setWizApiKey] = useState("");
  const [wizHasExistingKey, setWizHasExistingKey] = useState(false);
  const [wizBaseUrl, setWizBaseUrl] = useState("https://dashscope.aliyuncs.com/compatible-mode/v1");
  const [wizModel, setWizModel] = useState("qwen-plus");
  const [wizWorkspace, setWizWorkspace] = useState("");
  const [wizBusy, setWizBusy] = useState(false);
  const [wizError, setWizError] = useState<string | null>(null);
  const [wizRetrievalMode, setWizRetrievalMode] = useState<"single" | "dual">("single");
  const [allowWebSearch, setAllowWebSearchState] = useState(false);
  const setAllowWebSearch = useCallback((enabled: boolean) => {
    writeAllowWebSearchPreference(enabled);
    setAllowWebSearchState(enabled);
  }, []);
  const [sideTab, setSideTab] = useState<"tasks" | "history">("tasks");
  const [taskListQuery, setTaskListQuery] = useState("");
  const [listTimeRange, setListTimeRange] = useState<TimeRangeFilter>("all");
  const {
    messagesByAssistant,
    setMessagesByAssistant,
    sessionByAssistant,
    setSessionByAssistant,
    chatSessionList,
    setChatSessionList,
    chatSessionsLoading,
    setChatSessionsLoading,
    loadSessionMessagesIntoState,
    refreshChatSessionListForAssistant,
  } = useLawmindChatShell({
    apiBase: config?.apiBase,
    selectedAssistantId,
  });
  const [showAssistantEditor, setShowAssistantEditor] = useState(false);
  const [editingAssistantId, setEditingAssistantId] = useState<string | null>(null);
  const [assistantDraft, setAssistantDraft] = useState<AssistantEditorDraft>(
    createAssistantDraft("create", []),
  );
  const [asstBusy, setAsstBusy] = useState(false);
  const [asstError, setAsstError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextTaskId, setContextTaskId] = useState<string | null>(null);
  const [contextMatterId, setContextMatterId] = useState<string | null>(null);
  const {
    fileChatContextItems,
    addFileToChatContext,
    removeFileChatContextItem,
    clearFileChatContext,
  } = useFileChatContext(setError, {
    assistantId: selectedAssistantId,
    sessionId: sessionByAssistant[selectedAssistantId],
  });
  const {
    composeTruthPins,
    addComposeTruthPin,
    removeComposeTruthPin,
    clearComposeTruthPins,
  } = useComposeTruthPins(setError, {
    assistantId: selectedAssistantId,
    sessionId: sessionByAssistant[selectedAssistantId],
  });
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [recordsExpanded, setRecordsExpanded] = useState(false);
  const [showSettings, setShowSettingsState] = useState(false);
  const [settingsSectionId, setSettingsSectionId] = useState<LawmindSettingsSectionId>(
    LAWMIND_SETTINGS_DEFAULT_SECTION,
  );
  const [settingsScrollAnchor, setSettingsScrollAnchor] = useState<
    LawmindSettingsScrollAnchorId | undefined
  >(undefined);
  const setShowSettings = useCallback<SetShowSettings>(
    (open, sectionId, scrollAnchorId) => {
      if (typeof open === "function") {
        setShowSettingsState((prev) => {
          const next = open(prev);
          if (!next) {
            setSettingsScrollAnchor(undefined);
          }
          return next;
        });
        return;
      }
      if (open) {
        setSettingsSectionId(sectionId ?? readStoredSettingsSection());
        setSettingsScrollAnchor(scrollAnchorId);
      } else {
        setSettingsScrollAnchor(undefined);
      }
      setShowSettingsState(open);
    },
    [],
  );
  const [showHelp, setShowHelp] = useState(false);
  const [collabExpanded, setCollabExpanded] = useState(false);
  const [collabTab, setCollabTab] = useState<"delegations" | "timeline">("delegations");
  const [revisionBackgroundActive, setRevisionBackgroundActive] = useState(false);
  const [reviewRefreshVersion, setReviewRefreshVersion] = useState(0);

  const recordsDomain = useLawmindRecordsDomain(
    config,
    selectedAssistantId,
    setSelectedAssistantId,
    taskListQuery,
    listTimeRange,
  );
  const detailDomain = useLawmindDetailDomain(config);

  const { tasks, history, assistants, presets, delegations, collabEvents, gateHistory } =
    recordsDomain.state;
  const { filteredTasks, filteredHistory, selectedAssistant, selectedAssistantStats } =
    recordsDomain.derived;
  const { refreshLists, refreshCollaboration, refreshAssistants, applyBootstrapSnapshot } =
    recordsDomain.actions;
  const {
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
  } = detailDomain.state;
  const { openDetail, closeDetail } = detailDomain.actions;

  const {
    collabSummarySettings,
    localServiceReconnecting,
    deskContractBatchDir,
    reconnectLocalService,
    reloadCollabSummary,
  } = useLawmindAppBootstrapEffects({
    config,
    setConfig,
    setHealth,
    setHealthPayload,
    setAllowWebSearchState,
    setShowWizard,
    setWizRetrievalMode,
    setError,
    applyBootstrapSnapshot,
    refreshModelsCatalog,
    showSettings,
  });

  const {
    retrievalSaving,
    draftWithModelSaving,
    applyRetrievalMode,
    applyDraftWithModelEnabled,
    runWizardSave,
    pickWs,
    openApiWizard,
    pickProject,
    clearProject,
  } = useLawmindAppSetupActions({
    config,
    setConfig,
    setHealth,
    setHealthPayload,
    setError,
    applyBootstrapSnapshot,
    reloadCollabSummary,
    showWizard,
    setShowWizard,
    setShowSettings,
    wizApiKey,
    wizBaseUrl,
    wizModel,
    wizWorkspace,
    wizRetrievalMode,
    setWizApiKey,
    setWizHasExistingKey,
    setWizBaseUrl,
    setWizModel,
    setWizWorkspace,
    setWizRetrievalMode,
    setWizBusy,
    setWizError,
    setComposeModelHint,
    clearComposeModelHintSoon,
    refreshModelsCatalog,
  });

  const { openNewAssistant, openEditAssistant, saveAssistant, removeAssistant } =
    useLawmindAssistantActions({
      config,
      selectedAssistantId,
      setSelectedAssistantId,
      assistants,
      presets,
      editingAssistantId,
      assistantDraft,
      setEditingAssistantId,
      setAssistantDraft,
      setShowAssistantEditor,
      setAsstBusy,
      setAsstError,
      setError,
      setSessionByAssistant,
      setMessagesByAssistant,
      refreshAssistants,
    });

  const currentMessages = messagesByAssistant[selectedAssistantId] ?? [];
  const canUseFilesystemBridge = Boolean(
    config &&
      !config.workspaceDir.trim().startsWith("(") &&
      typeof window.lawmindDesktop?.fsList === "function",
  );
  const projectDir = config?.projectDir ?? null;

  const watchBackgroundSessionFnRef = useRef<
    (opts: import("./useLawmindBackgroundWatch.js").BackgroundWatchOpts) => Promise<void>
  >(async () => {});

  const { watchBackgroundSessionProgress, watchBackgroundRevisionSession } = useLawmindBackgroundWatch({
    config,
    sessionByAssistant,
    setMessagesByAssistant,
    setChatSessionList,
    setSessionByAssistant,
    loadSessionMessagesIntoState,
    setMainView,
    setSelectedAssistantId,
    setContextTaskId,
    setRevisionBackgroundActive,
    setReviewFocusTaskId,
    setReviewFocusStatus,
    setReviewFocusListMode,
    setReviewRefreshVersion,
    setMatterRefreshVersion,
    setError,
    flashComposeModelHint,
    refreshLists,
  });

  watchBackgroundSessionFnRef.current = watchBackgroundSessionProgress;

  const {
    selectChatSession,
    openDelegationTargetWorkspaceChat,
    createNewChatSession,
    renameChatSession,
    deleteChatSession,
  } = useLawmindChatSessions({
    config,
    selectedAssistantId,
    sessionByAssistant,
    setSessionByAssistant,
    setChatSessionList,
    setChatSessionsLoading,
    setError,
    loadSessionMessagesIntoState,
    refreshChatSessionListForAssistant,
    watchBackgroundSessionFnRef,
    setMainView,
    setSelectedAssistantId,
    setContextMatterId,
    assistants,
    modelCatalog,
    selectedModelId,
    flashComposeModelHint,
  });

  const activeChatSessionIdForExtras =
    sessionByAssistant[selectedAssistantId] ?? chatSessionList[0]?.sessionId;
  const composeExtras = useLawmindComposeExtras({
    apiBase: config?.apiBase,
    sessionId: activeChatSessionIdForExtras,
    matterId: contextMatterId,
    onCompactMessages: (rows) => {
      const msgs = rows
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          text:
            typeof m.text === "string" ? m.text : typeof m.content === "string" ? m.content : "",
        }));
      setMessagesByAssistant((p) => ({ ...p, [selectedAssistantId]: msgs }));
    },
  });
  const [streamCompactNoticesByAssistant, setStreamCompactNoticesByAssistant] = useState<
    Record<string, string[]>
  >({});

  const {
    abortChatSend,
    sendChatMessage,
    send,
    deleteChatMessageAt,
    editChatMessageAt,
    queuedMessages,
    cancelQueuedMessage,
    clearSendQueue,
  } = useLawmindChatSend({
    config,
    health,
    input,
    loading,
    setLoading,
    setError,
    setInput,
    setShowWizard,
    setShowSettings,
    setComposeModelHint,
    selectedAssistantId,
    selectedModelId,
    modelCatalog,
    sessionByAssistant,
    setSessionByAssistant,
    messagesByAssistant,
    setMessagesByAssistant,
    contextMatterId,
    contextTaskId,
    fileChatContextItems,
    composeTruthPins,
    deskContractBatchDir,
    projectDir,
    allowWebSearch,
    refreshChatSessionListForAssistant,
    refreshLists,
    refreshAssistants,
    refreshCollaboration,
    applyStreamTokenBudget: composeExtras.applyStreamTokenBudget,
    onStreamCompactBoundary: (info) => {
      const dropped =
        typeof info.droppedMessageCount === "number" ? info.droppedMessageCount : 0;
      const label = info.overflowPrune
        ? "上下文较满，已精简后继续"
        : dropped > 0
          ? `对话已自动压缩（约 ${dropped} 条较早消息已折叠）`
          : "对话已自动压缩以腾出上下文空间";
      setStreamCompactNoticesByAssistant((prev) => ({
        ...prev,
        [selectedAssistantId]: [...(prev[selectedAssistantId] ?? []), label],
      }));
      void composeExtras.refreshContextBudget();
    },
    onStreamToolBudget: (info) => {
      const label = `本轮已办理 ${info.used} 步（软预算 ${info.maxToolCalls}），将询问是否继续`;
      setStreamCompactNoticesByAssistant((prev) => ({
        ...prev,
        [selectedAssistantId]: [...(prev[selectedAssistantId] ?? []), label],
      }));
    },
    onTurnComplete: () => {
      void composeExtras.refreshPending();
    },
  });
  useLawmindCollaborationWatch({
    apiBase: config?.apiBase,
    selectedAssistantId,
    sessionByAssistant,
    assistants,
    setMessagesByAssistant,
  });

  const copyMessage = useCallback(async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedMessageIndex(index);
    window.setTimeout(() => {
      setCopiedMessageIndex((previous) => (previous === index ? null : previous));
    }, 2000);
  }, []);

  const clearContext = useCallback(() => {
    setContextTaskId(null);
    setContextMatterId(null);
  }, []);

  const workspaceLabel =
    config?.workspaceDir.split(/[\\/]/).filter(Boolean).pop() ?? "默认工作区";
  const retrievalLabel = config?.retrievalMode === "dual" ? "通用 + 法律" : "统一模型";
  const currentMatterLabel = contextMatterId ?? detailTask?.matterId ?? detailDraft?.matterId ?? null;

  return {
    state: {
      mainView,
      reviewFocusTaskId,
      reviewFocusMatterId,
      reviewFocusStatus,
      reviewFocusListMode,
      matterRefreshVersion,
      config,
      health,
      healthPayload,
      modelCatalog,
      modelProviders,
      platformProviders,
      platformMode,
      selectedModelId,
      showWizard,
      wizApiKey,
      wizHasExistingKey,
      wizBaseUrl,
      wizModel,
      wizWorkspace,
      wizBusy,
      wizError,
      wizRetrievalMode,
      retrievalSaving,
      draftWithModelSaving,
      allowWebSearch,
      sideTab,
      taskListQuery,
      listTimeRange,
      tasks,
      history,
    messagesByAssistant,
    setMessagesByAssistant,
    sessionByAssistant,
    setSessionByAssistant,
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
      setLoading,
      error,
      setError,
      composeModelHint,
      composeModelQuickTestBusy,
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
      composeTruthPins,
      copiedMessageIndex,
      recordsExpanded,
      showSettings,
      settingsSectionId,
      settingsScrollAnchor,
      showHelp,
      collabSummarySettings,
      localServiceReconnecting,
      collabExpanded,
      delegations,
      collabEvents,
      gateHistory,
      collabTab,
      currentMessages,
      deskContractBatchDir,
      chatSessionList,
      chatSessionsLoading,
      activeChatSessionId: sessionByAssistant[selectedAssistantId],
      revisionBackgroundActive,
      reviewRefreshVersion,
      composeExtras,
      streamCompactLabels: streamCompactNoticesByAssistant[selectedAssistantId] ?? [],
    },
    derived: {
      canUseFilesystemBridge,
      projectDir,
      filteredTasks,
      filteredHistory,
      selectedAssistant,
      selectedAssistantStats,
      workspaceLabel,
      retrievalLabel,
      currentMatterLabel,
    },
    actions: {
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
      refreshCollaboration,
      refreshAssistants,
      openDetail,
      closeDetail,
      applyRetrievalMode,
      applyDraftWithModelEnabled,
      reconnectLocalService,
      runWizardSave,
      pickWs,
      pickProject,
      clearProject,
      send,
      abortChatSend,
      sendChatMessage,
      deleteChatMessageAt,
      editChatMessageAt,
      queuedMessages,
      cancelQueuedMessage,
      clearSendQueue,
      openNewAssistant,
      openEditAssistant,
      saveAssistant,
      removeAssistant,
      copyMessage,
      openApiWizard,
      composeModelQuickTest,
      handleModelSelect,
      refreshModelsCatalog,
      clearContext,
      addFileToChatContext,
      removeFileChatContextItem,
      clearFileChatContext,
      addComposeTruthPin,
      removeComposeTruthPin,
      clearComposeTruthPins,
      selectChatSession,
      refreshChatSessionListForAssistant,
      openDelegationTargetWorkspaceChat,
      createNewChatSession,
      renameChatSession,
      deleteChatSession,
      watchBackgroundRevisionSession,
      setMessagesByAssistant,
      setSessionByAssistant,
    },
  };
}

