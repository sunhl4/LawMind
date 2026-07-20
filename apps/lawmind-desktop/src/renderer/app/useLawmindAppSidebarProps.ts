import { useMemo } from "react";
import type { MatterSidebarRow } from "../lawmind-records-desk-state";
import type { SideChatSessionRow } from "../LawmindSideChatSessions";
import type { LawmindAppSidebarProps } from "./LawmindAppSidebar";
import type { LawmindMainView } from "../lawmind-main-view";

export type UseLawmindAppSidebarPropsInput = {
  showAppSidebar: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  showSidebarWorkbenchFiles: boolean;
  showExplorerSkeleton: boolean;
  onSidebarResizePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  setShowSettings: (open: boolean) => void;
  showSettings: boolean;
  setFileExplorerHost: (el: HTMLDivElement | null) => void;
  actionSummaryTotal: number;
  matterSidebarRows: MatterSidebarRow[];
  selectedMatterKey: string | null;
  onSelectMatterKey: (matterId: string) => void;
  onSelectMatterForCockpit: (matterId: string) => void;
  onSelectMatterScope?: (matterId: string) => void;
  matterCockpitOpen: boolean;
  mainView: LawmindMainView;
  apiBase?: string;
  setMainView: (view: LawmindMainView) => void;
  setMatterCockpitOpen: (open: boolean) => void;
  setAgentsDeskTab?: (tab: import("../lawmind-agents-desk").AgentsDeskTab) => void;
  setAgentsNeedsDecisionFocus?: (focus: boolean) => void;
  chatSessions?: SideChatSessionRow[];
  activeChatSessionId?: string;
  chatSessionsLoading?: boolean;
  chatBusy?: boolean;
  onSelectChatSession?: (sessionId: string) => void | Promise<void>;
  onCreateNewChatSession?: () => void | Promise<void>;
  onRenameChatSession?: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteChatSession?: (sessionId: string) => void | Promise<void>;
  onCreateMatter?: () => void;
};

export function useLawmindAppSidebarProps(input: UseLawmindAppSidebarPropsInput): LawmindAppSidebarProps {
  const {
    showAppSidebar,
    sidebarCollapsed,
    sidebarWidth,
    showSidebarWorkbenchFiles,
    showExplorerSkeleton,
    onSidebarResizePointerDown,
    setShowSettings,
    showSettings,
    setFileExplorerHost,
    actionSummaryTotal,
    matterSidebarRows,
    selectedMatterKey,
    onSelectMatterKey,
    onSelectMatterForCockpit,
    onSelectMatterScope,
    matterCockpitOpen,
    mainView,
    apiBase,
    setMainView,
    setMatterCockpitOpen,
    setAgentsDeskTab,
    setAgentsNeedsDecisionFocus,
    chatSessions,
    activeChatSessionId,
    chatSessionsLoading,
    chatBusy,
    onSelectChatSession,
    onCreateNewChatSession,
    onRenameChatSession,
    onDeleteChatSession,
    onCreateMatter,
  } = input;

  return useMemo(
    (): LawmindAppSidebarProps => ({
      showAppSidebar,
      sidebarCollapsed,
      sidebarWidth,
      showSidebarWorkbenchFiles,
      showExplorerSkeleton,
      onSidebarResizePointerDown,
      onOpenSettings: () => setShowSettings(true),
      onCloseSettings: () => setShowSettings(false),
      settingsOpen: showSettings,
      setFileExplorerHost,
      actionSummaryTotal,
      matterSidebarRows,
      selectedMatterKey,
      onSelectMatterKey,
      onSelectMatterForCockpit,
      onSelectMatterScope,
      matterCockpitOpen,
      mainView,
      apiBase,
      onOpenNeedsDecisionDesk: () => {
        setMatterCockpitOpen(false);
        setAgentsNeedsDecisionFocus?.(true);
        setAgentsDeskTab?.("active");
        setMainView("agents");
      },
      chatSessions,
      activeChatSessionId,
      chatSessionsLoading,
      chatBusy,
      onSelectChatSession,
      onCreateNewChatSession,
      onRenameChatSession,
      onDeleteChatSession,
      onCreateMatter,
    }),
    [
      showAppSidebar,
      sidebarCollapsed,
      sidebarWidth,
      showSidebarWorkbenchFiles,
      showExplorerSkeleton,
      onSidebarResizePointerDown,
      setShowSettings,
      showSettings,
      setFileExplorerHost,
      actionSummaryTotal,
      matterSidebarRows,
      selectedMatterKey,
      onSelectMatterKey,
      onSelectMatterForCockpit,
      onSelectMatterScope,
      matterCockpitOpen,
      mainView,
      apiBase,
      setMainView,
      setMatterCockpitOpen,
      setAgentsDeskTab,
      setAgentsNeedsDecisionFocus,
      chatSessions,
      activeChatSessionId,
      chatSessionsLoading,
      chatBusy,
      onSelectChatSession,
      onCreateNewChatSession,
      onRenameChatSession,
      onDeleteChatSession,
      onCreateMatter,
    ],
  );
}
