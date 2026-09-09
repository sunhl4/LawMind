import { useCallback, useMemo } from "react";
import type { FileWorkbenchCasesNodeActions } from "../FileWorkbench";
import {
  resumeChatAction,
  parseRequiresActionsFromResponse,
  buildClarificationAnswerMap,
  type LawMindRequiresAction,
  type LawMindRequiresActionDecision,
} from "../lawmind-requires-action";
import { apiGetJson, errorMessage, messageFromOkFalseBody } from "../api-client";
import { apiPost } from "../lawmind-api-routes.ts";
import { displayNameFromImportBasename, suggestMatterIdForImport } from "../../../../../src/lawmind/cases/matter-label.ts";
import type { AppConfig } from "../lawmind-app-bootstrap";
import type { LawmindMainView } from "../lawmind-main-view";

export type UseLawmindAppRootHandlersInput = {
  config: AppConfig | null;
  selectedAssistantId: string;
  sessionByAssistant: Record<string, string | undefined>;
  activeChatSessionId: string | undefined;
  contextMatterId: string | null;
  contextTaskId: string | null;
  recordsDeskMatters: {
    setSelectedKey: (key: string) => void;
    sidebarRowsAll: Array<{ matterId?: string | null; title: string }>;
  };
  matterLabelById: Record<string, string>;
  matterImportBusy: boolean;
  setMatterImportBusy: (busy: boolean) => void;
  setMatterRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
  setContextMatterId: (id: string | null) => void;
  setContextTaskId: (id: string | null) => void;
  setMainView: (view: LawmindMainView) => void;
  setMatterCockpitOpen: (open: boolean) => void;
  setCreateMatterOpen: (open: boolean) => void;
  setMatterDeleteOpen: (value: { matterId: string; label: string } | null) => void;
  setReviewLaunchedFromMatter: (v: boolean) => void;
  setReviewFocusTaskId: (id: string | null) => void;
  setReviewFocusMatterId: (id: string | null) => void;
  setReviewFocusStatus: (s: import("../../../../../src/lawmind/types.ts").ArtifactDraft["reviewStatus"] | "all") => void;
  setReviewFocusListMode: (m: "pending" | "all") => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setMessagesByAssistant: React.Dispatch<
    React.SetStateAction<Record<string, import("../lawmind-chat").ChatMsg[]>>
  >;
  setSessionByAssistant: React.Dispatch<React.SetStateAction<Record<string, string | undefined>>>;
  sendChatMessage: (msg: string) => Promise<void>;
  refreshActionSummary: () => void | Promise<void>;
};

export function useLawmindAppRootHandlers(input: UseLawmindAppRootHandlersInput) {
  const {
    config,
    selectedAssistantId,
    sessionByAssistant,
    activeChatSessionId,
    contextTaskId,
    recordsDeskMatters,
    matterLabelById,
    matterImportBusy,
    setMatterImportBusy,
    setMatterRefreshVersion,
    setContextMatterId,
    setMainView,
    setMatterCockpitOpen,
    setMatterDeleteOpen,
    setReviewLaunchedFromMatter,
    setReviewFocusStatus,
    setReviewFocusListMode,
    setReviewFocusTaskId,
    setReviewFocusMatterId,
    setLoading,
    setError,
    setMessagesByAssistant,
    setSessionByAssistant,
    sendChatMessage,
    refreshActionSummary,
  } = input;

  const handleResumeRequiresAction = useCallback(
    async (
      action: LawMindRequiresAction,
      decision: LawMindRequiresActionDecision,
      clarificationDraft?: Record<string, string>,
      editedArgs?: Record<string, unknown>,
    ) => {
      // Single-step approve on the chat card.
      if (!config?.apiBase) {
        return;
      }
      const sid = sessionByAssistant[selectedAssistantId] ?? activeChatSessionId;
      if (!sid) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // 澄清与工具批准统一走 /api/chat/resume：服务端按 actionId 关闭 interrupt
        // 并清除跨轮澄清键（普通 chat 消息做不到，会形成双轨）。
        const res = await resumeChatAction(config.apiBase, {
          sessionId: sid,
          actionId: action.id,
          decision,
          ...(decision === "respond"
            ? {
                clarificationAnswers: buildClarificationAnswerMap(
                  action.clarificationQuestions ?? [],
                  clarificationDraft ?? {},
                ),
              }
            : {}),
          ...(editedArgs && decision === "edit" ? { editedArgs } : {}),
        });
        const requiresAction = parseRequiresActionsFromResponse(res.requiresAction);
        const appendFallback = () => {
          setMessagesByAssistant((prev) => ({
            ...prev,
            [selectedAssistantId]: [
              ...(prev[selectedAssistantId] ?? []),
              {
                role: "assistant",
                text: res.reply?.trim() || "已处理您的确认。",
                ...(res.status ? { status: res.status } : {}),
                ...(requiresAction.length > 0 ? { requiresAction } : {}),
              },
            ],
          }));
        };
        if (res.sessionId) {
          setSessionByAssistant((prev) => ({ ...prev, [selectedAssistantId]: res.sessionId }));
        }
        // resume 后用服务端权威 transcript 重载会话（而非仅追加一条合成消息），
        // 保证 resume 产生的新轮次/工具轨迹完整呈现；失败时回退合成消息。
        const reloadSid = res.sessionId ?? sid;
        let reloaded = false;
        if (reloadSid) {
          try {
            const j = await apiGetJson<{
              ok?: boolean;
              messages?: Array<{
                role: string;
                text?: string;
                content?: string;
                requiresAction?: unknown;
                liveTrace?: import("../lawmind-chat").ChatMsg["liveTrace"];
                executionState?: import("../lawmind-chat").ChatMsg["executionState"];
              }>;
            }>(
              config.apiBase,
              `/api/sessions/${encodeURIComponent(reloadSid)}?assistantId=${encodeURIComponent(selectedAssistantId)}`,
            );
            if (j.ok && Array.isArray(j.messages)) {
              const msgs = j.messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .map((m) => ({
                  role: m.role as "user" | "assistant",
                  text:
                    typeof m.text === "string"
                      ? m.text
                      : typeof m.content === "string"
                        ? m.content
                        : "",
                  ...(m.liveTrace ? { liveTrace: m.liveTrace } : {}),
                  ...(m.executionState ? { executionState: m.executionState } : {}),
                  ...(parseRequiresActionsFromResponse(m.requiresAction).length > 0
                    ? { requiresAction: parseRequiresActionsFromResponse(m.requiresAction) }
                    : {}),
                }));
              setMessagesByAssistant((prev) => ({ ...prev, [selectedAssistantId]: msgs }));
              reloaded = true;
            }
          } catch {
            /* fall through to synthetic append */
          }
        }
        if (!reloaded) {
          appendFallback();
        }
        void refreshActionSummary();
      } catch (cause) {
        setError(errorMessage(cause, "处理待办失败"));
      } finally {
        setLoading(false);
      }
    },
    [
      activeChatSessionId,
      config?.apiBase,
      refreshActionSummary,
      selectedAssistantId,
      sendChatMessage,
      sessionByAssistant,
      setError,
      setLoading,
      setMessagesByAssistant,
      setSessionByAssistant,
    ],
  );

  const linkMatterToChat = useCallback(
    (matterId: string) => {
      setContextMatterId(matterId);
      setMatterCockpitOpen(false);
      setMainView("workspace");
    },
    [setContextMatterId, setMainView, setMatterCockpitOpen],
  );

  const importMattersFromUserFiles = useCallback(async () => {
    const api = config?.apiBase;
    const desk = typeof window !== "undefined" ? window.lawmindDesktop : undefined;
    const dlg = desk?.openFilesDialog;
    if (!api?.trim()) {
      void desk?.showNotification?.({
        title: "LawMind",
        body: "请先连接本地服务。",
      });
      return;
    }
    if (!dlg) {
      void desk?.showNotification?.({
        title: "LawMind",
        body: "当前页面不支持文件导入，请使用 LawMind 桌面应用导入。",
      });
      return;
    }
    setMatterImportBusy(true);
    try {
      let r: Awaited<ReturnType<NonNullable<typeof dlg>>>;
      try {
        r = await dlg({
          title: "所选每一文件或文件夹将各自创建一个案件（展示名取自名称）",
          multi: true,
          allowDirectories: true,
        });
      } catch (e) {
        void desk?.showNotification?.({
          title: "LawMind",
          body: errorMessage(e, "无法打开文件选择"),
        });
        return;
      }
      if (!r.filePaths?.length) {
        return;
      }
      let lastOkId: string | undefined;
      for (let i = 0; i < r.filePaths.length; i++) {
        const fp = r.filePaths[i];
        const kind = r.pathKinds?.[i] ?? "file";
        const displayName = displayNameFromImportBasename(fp, {
          treatAsDirectory: kind === "directory",
        });
        const matterId = suggestMatterIdForImport(fp, i, {
          treatAsDirectory: kind === "directory",
        });
        try {
          const j = await apiPost(api, "/api/matters/create", { matterId, displayName });
          if (j.ok && typeof j.matterId === "string") {
            lastOkId = j.matterId;
          }
        } catch (e) {
          console.warn(errorMessage(e, "导入案件"));
        }
      }
      setMatterRefreshVersion((v) => v + 1);
      if (lastOkId) {
        recordsDeskMatters.setSelectedKey(lastOkId);
      } else if (r.filePaths.length > 0) {
        void desk?.showNotification?.({
          title: "LawMind",
          body: "未能创建案件。请检查本地服务。",
        });
      }
    } finally {
      setMatterImportBusy(false);
    }
  }, [config?.apiBase, recordsDeskMatters.setSelectedKey, setMatterImportBusy, setMatterRefreshVersion]);

  const setCaseSubdirRole = useCallback(
    async (matterId: string, role: "matter" | "folder") => {
      const api = config?.apiBase?.trim();
      if (!api) {
        return;
      }
      try {
        const j = await apiPost(api, "/api/matters/role", { matterId, role });
        if (!j.ok) {
          console.warn(messageFromOkFalseBody(j, "更新节点角色失败"));
          return;
        }
        setMatterRefreshVersion((v) => v + 1);
      } catch (e) {
        console.warn(errorMessage(e, "更新节点角色失败"));
      }
    },
    [config?.apiBase, setMatterRefreshVersion],
  );

  const workspaceCasesMenu = useMemo((): FileWorkbenchCasesNodeActions | null => {
    if (!config?.apiBase?.trim()) {
      return null;
    }
    return {
      apiBase: config.apiBase,
      workspaceDir: config.workspaceDir ?? null,
      matterLabelById,
      onOpenMatterCockpit: (matterId) => {
        recordsDeskMatters.setSelectedKey(matterId);
        setMatterCockpitOpen(true);
      },
      onLinkMatterToChat: linkMatterToChat,
      onRequestDeleteMatter: (mid, label) => {
        setMatterDeleteOpen({ matterId: mid, label });
      },
      onSetCaseSubdirRole: setCaseSubdirRole,
      onImportMatters: () => void importMattersFromUserFiles(),
      onRefreshMatters: () => setMatterRefreshVersion((v) => v + 1),
      importMattersBusy: matterImportBusy,
      canImportMatters: Boolean(typeof window !== "undefined" && window.lawmindDesktop?.openFilesDialog),
    };
  }, [
    config,
    importMattersFromUserFiles,
    linkMatterToChat,
    matterImportBusy,
    matterLabelById,
    recordsDeskMatters.setSelectedKey,
    setCaseSubdirRole,
    setMatterCockpitOpen,
    setMatterDeleteOpen,
    setMatterRefreshVersion,
  ]);

  const openReviewFromWorkspace = useCallback(
    (target?: { taskId?: string; matterId?: string }) => {
      setReviewLaunchedFromMatter(false);
      setReviewFocusStatus("pending");
      setReviewFocusListMode("pending");
      const taskId = target?.taskId?.trim() || contextTaskId?.trim() || null;
      const matterId = target?.matterId?.trim() || null;
      setReviewFocusTaskId(taskId);
      if (matterId) {
        setReviewFocusMatterId(matterId);
        setContextMatterId(matterId);
      }
      setMainView("review");
    },
    [
      contextTaskId,
      setContextMatterId,
      setMainView,
      setReviewFocusListMode,
      setReviewFocusMatterId,
      setReviewFocusStatus,
      setReviewFocusTaskId,
      setReviewLaunchedFromMatter,
    ],
  );

  const handleChatResumeComplete = useCallback(async () => {
    void refreshActionSummary();
  }, [refreshActionSummary]);

  return {
    handleResumeRequiresAction,
    linkMatterToChat,
    importMattersFromUserFiles,
    workspaceCasesMenu,
    openReviewFromWorkspace,
    handleChatResumeComplete,
  };
}
