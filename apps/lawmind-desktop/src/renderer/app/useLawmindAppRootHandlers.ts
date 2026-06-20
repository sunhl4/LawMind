import { useCallback, useMemo } from "react";
import type { FileWorkbenchCasesNodeActions } from "../FileWorkbench";
import {
  resumeChatAction,
  parseRequiresActionsFromResponse,
  formatClarificationResumeMessage,
  type LawMindRequiresAction,
  type LawMindRequiresActionDecision,
} from "../lawmind-requires-action";
import { errorMessage, messageFromOkFalseBody } from "../api-client";
import { apiPost } from "../lawmind-api-routes.ts";
import { displayNameFromImportBasename, suggestMatterIdForImport } from "../../../../../src/lawmind/cases/matter-label.ts";
import type { AppConfig } from "../lawmind-app-bootstrap";

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
  setMainView: (view: "workspace" | "collaboration" | "review") => void;
  setMatterCockpitOpen: (open: boolean) => void;
  setCreateMatterOpen: (open: boolean) => void;
  setMatterRenameOpen: (value: { matterId: string; initialTitle: string } | null) => void;
  setMatterDeleteOpen: (value: { matterId: string; label: string } | null) => void;
  setReviewLaunchedFromMatter: (v: boolean) => void;
  setReviewFocusTaskId: (id: string | null) => void;
  setReviewFocusMatterId: (id: string | null) => void;
  setReviewFocusStatus: (s: import("../../../../../src/lawmind/types.ts").ArtifactDraft["reviewStatus"] | "all") => void;
  setReviewFocusListMode: (m: "pending" | "all") => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setToolApprovalDialogAction: (action: LawMindRequiresAction | null) => void;
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
    setCreateMatterOpen,
    setMatterRenameOpen,
    setMatterDeleteOpen,
    setReviewLaunchedFromMatter,
    setReviewFocusStatus,
    setReviewFocusListMode,
    setReviewFocusTaskId,
    setLoading,
    setError,
    setToolApprovalDialogAction,
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
      opts?: { skipApprovalDialog?: boolean },
    ) => {
      if (!opts?.skipApprovalDialog && decision === "approve" && action.kind === "tool_approval") {
        setToolApprovalDialogAction(action);
        return;
      }
      if (!config?.apiBase) {
        return;
      }
      const sid = sessionByAssistant[selectedAssistantId] ?? activeChatSessionId;
      if (!sid) {
        return;
      }
      if (action.kind === "clarification" && decision === "respond") {
        const msg = formatClarificationResumeMessage(
          clarificationDraft ?? {},
          action.clarificationQuestions ?? [],
        );
        await sendChatMessage(msg);
        void refreshActionSummary();
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await resumeChatAction(config.apiBase, {
          sessionId: sid,
          actionId: action.id,
          decision,
          ...(editedArgs && decision === "edit" ? { editedArgs } : {}),
        });
        const requiresAction = parseRequiresActionsFromResponse(res.requiresAction);
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
        if (res.sessionId) {
          setSessionByAssistant((prev) => ({ ...prev, [selectedAssistantId]: res.sessionId }));
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
      setToolApprovalDialogAction,
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
        body: "请先完成连接设置，确保本地 API 可用后再导入案件。",
      });
      return;
    }
    if (!dlg) {
      void desk?.showNotification?.({
        title: "LawMind",
        body: "当前页面未注入桌面桥接，请使用 LawMind 桌面应用导入。",
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
          body: "未能创建案件（可能网络或服务异常）。请查看开发工具控制台或稍后重试。",
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
      onRequestRenameDisplayName: (mid, initialTitle) => {
        setMatterRenameOpen({ matterId: mid, initialTitle });
      },
      onRequestDeleteMatter: (mid, label) => {
        setMatterDeleteOpen({ matterId: mid, label });
      },
      onSetCaseSubdirRole: setCaseSubdirRole,
      onNewMatter: () => setCreateMatterOpen(true),
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
    setCreateMatterOpen,
    setMatterCockpitOpen,
    setMatterDeleteOpen,
    setMatterRefreshVersion,
    setMatterRenameOpen,
  ]);

  const openReviewFromWorkspace = useCallback(() => {
    setReviewLaunchedFromMatter(false);
    setReviewFocusStatus("pending");
    setReviewFocusListMode("pending");
    setMainView("review");
    if (contextTaskId?.trim()) {
      setReviewFocusTaskId(contextTaskId.trim());
    }
  }, [
    contextTaskId,
    setMainView,
    setReviewFocusListMode,
    setReviewFocusStatus,
    setReviewFocusTaskId,
    setReviewLaunchedFromMatter,
  ]);

  return {
    handleResumeRequiresAction,
    linkMatterToChat,
    importMattersFromUserFiles,
    workspaceCasesMenu,
    openReviewFromWorkspace,
  };
}
