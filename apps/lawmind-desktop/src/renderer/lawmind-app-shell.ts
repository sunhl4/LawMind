import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { createAssistantDraft, deleteAssistant, saveAssistantDraft, type AssistantEditorDraft } from "./lawmind-assistant-editor";
import { removeAssistantChatState } from "./lawmind-chat";
import type { CollabSummaryState } from "./LawmindSettingsCollaboration";
import { clearProjectDirectory } from "./lawmind-settings-shell";
import type { TimeRangeFilter } from "./lawmind-time-range";
import { errorMessage } from "./api-client";
import {
  loadAppBootstrapSnapshot,
  loadInitialAppConfig,
  loadSettingsCollaborationState,
  refreshLocalAppConfig,
  type AppConfig,
} from "./lawmind-app-bootstrap";
import { setDraftWithModelEnabled } from "./lawmind-models-api";
import { useLawmindModelConfig } from "./useLawmindModelConfig";
import {
  useLawmindChatShell,
  type ChatSessionListEntry,
  clearStoredActiveChatSessionForAssistant,
} from "./useLawmindChatShell";
import { useLawmindCollaborationWatch } from "./useLawmindCollaborationWatch";
import { useLawmindBackgroundWatch } from "./useLawmindBackgroundWatch";
import { useLawmindChatSessions } from "./useLawmindChatSessions";
import { useLawmindChatSend } from "./useLawmindChatSend";
import { useLawmindComposeExtras } from "./useLawmindComposeExtras";
import { useLawmindDetailDomain, useLawmindRecordsDomain } from "./lawmind-app-shell-domains";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
import {
  readAllowWebSearchPreference,
  writeAllowWebSearchPreference,
} from "./lawmind-web-search-prefs.js";
import type { HealthPayload } from "./lawmind-app-data.js";

const MAX_FILE_CHAT_CONTEXT = 8;

export type { ChatSessionListEntry } from "./useLawmindChatShell";

export type FileChatContextItem = {
  id: string;
  root: "workspace" | "project";
  relPath: string;
  kind: "file" | "directory";
};

export function formatFileChatContextPill(
  it: FileChatContextItem,
  maxPath = 24,
): { shortLabel: string; title: string } {
  const scope = it.root === "workspace" ? "工作区" : "项目";
  const kind = it.kind === "directory" ? "目录" : "文件";
  const path = it.relPath.trim() || scope;
  const title = `${scope} ${kind}：${it.relPath || "（根）"}`;
  const ellipsize = (s: string) => (s.length <= maxPath ? s : `…${s.slice(-(maxPath - 1))}`);
  return { shortLabel: `${kind === "目录" ? "📁" : "📄"} ${ellipsize(path)}`, title };
}

function makeFileContextItemId(
  p: Pick<FileChatContextItem, "root" | "relPath" | "kind">,
): string {
  return `${p.root}|${p.kind}|${encodeURIComponent(p.relPath)}`;
}
export type LawmindHealthState = {
  modelConfigured: boolean;
  retrievalMode?: string;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
  webSearchPolicyBlocked?: boolean;
  modelName?: string | null;
  modelEnvFileExists?: boolean;
  draftWithModelEnabled?: boolean;
  draftWithModelActive?: boolean;
} | null;

export function mapHealthState(payload: {
  modelConfigured?: boolean;
  retrievalMode?: string;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
  modelName?: string | null;
  modelEnvFileExists?: boolean;
  draftWithModelEnabled?: boolean;
  draftWithModelActive?: boolean;
  policy?: HealthPayload["policy"];
}): NonNullable<LawmindHealthState> {
  return {
    modelConfigured: Boolean(payload.modelConfigured),
    retrievalMode: typeof payload.retrievalMode === "string" ? payload.retrievalMode : undefined,
    dualLegalConfigured: Boolean(payload.dualLegalConfigured),
    webSearchApiKeyConfigured: Boolean(payload.webSearchApiKeyConfigured),
    webSearchPolicyBlocked: payload.policy?.allowWebSearch === false,
    modelName: typeof payload.modelName === "string" ? payload.modelName : null,
    modelEnvFileExists: Boolean(payload.modelEnvFileExists),
    draftWithModelEnabled: payload.draftWithModelEnabled === true,
    draftWithModelActive: payload.draftWithModelActive === true,
  };
}

export function useLawmindAppShell() {
  const [mainView, setMainView] = useState<"workspace" | "collaboration" | "review">("workspace");
  const [reviewFocusTaskId, setReviewFocusTaskId] = useState<string | null>(null);
  const [reviewFocusMatterId, setReviewFocusMatterId] = useState<string | null>(null);
  const [reviewFocusStatus, setReviewFocusStatus] = useState<ArtifactDraft["reviewStatus"] | "all">("all");
  const [reviewFocusListMode, setReviewFocusListMode] = useState<"pending" | "all">("pending");
  const [matterRefreshVersion, setMatterRefreshVersion] = useState(0);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [health, setHealth] = useState<LawmindHealthState>(null);
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
  const [retrievalSaving, setRetrievalSaving] = useState(false);
  const [draftWithModelSaving, setDraftWithModelSaving] = useState(false);
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
  const [fileChatContextItems, setFileChatContextItems] = useState<FileChatContextItem[]>([]);
  const fileChatContextRef = useRef<FileChatContextItem[]>([]);
  fileChatContextRef.current = fileChatContextItems;
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [recordsExpanded, setRecordsExpanded] = useState(false);
  /** 工作区 `lawmind/desk-settings.json`：批量合同材料目录（相对工作区根） */
  const [deskContractBatchDir, setDeskContractBatchDir] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [collabSummarySettings, setCollabSummarySettings] = useState<CollabSummaryState>(undefined);
  const [localServiceReconnecting, setLocalServiceReconnecting] = useState(false);
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

  const currentMessages = messagesByAssistant[selectedAssistantId] ?? [];
  const canUseFilesystemBridge = Boolean(config && !config.workspaceDir.trim().startsWith("("));
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
  });
  const [streamCompactNoticesByAssistant, setStreamCompactNoticesByAssistant] = useState<
    Record<string, string[]>
  >({});

  const {
    abortChatSend,
    sendChatMessage,
    send,
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
      const label =
        dropped > 0
          ? `对话已自动压缩（约 ${dropped} 条较早消息已折叠）`
          : "对话已自动压缩以腾出上下文空间";
      setStreamCompactNoticesByAssistant((prev) => ({
        ...prev,
        [selectedAssistantId]: [...(prev[selectedAssistantId] ?? []), label],
      }));
      void composeExtras.refreshContextBudget();
    },
  });
  useEffect(() => {
    void (async () => {
      try {
        const nextConfig = await loadInitialAppConfig();
        setConfig(nextConfig);
        setWizRetrievalMode(nextConfig.retrievalMode);
      } catch (cause) {
        setError(errorMessage(cause, "加载 LawMind 配置失败"));
      }
    })();
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }
    void (async () => {
      try {
        const snapshot = await loadAppBootstrapSnapshot(config.apiBase);
        const nextHealth = mapHealthState(snapshot.health);
        setHealth(nextHealth);
        setAllowWebSearchState(
          nextHealth.webSearchPolicyBlocked
            ? false
            : readAllowWebSearchPreference(nextHealth.webSearchApiKeyConfigured === true),
        );
        if (!nextHealth.modelConfigured) {
          setShowWizard(true);
        }
        applyBootstrapSnapshot(snapshot);
        await refreshModelsCatalog(config.apiBase);
      } catch (cause) {
        setError(errorMessage(cause, "加载 LawMind 配置失败"));
      }
    })();
  }, [applyBootstrapSnapshot, config, refreshModelsCatalog]);

  const loadCollabSummaryForApi = useCallback(async (apiBase: string) => {
    return loadSettingsCollaborationState(apiBase);
  }, []);

  const reloadCollabSummary = useCallback(
    async (apiBase: string, opts?: { refreshConfigOnFailure?: boolean }) => {
      try {
        const nextState = await loadCollabSummaryForApi(apiBase);
        setCollabSummarySettings(nextState);
        return nextState;
      } catch {
        if (!opts?.refreshConfigOnFailure) {
          setCollabSummarySettings(null);
          return null;
        }
        const fresh = await refreshLocalAppConfig(config);
        if (!fresh || fresh.apiBase === apiBase) {
          setCollabSummarySettings(null);
          return null;
        }
        setConfig(fresh);
        try {
          const retried = await loadCollabSummaryForApi(fresh.apiBase);
          setCollabSummarySettings(retried);
          return retried;
        } catch {
          setCollabSummarySettings(null);
          return null;
        }
      }
    },
    [config, loadCollabSummaryForApi],
  );

  const reconnectLocalService = useCallback(async () => {
    setLocalServiceReconnecting(true);
    setError(null);
    try {
      const fresh = await refreshLocalAppConfig(config);
      if (!fresh) {
        throw new Error("无法读取桌面配置，请完全退出并重新打开 LawMind。");
      }
      setConfig(fresh);
      const snapshot = await loadAppBootstrapSnapshot(fresh.apiBase);
      const nextHealth = mapHealthState(snapshot.health);
      setHealth(nextHealth);
      setAllowWebSearchState(
        nextHealth.webSearchPolicyBlocked
          ? false
          : readAllowWebSearchPreference(nextHealth.webSearchApiKeyConfigured === true),
      );
      applyBootstrapSnapshot(snapshot);
      await refreshModelsCatalog(fresh.apiBase);
      await reloadCollabSummary(fresh.apiBase);
    } catch (cause) {
      setCollabSummarySettings(null);
      setError(errorMessage(cause, "重新连接本地服务失败"));
    } finally {
      setLocalServiceReconnecting(false);
    }
  }, [applyBootstrapSnapshot, config, refreshModelsCatalog, reloadCollabSummary]);
  useEffect(() => {
    if (!config?.apiBase) {
      return;
    }
    void reloadCollabSummary(config.apiBase, { refreshConfigOnFailure: true });
  }, [config?.apiBase, reloadCollabSummary]);

  useEffect(() => {
    if (!showSettings || !config?.apiBase) {
      return;
    }
    void reloadCollabSummary(config.apiBase, { refreshConfigOnFailure: true });
  }, [showSettings, config?.apiBase, reloadCollabSummary]);

  useLawmindCollaborationWatch({
    apiBase: config?.apiBase,
    selectedAssistantId,
    sessionByAssistant,
    assistants,
    setMessagesByAssistant,
  });

  const reloadDeskSettings = useCallback(async () => {
    if (!config?.apiBase) {
      return;
    }
    try {
      const r = await fetch(`${config.apiBase}/api/workspace/desk-settings`);
      if (!r.ok) {
        return;
      }
      const j = (await r.json()) as { ok?: boolean; settings?: { contractBatchRelativeDir?: string } };
      const dir = j.settings?.contractBatchRelativeDir;
      setDeskContractBatchDir(typeof dir === "string" ? dir : "");
    } catch {
      /* ignore */
    }
  }, [config?.apiBase]);

  useEffect(() => {
    void reloadDeskSettings();
  }, [reloadDeskSettings]);

  const applyRetrievalMode = useCallback(
    async (mode: "single" | "dual") => {
      const bridge = window.lawmindDesktop;
      if (!bridge?.setRetrievalMode || !config) {
        return;
      }
      setRetrievalSaving(true);
      setError(null);
      try {
        const response = await bridge.setRetrievalMode(mode);
        if (!response.ok) {
          throw new Error(response.error || "切换失败");
        }
        const nextBase = response.apiBase ?? config.apiBase;
        const nextMode: "single" | "dual" =
          response.retrievalMode === "dual"
            ? "dual"
            : response.retrievalMode === "single"
              ? "single"
              : mode;
        setConfig({ ...config, apiBase: nextBase, retrievalMode: nextMode });
        const snapshot = await loadAppBootstrapSnapshot(nextBase);
        setHealth(mapHealthState(snapshot.health));
        applyBootstrapSnapshot(snapshot);
      } catch (cause) {
        setError(errorMessage(cause, "切换检索模式失败"));
      } finally {
        setRetrievalSaving(false);
      }
    },
    [applyBootstrapSnapshot, config],
  );

  const applyDraftWithModelEnabled = useCallback(
    async (enabled: boolean) => {
      if (!config?.apiBase) {
        return;
      }
      setDraftWithModelSaving(true);
      setError(null);
      try {
        const result = await setDraftWithModelEnabled(config.apiBase, enabled);
        setHealth((prev) =>
          prev
            ? {
                ...prev,
                draftWithModelEnabled: result.draftWithModelEnabled,
                draftWithModelActive: result.draftWithModelActive,
              }
            : prev,
        );
        const snapshot = await loadAppBootstrapSnapshot(config.apiBase);
        setHealth(mapHealthState(snapshot.health));
      } catch (cause) {
        setError(errorMessage(cause, "更新起草模型设置失败"));
      } finally {
        setDraftWithModelSaving(false);
      }
    },
    [config?.apiBase],
  );

  const runWizardSave = useCallback(async () => {
    const bridge = window.lawmindDesktop;
    if (!bridge?.saveSetup) {
      return;
    }
    setWizBusy(true);
    setWizError(null);
    try {
      const response = await bridge.saveSetup({
        apiKey: wizApiKey.trim(),
        baseUrl: wizBaseUrl.trim() || undefined,
        model: wizModel.trim() || undefined,
        workspaceDir: wizWorkspace.trim() || undefined,
        retrievalMode: wizRetrievalMode,
      });
      if (!response.ok) {
        throw new Error(response.error || "保存或验证失败");
      }
      if (response.verified === false) {
        throw new Error(response.error || "模型连接验证未通过");
      }
      if (response.apiBase && response.workspaceDir && response.envFilePath) {
        const nextMode =
          response.retrievalMode === "dual" || wizRetrievalMode === "dual" ? "dual" : "single";
        setConfig({
          apiBase: response.apiBase,
          workspaceDir: response.workspaceDir,
          projectDir: config?.projectDir ?? null,
          envFilePath: response.envFilePath,
          retrievalMode: nextMode,
        });
        setWizRetrievalMode(nextMode);
      }
      setShowWizard(false);
      setWizApiKey("");
      setWizHasExistingKey(true);
      const verifyNote =
        typeof response.latencyMs === "number"
          ? `模型已验证可用（${response.latencyMs} ms），配置已保存到本机。`
          : "模型已验证可用，配置已保存到本机。";
      setComposeModelHint(verifyNote);
      clearComposeModelHintSoon(12_000);
      const apiBaseNext = response.apiBase ?? config?.apiBase;
      if (!apiBaseNext) {
        throw new Error("missing api base after save");
      }
      const snapshot = await loadAppBootstrapSnapshot(apiBaseNext);
      setHealth(mapHealthState(snapshot.health));
      applyBootstrapSnapshot(snapshot);
      await refreshModelsCatalog(apiBaseNext);
    } catch (cause) {
      setWizError(errorMessage(cause, "保存配置失败"));
    } finally {
      setWizBusy(false);
    }
  }, [
    applyBootstrapSnapshot,
    clearComposeModelHintSoon,
    config,
    refreshModelsCatalog,
    wizApiKey,
    wizBaseUrl,
    wizModel,
    wizRetrievalMode,
    wizWorkspace,
  ]);

  const pickWs = useCallback(async () => {
    const bridge = window.lawmindDesktop;
    if (!bridge?.pickWorkspace) {
      return;
    }
    const response = await bridge.pickWorkspace();
    if (response.ok && response.path) {
      setWizWorkspace(response.path);
    }
  }, []);

  const pickProject = useCallback(async () => {
    const bridge = window.lawmindDesktop;
    if (!bridge?.pickProject || !bridge.setProjectDir || !config) {
      return;
    }
    const response = await bridge.pickProject();
    if (response.ok && response.path) {
      const setResult = await bridge.setProjectDir(response.path);
      if (!setResult.ok) {
        setError(setResult.error || "设置项目目录失败");
        return;
      }
      const nextApiBase =
        typeof setResult.apiBase === "string" && setResult.apiBase.trim()
          ? setResult.apiBase.trim()
          : config.apiBase;
      setConfig({
        ...config,
        apiBase: nextApiBase,
        projectDir: setResult.projectDir ?? null,
      });
      if (nextApiBase !== config.apiBase) {
        void reloadCollabSummary(nextApiBase, { refreshConfigOnFailure: true });
      }
    }
  }, [config, reloadCollabSummary]);

  const addFileToChatContext = useCallback(
    (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => {
      const prev = fileChatContextRef.current;
      const id = makeFileContextItemId(payload);
      if (prev.some((x) => x.id === id)) {
        return;
      }
      if (prev.length >= MAX_FILE_CHAT_CONTEXT) {
        setError(`最多同时引用 ${MAX_FILE_CHAT_CONTEXT} 个路径，请先在对话区移除部分。`);
        return;
      }
      setError(null);
      setFileChatContextItems([...prev, { id, ...payload }]);
    },
    [],
  );

  const removeFileChatContextItem = useCallback((id: string) => {
    setFileChatContextItems((previous) => previous.filter((x) => x.id !== id));
  }, []);

  const clearFileChatContext = useCallback(() => {
    setFileChatContextItems([]);
  }, []);

  const clearProject = useCallback(async () => {
    const result = await clearProjectDirectory({
      config,
      setProjectDir: window.lawmindDesktop?.setProjectDir,
    });
    if (result.error) {
      setError(result.error);
      return;
    }
    if (config && result.projectDir !== undefined) {
      const nextApiBase =
        typeof result.apiBase === "string" && result.apiBase.trim()
          ? result.apiBase.trim()
          : config.apiBase;
      setConfig({ ...config, apiBase: nextApiBase, projectDir: result.projectDir });
      if (nextApiBase !== config.apiBase) {
        void reloadCollabSummary(nextApiBase, { refreshConfigOnFailure: true });
      }
    }
  }, [config, reloadCollabSummary]);
  const openNewAssistant = useCallback(() => {
    setEditingAssistantId(null);
    setAssistantDraft(createAssistantDraft("create", presets));
    setAsstError(null);
    setShowAssistantEditor(true);
  }, [presets]);

  const openEditAssistant = useCallback(() => {
    const assistant = assistants.find((entry) => entry.assistantId === selectedAssistantId);
    if (!assistant) {
      return;
    }
    setEditingAssistantId(assistant.assistantId);
    setAssistantDraft(createAssistantDraft("edit", presets, assistant));
    setAsstError(null);
    setShowAssistantEditor(true);
  }, [assistants, presets, selectedAssistantId]);

  const saveAssistant = useCallback(async () => {
    if (!config) {
      return;
    }
    setAsstBusy(true);
    setAsstError(null);
    try {
      const result = await saveAssistantDraft({
        apiBase: config.apiBase,
        editingAssistantId,
        draft: assistantDraft,
      });
      if (result.assistant?.assistantId) {
        setSelectedAssistantId(result.assistant.assistantId);
      }
      setShowAssistantEditor(false);
      await refreshAssistants();
    } catch (cause) {
      setAsstError(errorMessage(cause, "保存助手失败"));
    } finally {
      setAsstBusy(false);
    }
  }, [assistantDraft, config, editingAssistantId, refreshAssistants]);

  const removeAssistant = useCallback(async () => {
    if (!config || selectedAssistantId === DEFAULT_ASSISTANT_ID) {
      return;
    }
    if (!window.confirm("确定删除该助手？其会话记录仍保留在工作区。")) {
      return;
    }
    try {
      if (!config.workspaceDir.trim().startsWith("(")) {
        clearStoredActiveChatSessionForAssistant(config.workspaceDir, selectedAssistantId);
      }
      await deleteAssistant(config.apiBase, selectedAssistantId);
      setSessionByAssistant((previous) => removeAssistantChatState(previous, selectedAssistantId));
      setMessagesByAssistant((previous) => removeAssistantChatState(previous, selectedAssistantId));
      setSelectedAssistantId(DEFAULT_ASSISTANT_ID);
      await refreshAssistants();
    } catch (cause) {
      setError(errorMessage(cause, "删除助手失败"));
    }
  }, [config, refreshAssistants, selectedAssistantId]);

  const copyMessage = useCallback(async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedMessageIndex(index);
    window.setTimeout(() => {
      setCopiedMessageIndex((previous) => (previous === index ? null : previous));
    }, 2000);
  }, []);

  const openApiWizard = useCallback(() => {
    if (!config) {
      return;
    }
    setWizRetrievalMode(config.retrievalMode);
    setWizError(null);
    setShowWizard(true);
    setShowSettings(false);
    void (async () => {
      const bridge = window.lawmindDesktop;
      if (!bridge?.readModelSettings) {
        return;
      }
      try {
        const meta = await bridge.readModelSettings();
        if (!meta.ok) {
          return;
        }
        setWizHasExistingKey(Boolean(meta.hasApiKey));
        if (typeof meta.baseUrl === "string" && meta.baseUrl.trim()) {
          setWizBaseUrl(meta.baseUrl.trim());
        }
        if (typeof meta.model === "string" && meta.model.trim()) {
          setWizModel(meta.model.trim());
        }
      } catch {
        /* ignore — wizard still usable with defaults */
      }
    })();
  }, [config]);

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
      copiedMessageIndex,
      recordsExpanded,
      showSettings,
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

