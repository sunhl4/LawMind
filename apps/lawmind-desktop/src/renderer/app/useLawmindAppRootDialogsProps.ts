import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { FileWorkbenchCasesNodeActions } from "../FileWorkbench";
import type { RootKey } from "../file/file-workbench-types";
import type { LawmindMainView } from "../lawmind-main-view";
import { tryClarifyAttachFile } from "../lawmind-clarify-bring-in-bus";
import { useEdition } from "../use-edition";
import { apiSendJson } from "../api-client";
import { takePendingAgendaMatterLink } from "../lawmind-desk-nav";
import type { LawmindAppRootDialogsProps } from "./LawmindAppRootDialogs";
import type { LawmindFileWorkbenchHostProps } from "./LawmindFileWorkbenchHost";
import type { CommandPaletteAction } from "../LawmindCommandPalette";
import type { DeskMatterFocusPane } from "./desk-matter-focus";

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
  globalSearchOpen: boolean;
  setGlobalSearchOpen: (open: boolean) => void;
  globalSearchCommands: CommandPaletteAction[];
  openMatterDossierFromSearch: (matterId: string, pane?: DeskMatterFocusPane) => void;
  openNewAssistant: () => void;
  /** After create: open 工作台本案卷宗 so the new case is visible immediately. */
  openMatterOnDesk?: (matterId: string) => void;
};

export function useLawmindAppRootDialogsProps(
  input: UseLawmindAppRootDialogsPropsInput,
): LawmindAppRootDialogsProps {
  const { features } = useEdition(input.apiBase ?? "");
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
    globalSearchOpen,
    setGlobalSearchOpen,
    globalSearchCommands,
    openMatterDossierFromSearch,
    openNewAssistant,
    openMatterOnDesk,
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
      onCreateAssistant: features.multiAssistantRoster
        ? () => {
            setDelegateAssistOpen(false);
            openNewAssistant();
          }
        : undefined,
      createMatterOpen,
      onCloseCreateMatter: () => {
        takePendingAgendaMatterLink();
        setCreateMatterOpen(false);
      },
      onCreateMatterSuccess: (mid) => {
        const pending = takePendingAgendaMatterLink();
        const base = apiBase?.trim();
        if (pending && base) {
          void apiSendJson(
            base,
            `/api/desk/plan/items/${encodeURIComponent(pending.itemId)}`,
            "PATCH",
            {
              matterId: mid,
              ...(pending.originDate ? { date: pending.originDate } : {}),
            },
          )
            .catch(() => undefined)
            .finally(() => {
              setMatterRefreshVersion((v) => v + 1);
              recordsDeskMattersSetSelectedKey(mid);
              openMatterOnDesk?.(mid);
            });
          return;
        }
        setMatterRefreshVersion((v) => v + 1);
        recordsDeskMattersSetSelectedKey(mid);
        openMatterOnDesk?.(mid);
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
      globalSearchOpen,
      setGlobalSearchOpen,
      globalSearchCommands,
      openMatterDossierFromSearch,
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
      globalSearchOpen,
      setGlobalSearchOpen,
      globalSearchCommands,
      openMatterDossierFromSearch,
      openNewAssistant,
      openMatterOnDesk,
      features.multiAssistantRoster,
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
  fileExplorerCasesHost: HTMLDivElement | null;
  fileEditorHost: HTMLDivElement | null;
  setFileExplorerPortaled: Dispatch<SetStateAction<boolean>>;
  addFileToChatContext: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  setMainView: (view: LawmindMainView) => void;
  mainView: LawmindMainView;
  fileWorkbenchMattersPickList: Array<{ id: string; label: string }>;
  matterRefreshVersion: number;
  workspaceCasesMenu: FileWorkbenchCasesNodeActions | null;
  /** 当前对话范围。有案件时材料树只展开这一案。 */
  explorerMatterId?: string | null;
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
    fileExplorerCasesHost,
    fileEditorHost,
    setFileExplorerPortaled,
    addFileToChatContext,
    setMainView,
    mainView,
    fileWorkbenchMattersPickList,
    matterRefreshVersion,
    workspaceCasesMenu,
    explorerMatterId = null,
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
      fileExplorerCasesHost,
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
      explorerMatterId,
      materialsDefaultOpen: isMeeting,
    };
  }, [
    workspaceDir,
    apiBase,
    showSidebarWorkbenchFiles,
    projectDir,
    onPickProject,
    fileExplorerHost,
    fileExplorerCasesHost,
    fileEditorHost,
    setFileExplorerPortaled,
    addFileToChatContext,
    setMainView,
    mainView,
    fileWorkbenchMattersPickList,
    matterRefreshVersion,
    workspaceCasesMenu,
    explorerMatterId,
  ]);
}
