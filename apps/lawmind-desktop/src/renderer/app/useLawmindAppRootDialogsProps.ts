import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { FileWorkbenchCasesNodeActions } from "../FileWorkbench";
import type { RootKey } from "../file/file-workbench-types";
import type { LawmindMainView } from "../lawmind-main-view";
import { tryClarifyAttachFile } from "../lawmind-clarify-bring-in-bus";
import type { LawmindAppRootDialogsProps } from "./LawmindAppRootDialogs";
import type { LawmindFileWorkbenchHostProps } from "./LawmindFileWorkbenchHost";

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
  matterDeleteOpen: { matterId: string; label: string } | null;
  setMatterDeleteOpen: (value: { matterId: string; label: string } | null) => void;
  setContextMatterId: (id: string | null) => void;
  taskDrawerOpen: boolean;
  setTaskDrawerOpen: (open: boolean) => void;
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
    matterDeleteOpen,
    setMatterDeleteOpen,
    setContextMatterId,
    taskDrawerOpen,
    setTaskDrawerOpen,
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
      matterDeleteOpen,
      onCloseMatterDelete: () => setMatterDeleteOpen(null),
      onMatterDeleteSuccess: (mid) => {
        if (contextMatterId === mid) {
          setContextMatterId(null);
        }
      },
      onMatterListChanged: () => setMatterRefreshVersion((v) => v + 1),
      taskDrawerOpen,
      onCloseTaskDrawer: () => setTaskDrawerOpen(false),
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
      matterDeleteOpen,
      setMatterDeleteOpen,
      setContextMatterId,
      taskDrawerOpen,
      setTaskDrawerOpen,
    ],
  );
}

export type UseLawmindFileWorkbenchHostPropsInput = {
  workspaceDir: string | undefined;
  apiBase: string | undefined;
  showSidebarWorkbenchFiles: boolean;
  projectDir: string | null;
  onPickProject?: () => void | Promise<void>;
  fileExplorerHost: HTMLDivElement | null;
  fileEditorHost: HTMLDivElement | null;
  setFileExplorerPortaled: Dispatch<SetStateAction<boolean>>;
  addFileToChatContext: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  setMainView: (view: LawmindMainView) => void;
  mainView: LawmindMainView;
  fileWorkbenchMattersPickList: Array<{ id: string; label: string }>;
  matterRefreshVersion: number;
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
    onPickProject,
    fileExplorerHost,
    fileEditorHost,
    setFileExplorerPortaled,
    addFileToChatContext,
    setMainView,
    mainView,
    fileWorkbenchMattersPickList,
    matterRefreshVersion,
    workspaceCasesMenu,
  } = input;

  return useMemo((): LawmindFileWorkbenchHostProps | null => {
    if (!workspaceDir || !apiBase) {
      return null;
    }
    const isMeeting = mainView === "meeting";
    const isAgents = mainView === "agents";
    return {
      showSidebarWorkbenchFiles,
      workspaceDir,
      projectDir,
      onPickProject,
      fileExplorerHost,
      fileEditorHost,
      onExplorerPortaled: setFileExplorerPortaled,
      explorerVariant: isMeeting ? "meeting" : isAgents ? "agents" : "workspace",
      onAddToChatContext: (payload) => {
        if (
          tryClarifyAttachFile({
            root: payload.root,
            relPath: payload.relPath,
            kind: payload.kind,
          })
        ) {
          return;
        }
        addFileToChatContext(payload);
        // 会议室 / 在办：加入材料后留在当前页；对话页才跳回 workspace。
        if (!isMeeting && !isAgents) {
          setMainView("workspace");
        }
      },
      mattersPickList: fileWorkbenchMattersPickList,
      workspaceTreeRefreshKey: matterRefreshVersion,
      casesNodeActions: workspaceCasesMenu,
    };
  }, [
    workspaceDir,
    apiBase,
    showSidebarWorkbenchFiles,
    projectDir,
    onPickProject,
    fileExplorerHost,
    fileEditorHost,
    setFileExplorerPortaled,
    addFileToChatContext,
    setMainView,
    mainView,
    fileWorkbenchMattersPickList,
    matterRefreshVersion,
    workspaceCasesMenu,
  ]);
}
