import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { createAssistantDraft, deleteAssistant, saveAssistantDraft, type AssistantEditorDraft } from "./lawmind-assistant-editor";
import { appendChatMessage, removeAssistantChatState, sendChatTurn, type ChatMsg } from "./lawmind-chat";
import type { CollabSummaryState } from "./LawmindSettingsCollaboration";
import { clearProjectDirectory } from "./lawmind-settings-shell";
import type { TimeRangeFilter } from "./lawmind-sidebar";
import { errorMessage } from "./api-client";
import {
  loadAppBootstrapSnapshot,
  loadInitialAppConfig,
  loadSettingsCollaborationState,
  type AppConfig,
} from "./lawmind-app-bootstrap";
import { useLawmindDetailDomain, useLawmindRecordsDomain } from "./lawmind-app-shell-domains";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";

const MAX_FILE_CHAT_CONTEXT = 8;

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

function buildFileContextMessagePrefix(items: FileChatContextItem[]): string {
  if (items.length === 0) {
    return "";
  }
  const lines = items.map((it) => {
    const scope = it.root === "workspace" ? "工作区" : "项目";
    const p = it.relPath || "（工作区/项目根，谨慎操作）";
    if (it.root === "workspace") {
      const hint =
        it.kind === "directory"
          ? "请先在目录中定位要读的文件，用 analyze_document 读工作区相对路径。"
          : "请用 analyze_document 读取以下工作区相对路径。";
      return `- [${scope} · ${it.kind === "directory" ? "目录" : "文件"}] \`${p}\` — ${hint}`;
    }
    const hint =
      it.kind === "directory"
        ? "对项目内文件用 read_project_file(相对项目根的路径) 逐份阅读；目录下请先列举再选读。"
        : "请用 read_project_file 读取。";
    return `- [${scope} · ${it.kind === "directory" ? "目录" : "文件"}] \`${p}\` — ${hint}`;
  });
  return `【用户在 LawMind 文件页将下列路径标为“本回合重点”】\n${lines.join("\n")}\n\n`;
}

export type LawmindHealthState = {
  modelConfigured: boolean;
  retrievalMode?: string;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
} | null;

export function mapHealthState(payload: {
  modelConfigured?: boolean;
  retrievalMode?: string;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
}): NonNullable<LawmindHealthState> {
  return {
    modelConfigured: Boolean(payload.modelConfigured),
    retrievalMode: typeof payload.retrievalMode === "string" ? payload.retrievalMode : undefined,
    dualLegalConfigured: Boolean(payload.dualLegalConfigured),
    webSearchApiKeyConfigured: Boolean(payload.webSearchApiKeyConfigured),
  };
}

export function useLawmindAppShell() {
  const [mainView, setMainView] = useState<"chat" | "files" | "matters" | "review">("chat");
  const [reviewFocusTaskId, setReviewFocusTaskId] = useState<string | null>(null);
  const [reviewFocusMatterId, setReviewFocusMatterId] = useState<string | null>(null);
  const [reviewFocusStatus, setReviewFocusStatus] = useState<ArtifactDraft["reviewStatus"] | "all">("all");
  const [reviewFocusListMode, setReviewFocusListMode] = useState<"pending" | "all">("pending");
  const [matterRefreshVersion, setMatterRefreshVersion] = useState(0);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [health, setHealth] = useState<LawmindHealthState>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizApiKey, setWizApiKey] = useState("");
  const [wizBaseUrl, setWizBaseUrl] = useState("https://dashscope.aliyuncs.com/compatible-mode/v1");
  const [wizModel, setWizModel] = useState("qwen-plus");
  const [wizWorkspace, setWizWorkspace] = useState("");
  const [wizBusy, setWizBusy] = useState(false);
  const [wizError, setWizError] = useState<string | null>(null);
  const [wizRetrievalMode, setWizRetrievalMode] = useState<"single" | "dual">("single");
  const [retrievalSaving, setRetrievalSaving] = useState(false);
  const [allowWebSearch, setAllowWebSearch] = useState(false);
  const [sideTab, setSideTab] = useState<"tasks" | "history">("tasks");
  const [taskListQuery, setTaskListQuery] = useState("");
  const [listTimeRange, setListTimeRange] = useState<TimeRangeFilter>("all");
  const [messagesByAssistant, setMessagesByAssistant] = useState<Record<string, ChatMsg[]>>({});
  const [sessionByAssistant, setSessionByAssistant] = useState<Record<string, string | undefined>>({});
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>(DEFAULT_ASSISTANT_ID);
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
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [collabSummarySettings, setCollabSummarySettings] = useState<CollabSummaryState>(undefined);
  const [collabExpanded, setCollabExpanded] = useState(false);
  const [collabTab, setCollabTab] = useState<"delegations" | "timeline">("delegations");

  const recordsDomain = useLawmindRecordsDomain(
    config,
    selectedAssistantId,
    setSelectedAssistantId,
    taskListQuery,
    listTimeRange,
  );
  const detailDomain = useLawmindDetailDomain(config);

  const { tasks, history, assistants, presets, delegations, collabEvents } = recordsDomain.state;
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
        if (!nextHealth.modelConfigured) {
          setShowWizard(true);
        }
        applyBootstrapSnapshot(snapshot);
      } catch (cause) {
        setError(errorMessage(cause, "加载 LawMind 配置失败"));
      }
    })();
  }, [applyBootstrapSnapshot, config]);

  useEffect(() => {
    if (!showSettings || !config) {
      return;
    }
    let cancelled = false;
    setCollabSummarySettings(undefined);
    void (async () => {
      try {
        const nextState = await loadSettingsCollaborationState(config.apiBase);
        if (!cancelled) {
          setCollabSummarySettings(nextState);
        }
      } catch {
        if (!cancelled) {
          setCollabSummarySettings(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showSettings, config]);

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
        throw new Error(response.error || "save failed");
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
      const apiBaseNext = response.apiBase ?? config?.apiBase;
      if (!apiBaseNext) {
        throw new Error("missing api base after save");
      }
      const snapshot = await loadAppBootstrapSnapshot(apiBaseNext);
      setHealth(mapHealthState(snapshot.health));
      applyBootstrapSnapshot(snapshot);
    } catch (cause) {
      setWizError(errorMessage(cause, "保存配置失败"));
    } finally {
      setWizBusy(false);
    }
  }, [applyBootstrapSnapshot, config, wizApiKey, wizBaseUrl, wizModel, wizRetrievalMode, wizWorkspace]);

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
      setConfig({ ...config, projectDir: setResult.projectDir ?? null });
    }
  }, [config]);

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
      setConfig({ ...config, projectDir: result.projectDir });
    }
  }, [config]);

  const sendChatMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || !config || loading) {
        return;
      }
      const prefix = buildFileContextMessagePrefix(fileChatContextItems);
      const messageForApi = prefix ? `${prefix}${text}` : text;
      const assistantId = selectedAssistantId;
      setError(null);
      setInput("");
      setMessagesByAssistant((previous) =>
        appendChatMessage(previous, assistantId, { role: "user", text }),
      );
      setLoading(true);
      try {
        const result = await sendChatTurn({
          apiBase: config.apiBase,
          message: messageForApi,
          sessionId: sessionByAssistant[assistantId],
          assistantId,
          allowWebSearch,
          matterId: contextMatterId,
          projectDir,
        });
        if (result.sessionId) {
          setSessionByAssistant((previous) => ({ ...previous, [assistantId]: result.sessionId }));
        }
        setMessagesByAssistant((previous) =>
          appendChatMessage(previous, assistantId, result.assistantMessage),
        );
        await refreshLists();
        await refreshAssistants();
        await refreshCollaboration();
      } catch (cause) {
        const message = errorMessage(cause, "发送失败");
        setError(message);
        setMessagesByAssistant((previous) =>
          appendChatMessage(previous, assistantId, { role: "assistant", text: `错误: ${message}` }),
        );
      } finally {
        setLoading(false);
      }
    },
    [
      allowWebSearch,
      config,
      contextMatterId,
      fileChatContextItems,
      loading,
      projectDir,
      refreshAssistants,
      refreshCollaboration,
      refreshLists,
      selectedAssistantId,
      sessionByAssistant,
    ],
  );

  const send = useCallback(async () => {
    await sendChatMessage(input);
  }, [input, sendChatMessage]);

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
    setShowWizard(true);
    setShowSettings(false);
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
      messagesByAssistant,
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
    },
  };
}
