import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { createAssistantDraft, type AssistantEditorDraft } from "./lawmind-assistant-editor";
import type { LawmindMainView } from "./lawmind-main-view";
import type { TimeRangeFilter } from "./lawmind-time-range";
import { type AppConfig } from "./lawmind-app-bootstrap";
import { useLawmindModelConfig } from "./useLawmindModelConfig";
import { useLawmindChatShell } from "./useLawmindChatShell";
import { useLawmindCollaborationWatch } from "./useLawmindCollaborationWatch";
import { useLawmindBackgroundWatch } from "./useLawmindBackgroundWatch";
import { useLawmindChatSessions } from "./useLawmindChatSessions";
import { useLawmindChatSend, type ForkContinueHandler } from "./useLawmindChatSend";
import { useLawmindComposeExtras } from "./useLawmindComposeExtras";
import { resolveComposeModelSelectValue } from "./lawmind-model-picker-utils";
import { useLawmindDetailDomain, useLawmindRecordsDomain } from "./lawmind-app-shell-domains";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
import { DESK_WRITE_TOOL_NAMES } from "../../../../src/lawmind/agent/tool-name-sets.ts";
import { contextMatterIdAfterCatalogChange } from "./lawmind-chat-scope";
import { shouldSuggestContextFork } from "./LawmindContextForkSuggestion";
import {
  dismissForkSuggestion,
  isForkSuggestionDismissed,
} from "./lawmind-context-fork-pref";

/**
 * 幂等 nonce 由渲染端生成：renderer 不得 value-import 引擎模块
 * （`session-carryover.ts` 会拖进 node:crypto / fs，见
 * `renderer-node-builtins.test.ts`）。只要求「同一源会话重复点击得同一串」。
 */
function newForkNonce(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
import { writeAllowWebSearchPreference } from "./lawmind-web-search-prefs.js";
import { retrievalShareLabel } from "./lawmind-settings-models.ts";
import type { HealthPayload } from "./lawmind-app-data.js";
import { useFileChatContext } from "./lawmind-file-chat-context";
import { useComposeTruthPins } from "./useComposeTruthPins";
import {
  useLawmindAppBootstrapEffects,
  type LawmindHealthState,
} from "./useLawmindAppBootstrapEffects";
import { useLawmindAppSetupActions } from "./useLawmindAppSetupActions";
import { useLawmindAssistantActions } from "./useLawmindAssistantActions";
import { LAWMIND_REPLICA_JOINED_EVENT } from "./matter/MatterReplicaPanel";

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
  useEffect(() => {
    const onJoined = () => setMatterRefreshVersion((v) => v + 1);
    window.addEventListener(LAWMIND_REPLICA_JOINED_EVENT, onJoined);
    return () => window.removeEventListener(LAWMIND_REPLICA_JOINED_EVENT, onJoined);
  }, []);
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
    platformProviders,
    platformMode,
    selectedModelId,
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
  const [wizBaseUrl, setWizBaseUrl] = useState("https://api.deepseek.com/v1");
  const [wizModel, setWizModel] = useState("deepseek-flash");
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
    carriedOverFromBySession,
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
  });

  const {
    retrievalSaving,
    draftWithModelSaving,
    applyRetrievalMode,
    applyDraftWithModelEnabled,
    npcSaving,
    applyOpenLawNpc,
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

  const {
    openNewAssistant,
    openEditAssistant,
    saveAssistant,
    removeAssistant,
    duplicateAssistant,
    patchAssistantRoster,
  } = useLawmindAssistantActions({
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
  const noteFocusedChatSessionRef = useRef<
    (focus: { assistantId: string; sessionId: string | undefined }) => void
  >(() => {});
  const abortLiveChatSessionRef = useRef<(sessionId: string) => void>(() => {});
  const hasLiveClientTurnRef = useRef<(sessionId: string) => boolean>(() => false);
  const reattachLiveChatSessionRef = useRef<(sessionId: string) => void>(() => {});

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

  const knownChatMatterIdsRef = useRef<ReadonlySet<string> | null>(null);
  const previousKnownChatMatterIdsRef = useRef<ReadonlySet<string> | null>(null);
  const [knownChatMatterTick, setKnownChatMatterTick] = useState(0);
  const setKnownChatMatterIds = useCallback((ids: readonly string[]) => {
    previousKnownChatMatterIdsRef.current = knownChatMatterIdsRef.current;
    knownChatMatterIdsRef.current = new Set(ids);
    setKnownChatMatterTick((version) => version + 1);
  }, []);
  useEffect(() => {
    setContextMatterId((current) =>
      contextMatterIdAfterCatalogChange(
        current,
        previousKnownChatMatterIdsRef.current,
        knownChatMatterIdsRef.current,
      ),
    );
  }, [knownChatMatterTick]);
  const {
    chatListScope,
    selectChatSession,
    openChatListScope,
    focusAssistantInCurrentScope,
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
    chatSessionList,
    setMessagesByAssistant,
    knownChatMatterIdsRef,
    knownChatMatterTick,
    noteFocusedChatSessionRef,
    abortLiveChatSessionRef,
    hasLiveClientTurnRef,
    reattachLiveChatSessionRef,
  });

  const activeChatSessionIdForExtras = sessionByAssistant[selectedAssistantId];
  const composeExtras = useLawmindComposeExtras({
    apiBase: config?.apiBase,
    sessionId: activeChatSessionIdForExtras,
    matterId: contextMatterId,
    // 分母跟 compose 选中的模型（与 /api/chat 请求体同一个值）；切模型即刷新。
    modelId: resolveComposeModelSelectValue(modelCatalog, selectedModelId),
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
  /** 对话里要求「另起新对话并带上文」时，发送路径在模型看见原文之前调用。 */
  const forkContinueRef = useRef<ForkContinueHandler | null>(null);
  /** 建议卡关掉后要重渲染（判定读的是 localStorage，不是 state，故只取 setter）。 */
  const [, bumpContextForkVersion] = useState(0);
  /** 同一源会话复用同一个 nonce：连点两次只复用一个新会话，不造第二份。 */
  const forkNonceRef = useRef<{ sessionId: string; nonce: string } | null>(null);

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
        ? "较早的检索结果已收短，继续办"
        : dropped > 0
          ? "较早的来回已收成要点，继续办"
          : "这场对话已整理，继续办";
      setStreamCompactNoticesByAssistant((prev) => ({
        ...prev,
        [selectedAssistantId]: [...(prev[selectedAssistantId] ?? []), label],
      }));
      void composeExtras.refreshContextBudget();
    },
    onStreamToolBudget: (info) => {
      const label = `本轮已办理 ${info.used} 步，继续办理中`;
      setStreamCompactNoticesByAssistant((prev) => ({
        ...prev,
        [selectedAssistantId]: [...(prev[selectedAssistantId] ?? []), label],
      }));
    },
    onTurnComplete: (info) => {
      void composeExtras.refreshPending();
      // 对话里发生过工作台写穿（卷宗/期限/建案）时，立刻刷新案件管理列表与卷宗视图。
      if (info.toolNames.some((name) => DESK_WRITE_TOOL_NAMES.has(name))) {
        setMatterRefreshVersion((v) => v + 1);
      }
    },
    loadSessionMessagesIntoState,
    noteFocusedChatSessionRef,
    abortLiveChatSessionRef,
    hasLiveClientTurnRef,
    reattachLiveChatSessionRef,
    forkContinueRef,
  });
  useLawmindCollaborationWatch({
    apiBase: config?.apiBase,
    selectedAssistantId,
    sessionByAssistant,
    assistants,
    setMessagesByAssistant,
  });

  /**
   * 另起新对话并带上文：源会话的整理稿作为续接种子进新会话，然后切过去。
   * 失败（回合在跑 / 有待批准授权）如实说明——不静默丢授权。
   */
  const handleForkWithCarryover = useCallback(async (sourceSessionId?: string) => {
    const source = (sourceSessionId ?? sessionByAssistant[selectedAssistantId] ?? "").trim();
    if (!source) {
      const message = "当前没有可续接的对话。";
      setStreamCompactNoticesByAssistant((prev) => ({
        ...prev,
        [selectedAssistantId]: [...(prev[selectedAssistantId] ?? []), message],
      }));
      return { ok: false as const, message };
    }
    if (forkNonceRef.current?.sessionId !== source) {
      forkNonceRef.current = { sessionId: source, nonce: newForkNonce() };
    }
    const result = await composeExtras.forkWithCarryover({
      clientNonce: forkNonceRef.current.nonce,
      sessionId: source,
    });
    if (!result.ok) {
      setStreamCompactNoticesByAssistant((prev) => ({
        ...prev,
        [selectedAssistantId]: [...(prev[selectedAssistantId] ?? []), result.message],
      }));
      return { ok: false as const, message: result.message };
    }
    await refreshChatSessionListForAssistant(selectedAssistantId);
    await selectChatSession(result.sessionId, selectedAssistantId);
    const carried =
      typeof result.stats?.droppedMessageCount === "number" && result.stats.droppedMessageCount > 0
        ? `（已带上 ${result.stats.droppedMessageCount} 条对话的整理稿）`
        : "（已带上整理稿）";
    setStreamCompactNoticesByAssistant((prev) => ({
      ...prev,
      [selectedAssistantId]: [...(prev[selectedAssistantId] ?? []), `已另起新对话${carried}`],
    }));
    return { ok: true as const, sessionId: result.sessionId };
  }, [
    composeExtras,
    refreshChatSessionListForAssistant,
    selectChatSession,
    selectedAssistantId,
    sessionByAssistant,
  ]);
  forkContinueRef.current = handleForkWithCarryover;

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
  const retrievalLabel = retrievalShareLabel(config?.retrievalMode);
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
      chatListScope,
      chatSessionsLoading,
      activeChatSessionId: sessionByAssistant[selectedAssistantId],
      revisionBackgroundActive,
      reviewRefreshVersion,
      composeExtras,
      streamCompactLabels: streamCompactNoticesByAssistant[selectedAssistantId] ?? [],
      contextFork: {
        ...(carriedOverFromBySession[activeChatSessionIdForExtras ?? ""]
          ? { carriedOverFrom: carriedOverFromBySession[activeChatSessionIdForExtras ?? ""] }
          : {}),
        // 一次性建议：已被压过（回合内）或压了 >= 2 次，且律师没关过这张卡。
        showSuggestion:
          !isForkSuggestionDismissed(activeChatSessionIdForExtras) &&
          shouldSuggestContextFork(composeExtras.contextBudget),
        busy: composeExtras.forkBusy,
        onFork: () => void handleForkWithCarryover(),
        onDismiss: () => {
          dismissForkSuggestion(activeChatSessionIdForExtras);
          bumpContextForkVersion((v) => v + 1);
        },
      },
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
      npcSaving,
      applyOpenLawNpc,
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
      duplicateAssistant,
      patchAssistantRoster,
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
      openChatListScope,
      focusAssistantInCurrentScope,
      setKnownChatMatterIds,
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

