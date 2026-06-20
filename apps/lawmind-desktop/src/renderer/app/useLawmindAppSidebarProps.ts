import { useMemo } from "react";
import type { CollabEvent, DelegationRow, TaskRow } from "../lawmind-app-data";
import type { MatterSidebarRow } from "../lawmind-records-desk-state";
import type { CollabSummaryState } from "../LawmindSettingsCollaboration";
import type { LawmindAppSidebarProps } from "./LawmindAppSidebar";

export type UseLawmindAppSidebarPropsInput = {
  showAppSidebar: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  showSidebarWorkbenchFiles: boolean;
  showExplorerSkeleton: boolean;
  showCollaborationSidebar: boolean;
  onSidebarResizePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  setShowHelp: (open: boolean) => void;
  setShowSettings: (open: boolean) => void;
  showSettings: boolean;
  setFileExplorerHost: (el: HTMLDivElement | null) => void;
  actionSummaryTotal: number;
  actionSummaryActiveJobs: number;
  delegations: DelegationRow[];
  collabEvents: CollabEvent[];
  collabTab: "delegations" | "timeline";
  setCollabTab: (tab: "delegations" | "timeline") => void;
  filteredTasks: TaskRow[];
  matterSidebarRows: MatterSidebarRow[];
  selectedMatterKey: string | null;
  onSelectMatterKey: (matterId: string) => void;
  onSelectMatterForCockpit: (matterId: string) => void;
  matterCockpitOpen: boolean;
  mainView: "workspace" | "collaboration" | "review";
  formatRelativeTime: (iso: string) => string;
  legalStatusLabel: (status: string | undefined, kind?: string) => string;
  taskBadgeClass: (status: string, kind?: string) => string;
  openDetail: (kind: "task" | "draft", id: string) => void | Promise<void>;
  openDelegationTargetWorkspaceChat: (delegation: DelegationRow) => void | Promise<void>;
  setShowActionHub: (open: boolean) => void;
  refreshCollaboration: () => void | Promise<void>;
  collabSummarySettings: CollabSummaryState | null | undefined;
};

export function useLawmindAppSidebarProps(input: UseLawmindAppSidebarPropsInput): LawmindAppSidebarProps {
  const {
    showAppSidebar,
    sidebarCollapsed,
    sidebarWidth,
    showSidebarWorkbenchFiles,
    showExplorerSkeleton,
    showCollaborationSidebar,
    onSidebarResizePointerDown,
    setShowHelp,
    setShowSettings,
    showSettings,
    setFileExplorerHost,
    actionSummaryTotal,
    actionSummaryActiveJobs,
    delegations,
    collabEvents,
    collabTab,
    setCollabTab,
    filteredTasks,
    matterSidebarRows,
    selectedMatterKey,
    onSelectMatterKey,
    onSelectMatterForCockpit,
    matterCockpitOpen,
    mainView,
    formatRelativeTime,
    legalStatusLabel,
    taskBadgeClass,
    openDetail,
    openDelegationTargetWorkspaceChat,
    setShowActionHub,
    refreshCollaboration,
    collabSummarySettings,
  } = input;

  return useMemo(
    (): LawmindAppSidebarProps => ({
      showAppSidebar,
      sidebarCollapsed,
      sidebarWidth,
      showSidebarWorkbenchFiles,
      showExplorerSkeleton,
      showCollaborationSidebar,
      onSidebarResizePointerDown,
      onOpenHelp: () => setShowHelp(true),
      onOpenSettings: () => setShowSettings(true),
      onCloseSettings: () => setShowSettings(false),
      settingsOpen: showSettings,
      setFileExplorerHost,
      actionSummaryTotal,
      actionSummaryActiveJobs,
      delegations,
      collabEvents,
      collabTab,
      onSelectCollabTab: setCollabTab,
      filteredTasks,
      matterSidebarRows,
      selectedMatterKey,
      onSelectMatterKey,
      onSelectMatterForCockpit,
      matterCockpitOpen,
      mainView,
      formatRelativeTime,
      legalStatusLabel,
      taskBadgeClass,
      onOpenDetail: openDetail,
      onOpenDelegationTargetChat: openDelegationTargetWorkspaceChat,
      onOpenActionHub: () => setShowActionHub(true),
      onRefreshCollaboration: refreshCollaboration,
      collabSummarySettings,
    }),
    [
      showAppSidebar,
      sidebarCollapsed,
      sidebarWidth,
      showSidebarWorkbenchFiles,
      showExplorerSkeleton,
      showCollaborationSidebar,
      onSidebarResizePointerDown,
      setShowHelp,
      setShowSettings,
      showSettings,
      setFileExplorerHost,
      actionSummaryTotal,
      actionSummaryActiveJobs,
      delegations,
      collabEvents,
      collabTab,
      setCollabTab,
      filteredTasks,
      matterSidebarRows,
      selectedMatterKey,
      onSelectMatterKey,
      onSelectMatterForCockpit,
      matterCockpitOpen,
      mainView,
      formatRelativeTime,
      legalStatusLabel,
      taskBadgeClass,
      openDetail,
      openDelegationTargetWorkspaceChat,
      setShowActionHub,
      refreshCollaboration,
      collabSummarySettings,
    ],
  );
}
