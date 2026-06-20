import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { FileWorkbenchCasesNodeActions } from "../FileWorkbench";
import type { RootKey } from "../file/file-workbench-types";
import type { LawmindAppRootDialogsProps } from "./LawmindAppRootDialogs";
import type { LawmindFileWorkbenchHostProps } from "./LawmindFileWorkbenchHost";
import { RECORDS_DESK_UNLINKED } from "../lawmind-records-desk-state";

export type UseLawmindAppRootDialogsPropsInput = {
  apiBase: string | undefined;
  delegateAssistOpen: boolean;
  setDelegateAssistOpen: (open: boolean) => void;
  selectedAssistantId: string;
  activeChatSessionId: string | undefined;
  contextMatterId: string | null;
  delegateTaskDefault: string;
  assistants: LawmindAppRootDialogsProps["assistants"];
  delegations: LawmindAppRootDialogsProps["delegations"];
  modelCatalog: LawmindAppRootDialogsProps["modelCatalog"];
  selectedModelId: string;
  refreshCollaboration: () => void | Promise<void>;
  createMatterOpen: boolean;
  setCreateMatterOpen: (open: boolean) => void;
  setMatterRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
  recordsDeskMattersSetSelectedKey: (key: string) => void;
  matterRenameOpen: { matterId: string; initialTitle: string } | null;
  setMatterRenameOpen: (value: { matterId: string; initialTitle: string } | null) => void;
  matterDeleteOpen: { matterId: string; label: string } | null;
  setMatterDeleteOpen: (value: { matterId: string; label: string } | null) => void;
  setContextMatterId: (id: string | null) => void;
  showActionHub: boolean;
  setShowActionHub: (open: boolean) => void;
  refreshActionSummary: () => void | Promise<void>;
  sessionRequiresActions: LawmindAppRootDialogsProps["sessionRequiresActions"];
  sessionByAssistant: Record<string, string | undefined>;
  taskDrawerOpen: boolean;
  setTaskDrawerOpen: (open: boolean) => void;
  toolApprovalDialogAction: LawmindAppRootDialogsProps["toolApprovalDialogAction"];
  setToolApprovalDialogAction: (
    action: LawmindAppRootDialogsProps["toolApprovalDialogAction"],
  ) => void;
  loading: boolean;
  handleResumeRequiresAction: LawmindAppRootDialogsProps["onResumeRequiresAction"];
};

export function useLawmindAppRootDialogsProps(
  input: UseLawmindAppRootDialogsPropsInput,
): LawmindAppRootDialogsProps {
  const {
    apiBase,
    delegateAssistOpen,
    setDelegateAssistOpen,
    selectedAssistantId,
    activeChatSessionId,
    contextMatterId,
    delegateTaskDefault,
    assistants,
    delegations,
    modelCatalog,
    selectedModelId,
    refreshCollaboration,
    createMatterOpen,
    setCreateMatterOpen,
    setMatterRefreshVersion,
    recordsDeskMattersSetSelectedKey,
    matterRenameOpen,
    setMatterRenameOpen,
    matterDeleteOpen,
    setMatterDeleteOpen,
    setContextMatterId,
    showActionHub,
    setShowActionHub,
    refreshActionSummary,
    sessionRequiresActions,
    sessionByAssistant,
    taskDrawerOpen,
    setTaskDrawerOpen,
    toolApprovalDialogAction,
    setToolApprovalDialogAction,
    loading,
    handleResumeRequiresAction,
  } = input;

  return useMemo(
    (): LawmindAppRootDialogsProps => ({
      apiBase,
      delegateAssistOpen,
      onCloseDelegateAssist: () => setDelegateAssistOpen(false),
      selectedAssistantId,
      activeChatSessionId: activeChatSessionId ?? null,
      contextMatterId,
      delegateTaskDefault,
      assistants,
      delegations,
      modelCatalog,
      selectedModelId,
      onDelegated: ({ toDisplayName }) => {
        void refreshCollaboration();
        void window.lawmindDesktop?.showNotification?.({
          title: "LawMind · 委派已发起",
          body: `已委派给「${toDisplayName}」，完成后会在本对话出现结果。`,
        });
      },
      createMatterOpen,
      onCloseCreateMatter: () => setCreateMatterOpen(false),
      onCreateMatterSuccess: (mid) => {
        setMatterRefreshVersion((v) => v + 1);
        recordsDeskMattersSetSelectedKey(mid);
      },
      matterRenameOpen,
      onCloseMatterRename: () => setMatterRenameOpen(null),
      onMatterRenameSuccess: () => setMatterRefreshVersion((v) => v + 1),
      matterDeleteOpen,
      onCloseMatterDelete: () => setMatterDeleteOpen(null),
      onMatterDeleteSuccess: (mid) => {
        if (contextMatterId === mid) {
          setContextMatterId(null);
        }
      },
      onMatterListChanged: () => setMatterRefreshVersion((v) => v + 1),
      showActionHub,
      onCloseActionHub: () => setShowActionHub(false),
      onRefreshActionSummary: refreshActionSummary,
      sessionRequiresActions,
      sessionId: sessionByAssistant[selectedAssistantId] ?? activeChatSessionId,
      onChatResumeComplete: refreshActionSummary,
      taskDrawerOpen,
      onCloseTaskDrawer: () => setTaskDrawerOpen(false),
      toolApprovalDialogAction,
      loading,
      onCloseToolApproval: () => setToolApprovalDialogAction(null),
      onResumeRequiresAction: handleResumeRequiresAction,
    }),
    [
      apiBase,
      delegateAssistOpen,
      setDelegateAssistOpen,
      selectedAssistantId,
      activeChatSessionId,
      contextMatterId,
      delegateTaskDefault,
      assistants,
      delegations,
      modelCatalog,
      selectedModelId,
      refreshCollaboration,
      createMatterOpen,
      setCreateMatterOpen,
      setMatterRefreshVersion,
      recordsDeskMattersSetSelectedKey,
      matterRenameOpen,
      setMatterRenameOpen,
      matterDeleteOpen,
      setMatterDeleteOpen,
      setContextMatterId,
      showActionHub,
      setShowActionHub,
      refreshActionSummary,
      sessionRequiresActions,
      sessionByAssistant,
      taskDrawerOpen,
      setTaskDrawerOpen,
      toolApprovalDialogAction,
      setToolApprovalDialogAction,
      loading,
      handleResumeRequiresAction,
    ],
  );
}

export type UseLawmindFileWorkbenchHostPropsInput = {
  workspaceDir: string | undefined;
  apiBase: string | undefined;
  showSidebarWorkbenchFiles: boolean;
  projectDir: string | null;
  fileExplorerHost: HTMLDivElement | null;
  fileEditorHost: HTMLDivElement | null;
  setFileExplorerPortaled: Dispatch<SetStateAction<boolean>>;
  addFileToChatContext: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  setMainView: (view: "workspace" | "collaboration" | "review") => void;
  fileWorkbenchMattersPickList: Array<{ id: string; label: string }>;
  matterRefreshVersion: number;
  recordsDeskMattersSetSelectedKey: (key: string) => void;
  setMatterCockpitOpen: React.Dispatch<React.SetStateAction<boolean>>;
  matterCockpitOpen: boolean;
  workspaceCasesMenu: FileWorkbenchCasesNodeActions | null;
};

export function useLawmindFileWorkbenchHostProps(
  input: UseLawmindFileWorkbenchHostPropsInput,
): LawmindFileWorkbenchHostProps | null {
  const {
    workspaceDir,
    apiBase,
    showSidebarWorkbenchFiles,
    projectDir,
    fileExplorerHost,
    fileEditorHost,
    setFileExplorerPortaled,
    addFileToChatContext,
    setMainView,
    fileWorkbenchMattersPickList,
    matterRefreshVersion,
    recordsDeskMattersSetSelectedKey,
    setMatterCockpitOpen,
    matterCockpitOpen,
    workspaceCasesMenu,
  } = input;

  return useMemo((): LawmindFileWorkbenchHostProps | null => {
    if (!workspaceDir || !apiBase) {
      return null;
    }
    return {
      showSidebarWorkbenchFiles,
      workspaceDir,
      projectDir,
      fileExplorerHost,
      fileEditorHost,
      onExplorerPortaled: setFileExplorerPortaled,
      onAddToChatContext: (payload) => {
        addFileToChatContext(payload);
        setMainView("workspace");
      },
      mattersPickList: fileWorkbenchMattersPickList,
      workspaceTreeRefreshKey: matterRefreshVersion,
      apiBase,
      onOpenUnlinkedMatters: () => {
        recordsDeskMattersSetSelectedKey(RECORDS_DESK_UNLINKED);
        setMatterCockpitOpen(true);
      },
      matterCockpitOpen,
      onToggleMatterCockpit: () => setMatterCockpitOpen((v) => !v),
      casesNodeActions: workspaceCasesMenu,
    };
  }, [
    workspaceDir,
    apiBase,
    showSidebarWorkbenchFiles,
    projectDir,
    fileExplorerHost,
    fileEditorHost,
    setFileExplorerPortaled,
    addFileToChatContext,
    setMainView,
    fileWorkbenchMattersPickList,
    matterRefreshVersion,
    recordsDeskMattersSetSelectedKey,
    setMatterCockpitOpen,
    matterCockpitOpen,
    workspaceCasesMenu,
  ]);
}
