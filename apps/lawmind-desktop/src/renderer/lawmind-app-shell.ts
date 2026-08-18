import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { createAssistantDraft, deleteAssistant, saveAssistantDraft, type AssistantEditorDraft } from "./lawmind-assistant-editor";
import {
  appendChatMessage,
  dropTrailingUserMessageIfText,
  isFetchAbortError,
  removeAssistantChatState,
  sendChatTurn,
  type ChatMsg,
} from "./lawmind-chat";
import {
  fetchContractRevisionIndexPrefix,
  shouldAttachContractRevisionIndex,
} from "./lawmind-contract-chat-context";
import type { CollabSummaryState } from "./LawmindSettingsCollaboration";
import { clearProjectDirectory } from "./lawmind-settings-shell";
import type { TimeRangeFilter } from "./lawmind-time-range";
import { errorMessage } from "./api-client";
import {
  loadAppBootstrapSnapshot,
  loadInitialAppConfig,
  loadSettingsCollaborationState,
  type AppConfig,
} from "./lawmind-app-bootstrap";
import type { DelegationRow } from "./lawmind-app-data";
import { useLawmindDetailDomain, useLawmindRecordsDomain } from "./lawmind-app-shell-domains";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";

const MAX_FILE_CHAT_CONTEXT = 8;

const CHAT_ACTIVE_STORAGE_KEY = "lawmind.chat.activeSession.v1";

type ChatActiveStore = { byWorkspace: Record<string, Record<string, string>> };

function readChatActiveStore(): ChatActiveStore {
  if (typeof window === "undefined") {
    return { byWorkspace: {} };
  }
  try {
    const raw = window.localStorage.getItem(CHAT_ACTIVE_STORAGE_KEY);
    if (!raw?.trim()) {
      return { byWorkspace: {} };
    }
    const parsed = JSON.parse(raw) as ChatActiveStore;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("byWorkspace" in parsed) ||
      typeof parsed.byWorkspace !== "object" ||
      parsed.byWorkspace === null
    ) {
      return { byWorkspace: {} };
    }
    return parsed;
  } catch {
    return { byWorkspace: {} };
  }
}

function getStoredActiveChatSessionId(workspaceDir: string, assistantId: string): string | undefined {
  const sid = readChatActiveStore().byWorkspace[workspaceDir]?.[assistantId];
  return typeof sid === "string" && sid.trim() ? sid.trim() : undefined;
}

function persistActiveChatSessionId(workspaceDir: string, assistantId: string, sessionId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const store = readChatActiveStore();
  if (!store.byWorkspace[workspaceDir]) {
    store.byWorkspace[workspaceDir] = {};
  }
  store.byWorkspace[workspaceDir][assistantId] = sessionId;
  window.localStorage.setItem(CHAT_ACTIVE_STORAGE_KEY, JSON.stringify(store));
}

function clearStoredActiveChatSessionForAssistant(workspaceDir: string, assistantId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const store = readChatActiveStore();
  if (!store.byWorkspace[workspaceDir]?.[assistantId]) {
    return;
  }
  delete store.byWorkspace[workspaceDir][assistantId];
  window.localStorage.setItem(CHAT_ACTIVE_STORAGE_KEY, JSON.stringify(store));
}

export type ChatSessionListEntry = {
  sessionId: string;
  title: string;
  updatedAt: string;
};

function formatDelegationFollowUpBubble(item: {
  delegationId: string;
  status: string;
  toAssistant: string;
  result?: string;
  error?: string;
}): string {
  const ok = item.status === "completed";
  const label = ok ? "【委派结果 · 已自动回传】" : "【委派结果 · 未成功】";
  const body = ok
    ? (item.result ?? "").trim() || "（子助手未返回正文）"
    : (item.error ?? "").trim() || "（无错误详情）";
  return `${label}\n- 目标助手：**${item.toAssistant}**\n- 委派 ID：\`${item.delegationId}\`\n- 状态：**${item.status}**\n\n---\n\n${body}`.slice(
    0,
    48_000,
  );
}

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
  const [mainView, setMainView] = useState<"workspace" | "collaboration" | "review">("workspace");
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
  const [chatSessionList, setChatSessionList] = useState<ChatSessionListEntry[]>([]);
  const [chatSessionsLoading, setChatSessionsLoading] = useState(false);
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
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const chatInFlightRef = useRef<{ assistantId: string; userText: string } | null>(null);
  /** 已在主对话 UI 展示过的委派终态 id，避免轮询重复插入 */
  const delegationFollowUpSeenRef = useRef(new Set<string>());
  const delegationFollowUpSessionKeyRef = useRef<string>("");
  const [recordsExpanded, setRecordsExpanded] = useState(false);
  /** 工作区 `lawmind/desk-settings.json`：批量合同材料目录（相对工作区根） */
  const [deskContractBatchDir, setDeskContractBatchDir] = useState("");
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

  const loadSessionMessagesIntoState = useCallback(
    async (assistantId: string, sessionId: string, signal?: AbortSignal) => {
      if (!config?.apiBase) {
        return;
      }
      const r = await fetch(
        `${config.apiBase}/api/sessions/${encodeURIComponent(sessionId)}?assistantId=${encodeURIComponent(assistantId)}`,
        { signal },
      );
      const j = (await r.json()) as {
        ok?: boolean;
        messages?: Array<{ role: string; text?: string }>;
      };
      if (!j.ok || !Array.isArray(j.messages)) {
        return;
      }
      const msgs: ChatMsg[] = j.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          text: typeof m.text === "string" ? m.text : "",
        }));
      setMessagesByAssistant((p) => ({ ...p, [assistantId]: msgs }));
    },
    [config?.apiBase],
  );

  const refreshChatSessionListForAssistant = useCallback(
    async (assistantId: string): Promise<ChatSessionListEntry[] | null> => {
      if (!config?.apiBase) {
        return null;
      }
      const r = await fetch(
        `${config.apiBase}/api/sessions?assistantId=${encodeURIComponent(assistantId)}`,
      );
      const j = (await r.json()) as {
        ok?: boolean;
        sessions?: Array<{ sessionId: string; title?: string; updatedAt: string }>;
      };
      if (!j.ok || !Array.isArray(j.sessions)) {
        return null;
      }
      const mapped: ChatSessionListEntry[] = j.sessions.map((s) => ({
        sessionId: s.sessionId,
        title: typeof s.title === "string" && s.title.trim() ? s.title : "New Chat",
        updatedAt: s.updatedAt,
      }));
      if (assistantId !== selectedAssistantId) {
        return null;
      }
      setChatSessionList(mapped);
      return mapped;
    },
    [config?.apiBase, selectedAssistantId],
  );

  const hydrateWorkspaceChatSessions = useCallback(
    async (signal: AbortSignal) => {
      const assistantId = selectedAssistantId;
      if (!config?.apiBase || !config.workspaceDir || config.workspaceDir.trim().startsWith("(")) {
        setChatSessionList([]);
        return;
      }
      const ws = config.workspaceDir;
      setChatSessionsLoading(true);
      try {
        const listRes = await fetch(
          `${config.apiBase}/api/sessions?assistantId=${encodeURIComponent(assistantId)}`,
          { signal },
        );
        const listJ = (await listRes.json()) as {
          ok?: boolean;
          sessions?: Array<{ sessionId: string; title?: string; updatedAt: string }>;
        };
        if (signal.aborted) {
          return;
        }
        const mapped: ChatSessionListEntry[] = (Array.isArray(listJ.sessions) ? listJ.sessions : []).map(
          (s) => ({
            sessionId: s.sessionId,
            title: typeof s.title === "string" && s.title.trim() ? s.title : "New Chat",
            updatedAt: s.updatedAt,
          }),
        );
        setChatSessionList(mapped);

        let sessionId = getStoredActiveChatSessionId(ws, assistantId);
        if (!sessionId || !mapped.some((r) => r.sessionId === sessionId)) {
          sessionId = mapped[0]?.sessionId;
        }
        if (!sessionId) {
          const cr = await fetch(`${config.apiBase}/api/sessions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ assistantId }),
            signal,
          });
          const cj = (await cr.json()) as { ok?: boolean; sessionId?: string; message?: string };
          if (signal.aborted) {
            return;
          }
          if (!cr.ok || !cj.sessionId) {
            setError(
              errorMessage(
                new Error(typeof cj.message === "string" ? cj.message : "create session failed"),
                "创建对话失败",
              ),
            );
            return;
          }
          sessionId = cj.sessionId;
          const listRes2 = await fetch(
            `${config.apiBase}/api/sessions?assistantId=${encodeURIComponent(assistantId)}`,
            { signal },
          );
          const listJ2 = (await listRes2.json()) as {
            ok?: boolean;
            sessions?: Array<{ sessionId: string; title?: string; updatedAt: string }>;
          };
          if (signal.aborted) {
            return;
          }
          const mapped2: ChatSessionListEntry[] = (
            Array.isArray(listJ2.sessions) ? listJ2.sessions : []
          ).map((s) => ({
            sessionId: s.sessionId,
            title: typeof s.title === "string" && s.title.trim() ? s.title : "New Chat",
            updatedAt: s.updatedAt,
          }));
          setChatSessionList(mapped2);
        }

        if (signal.aborted || !sessionId) {
          return;
        }
        persistActiveChatSessionId(ws, assistantId, sessionId);
        setSessionByAssistant((p) => ({ ...p, [assistantId]: sessionId }));
        await loadSessionMessagesIntoState(assistantId, sessionId, signal);
      } catch (e) {
        if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          return;
        }
        setError(errorMessage(e, "加载对话列表失败"));
      } finally {
        if (!signal.aborted) {
          setChatSessionsLoading(false);
        }
      }
    },
    [config, loadSessionMessagesIntoState, selectedAssistantId],
  );

  const selectChatSession = useCallback(
    async (sessionId: string) => {
      if (!config?.workspaceDir || config.workspaceDir.trim().startsWith("(") || !config.apiBase) {
        return;
      }
      const assistantId = selectedAssistantId;
      persistActiveChatSessionId(config.workspaceDir, assistantId, sessionId);
      setSessionByAssistant((p) => ({ ...p, [assistantId]: sessionId }));
      await loadSessionMessagesIntoState(assistantId, sessionId);
    },
    [config, loadSessionMessagesIntoState, selectedAssistantId],
  );

  const openDelegationTargetWorkspaceChat = useCallback(
    async (delegation: DelegationRow) => {
      if (!config?.apiBase || !config.workspaceDir || config.workspaceDir.trim().startsWith("(")) {
        return;
      }
      const ws = config.workspaceDir;
      const toId = delegation.toAssistant.trim();
      if (!toId) {
        return;
      }
      setMainView("workspace");
      const mid = delegation.matterId?.trim();
      if (mid) {
        setContextMatterId(mid);
      }
      setSelectedAssistantId(toId);
      setChatSessionsLoading(true);
      setError(null);
      try {
        const listRes = await fetch(
          `${config.apiBase}/api/sessions?assistantId=${encodeURIComponent(toId)}`,
        );
        const listJ = (await listRes.json()) as {
          ok?: boolean;
          sessions?: Array<{ sessionId: string; title?: string; updatedAt: string }>;
        };
        const mapped: ChatSessionListEntry[] = (Array.isArray(listJ.sessions) ? listJ.sessions : []).map(
          (s) => ({
            sessionId: s.sessionId,
            title: typeof s.title === "string" && s.title.trim() ? s.title : "New Chat",
            updatedAt: s.updatedAt,
          }),
        );
        setChatSessionList(mapped);

        let sessionId = delegation.targetSessionId?.trim();
        if (!sessionId || !mapped.some((r) => r.sessionId === sessionId)) {
          sessionId = getStoredActiveChatSessionId(ws, toId);
        }
        if (!sessionId || !mapped.some((r) => r.sessionId === sessionId)) {
          sessionId = mapped[0]?.sessionId;
        }
        if (!sessionId) {
          const cr = await fetch(`${config.apiBase}/api/sessions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ assistantId: toId }),
          });
          const cj = (await cr.json()) as { ok?: boolean; sessionId?: string; message?: string };
          if (!cr.ok || !cj.sessionId) {
            setError(
              errorMessage(
                new Error(typeof cj.message === "string" ? cj.message : "create session failed"),
                "打开子助手对话失败",
              ),
            );
            return;
          }
          sessionId = cj.sessionId;
          const listRes2 = await fetch(
            `${config.apiBase}/api/sessions?assistantId=${encodeURIComponent(toId)}`,
          );
          const listJ2 = (await listRes2.json()) as {
            ok?: boolean;
            sessions?: Array<{ sessionId: string; title?: string; updatedAt: string }>;
          };
          const mapped2: ChatSessionListEntry[] = (
            Array.isArray(listJ2.sessions) ? listJ2.sessions : []
          ).map((s) => ({
            sessionId: s.sessionId,
            title: typeof s.title === "string" && s.title.trim() ? s.title : "New Chat",
            updatedAt: s.updatedAt,
          }));
          setChatSessionList(mapped2);
        }

        if (!sessionId) {
          return;
        }
        persistActiveChatSessionId(ws, toId, sessionId);
        setSessionByAssistant((p) => ({ ...p, [toId]: sessionId }));
        await loadSessionMessagesIntoState(toId, sessionId);
      } catch (e) {
        setError(errorMessage(e, "打开子助手对话失败"));
      } finally {
        setChatSessionsLoading(false);
      }
    },
    [
      config?.apiBase,
      config?.workspaceDir,
      loadSessionMessagesIntoState,
      setContextMatterId,
      setMainView,
      setSelectedAssistantId,
    ],
  );

  const createNewChatSession = useCallback(async () => {
    if (!config?.apiBase || !config.workspaceDir || config.workspaceDir.trim().startsWith("(")) {
      return;
    }
    const assistantId = selectedAssistantId;
    setError(null);
    try {
      const cr = await fetch(`${config.apiBase}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assistantId }),
      });
      const cj = (await cr.json()) as { ok?: boolean; sessionId?: string; message?: string };
      if (!cr.ok || !cj.sessionId) {
        throw new Error(typeof cj.message === "string" ? cj.message : "create session failed");
      }
      await refreshChatSessionListForAssistant(assistantId);
      persistActiveChatSessionId(config.workspaceDir, assistantId, cj.sessionId);
      setSessionByAssistant((p) => ({ ...p, [assistantId]: cj.sessionId! }));
      await loadSessionMessagesIntoState(assistantId, cj.sessionId);
    } catch (cause) {
      setError(errorMessage(cause, "新建对话失败"));
    }
  }, [
    config?.apiBase,
    config?.workspaceDir,
    loadSessionMessagesIntoState,
    refreshChatSessionListForAssistant,
    selectedAssistantId,
  ]);

  const renameChatSession = useCallback(
    async (sessionId: string, title: string) => {
      if (!config?.apiBase) {
        return;
      }
      const assistantId = selectedAssistantId;
      const r = await fetch(
        `${config.apiBase}/api/sessions/${encodeURIComponent(sessionId)}?assistantId=${encodeURIComponent(assistantId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title }),
        },
      );
      const j = (await r.json()) as { ok?: boolean; title?: string; message?: string };
      if (!r.ok || j.ok === false) {
        setError(
          errorMessage(
            new Error(typeof j.message === "string" ? j.message : "rename failed"),
            "重命名失败",
          ),
        );
        return;
      }
      const nextTitle = typeof j.title === "string" && j.title.trim() ? j.title : title.trim();
      setChatSessionList((prev) =>
        prev.map((row) => (row.sessionId === sessionId ? { ...row, title: nextTitle } : row)),
      );
    },
    [config?.apiBase, selectedAssistantId],
  );

  const deleteChatSession = useCallback(
    async (sessionId: string) => {
      if (!config?.apiBase || !config.workspaceDir || config.workspaceDir.trim().startsWith("(")) {
        return;
      }
      const assistantId = selectedAssistantId;
      if (!window.confirm("确定删除此对话？该会话将从本工作区移除且不可恢复。")) {
        return;
      }
      setError(null);
      try {
        const r = await fetch(`${config.apiBase}/api/sessions/delete`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, assistantId }),
        });
        const j = (await r.json()) as { ok?: boolean; message?: string };
        if (!r.ok || j.ok === false) {
          throw new Error(typeof j.message === "string" ? j.message : "delete failed");
        }
        const wasActive = sessionByAssistant[assistantId] === sessionId;
        const list = await refreshChatSessionListForAssistant(assistantId);
        if (list === null) {
          return;
        }
        if (!wasActive) {
          return;
        }
        delegationFollowUpSeenRef.current.clear();
        if (list.length === 0) {
          const cr = await fetch(`${config.apiBase}/api/sessions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ assistantId }),
          });
          const cj = (await cr.json()) as { ok?: boolean; sessionId?: string; message?: string };
          if (!cr.ok || !cj.sessionId) {
            throw new Error(typeof cj.message === "string" ? cj.message : "create failed");
          }
          await refreshChatSessionListForAssistant(assistantId);
          persistActiveChatSessionId(config.workspaceDir, assistantId, cj.sessionId);
          setSessionByAssistant((p) => ({ ...p, [assistantId]: cj.sessionId! }));
          await loadSessionMessagesIntoState(assistantId, cj.sessionId);
          return;
        }
        const nextId = list[0].sessionId;
        persistActiveChatSessionId(config.workspaceDir, assistantId, nextId);
        setSessionByAssistant((p) => ({ ...p, [assistantId]: nextId }));
        await loadSessionMessagesIntoState(assistantId, nextId);
      } catch (cause) {
        setError(errorMessage(cause, "删除对话失败"));
      }
    },
    [
      config?.apiBase,
      config?.workspaceDir,
      loadSessionMessagesIntoState,
      refreshChatSessionListForAssistant,
      selectedAssistantId,
      sessionByAssistant,
    ],
  );

  useEffect(() => {
    if (!config?.apiBase) {
      return undefined;
    }
    const ac = new AbortController();
    void hydrateWorkspaceChatSessions(ac.signal);
    return () => ac.abort();
  }, [config?.apiBase, config?.workspaceDir, selectedAssistantId, hydrateWorkspaceChatSessions]);

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
    const sid = sessionByAssistant[selectedAssistantId];
    const nextKey = `${selectedAssistantId}:${sid ?? ""}`;
    if (delegationFollowUpSessionKeyRef.current !== nextKey) {
      delegationFollowUpSessionKeyRef.current = nextKey;
      delegationFollowUpSeenRef.current.clear();
    }
  }, [selectedAssistantId, sessionByAssistant]);

  useEffect(() => {
    if (!config?.apiBase) {
      return undefined;
    }
    const assistantId = selectedAssistantId;
    const sessionId = sessionByAssistant[assistantId]?.trim();
    if (!sessionId) {
      return undefined;
    }

    const tick = async () => {
      try {
        const url = `${config.apiBase}/api/delegations/follow-up?sessionId=${encodeURIComponent(sessionId)}&assistantId=${encodeURIComponent(assistantId)}`;
        const res = await fetch(url);
        if (!res.ok) {
          return;
        }
        const j = (await res.json()) as {
          ok?: boolean;
          items?: Array<{
            delegationId: string;
            status: string;
            toAssistant: string;
            result?: string;
            error?: string;
          }>;
        };
        if (!j.ok || !Array.isArray(j.items)) {
          return;
        }
        for (const it of j.items) {
          const id = it.delegationId;
          if (!id || delegationFollowUpSeenRef.current.has(id)) {
            continue;
          }
          delegationFollowUpSeenRef.current.add(id);
          const text = formatDelegationFollowUpBubble(it);
          setMessagesByAssistant((previous) =>
            appendChatMessage(previous, assistantId, { role: "assistant", text }),
          );
          const desk = typeof window !== "undefined" ? window.lawmindDesktop : undefined;
          const ok = it.status === "completed";
          const shortBody = ok
            ? `助手 ${it.toAssistant} 已完成委派（${id.slice(0, 8)}…）`
            : `助手 ${it.toAssistant} 委派未成功（${id.slice(0, 8)}…）`;
          if (desk?.showNotification) {
            void desk.showNotification({
              title: ok ? "LawMind · 委派已完成" : "LawMind · 委派未成功",
              body: shortBody,
              openChatOnClick: true,
              chatAssistantId: assistantId,
            });
          }
        }
      } catch {
        /* ignore */
      }
    };

    const interval = window.setInterval(() => void tick(), 3500);
    void tick();
    return () => window.clearInterval(interval);
  }, [config?.apiBase, selectedAssistantId, sessionByAssistant]);

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

  const abortChatSend = useCallback(() => {
    chatAbortControllerRef.current?.abort();
  }, []);

  const sendChatMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || !config || loading) {
        return;
      }
      const prefix = buildFileContextMessagePrefix(fileChatContextItems);
      const assistantId = selectedAssistantId;
      const ac = new AbortController();
      chatAbortControllerRef.current = ac;
      chatInFlightRef.current = { assistantId, userText: text };
      let learnPrefix = "";
      if (shouldAttachContractRevisionIndex(fileChatContextItems, deskContractBatchDir || undefined)) {
        learnPrefix = await fetchContractRevisionIndexPrefix(config.apiBase, ac.signal);
      }
      let messageForApi = text;
      const headParts: string[] = [];
      if (prefix.trim()) {
        headParts.push(prefix.trimEnd());
      }
      if (learnPrefix.trim()) {
        headParts.push(learnPrefix.trimEnd());
      }
      if (headParts.length > 0) {
        messageForApi = `${headParts.join("\n\n")}\n\n${text}`;
      }
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
          sessionTitleHint: text,
          sessionId: sessionByAssistant[assistantId],
          assistantId,
          allowWebSearch,
          matterId: contextMatterId,
          projectDir,
          contextPins: fileChatContextItems.map((it) => ({
            root: it.root,
            relPath: it.relPath,
            kind: it.kind,
          })),
          linkedTaskId: contextTaskId,
          signal: ac.signal,
        });
        if (ac.signal.aborted) {
          return;
        }
        if (result.sessionId) {
          setSessionByAssistant((previous) => ({ ...previous, [assistantId]: result.sessionId }));
          if (!config.workspaceDir.trim().startsWith("(")) {
            persistActiveChatSessionId(config.workspaceDir, assistantId, result.sessionId);
          }
        }
        setMessagesByAssistant((previous) =>
          appendChatMessage(previous, assistantId, result.assistantMessage),
        );
        await refreshChatSessionListForAssistant(assistantId);
        await refreshLists();
        await refreshAssistants();
        await refreshCollaboration();
      } catch (cause) {
        if (isFetchAbortError(cause)) {
          const inflight = chatInFlightRef.current;
          if (inflight && inflight.assistantId === assistantId) {
            setMessagesByAssistant((previous) =>
              dropTrailingUserMessageIfText(previous, assistantId, inflight.userText),
            );
            setInput(inflight.userText);
          }
          setError(null);
          return;
        }
        const message = errorMessage(cause, "发送失败");
        setError(message);
        setMessagesByAssistant((previous) =>
          appendChatMessage(previous, assistantId, { role: "assistant", text: `错误: ${message}` }),
        );
      } finally {
        chatAbortControllerRef.current = null;
        chatInFlightRef.current = null;
        setLoading(false);
      }
    },
    [
      allowWebSearch,
      config,
      contextMatterId,
      contextTaskId,
      fileChatContextItems,
      deskContractBatchDir,
      loading,
      projectDir,
      refreshAssistants,
      refreshChatSessionListForAssistant,
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
      deskContractBatchDir,
      chatSessionList,
      chatSessionsLoading,
      activeChatSessionId: sessionByAssistant[selectedAssistantId],
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
      dismissChatError: () => setError(null),
      abortChatSend,
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
      selectChatSession,
      openDelegationTargetWorkspaceChat,
      createNewChatSession,
      renameChatSession,
      deleteChatSession,
    },
  };
}
