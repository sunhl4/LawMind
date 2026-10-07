import { useMemo } from "react";
import { useSettingsPanelStore } from "../stores/settings-panel-store";
import type {
  AgentsDeskTab,
  AgentsWorkflowFocusTarget,
  NeedsDecisionDeskTarget,
} from "../lawmind-agents-desk";
import type { AppConfig } from "../lawmind-app-bootstrap";
import type { LawmindHealthState } from "../useLawmindAppBootstrapEffects";
import type { CollabSummaryState } from "../LawmindSettingsCollaboration";
import type { AssistantRow } from "../lawmind-settings-models.ts";
import type { ModelCatalogEntry } from "../lawmind-models-api";
import type { LawmindMainView } from "../lawmind-main-view";
import type { CollabEvent, DelegationRow, GateHistoryItem } from "../lawmind-app-data";
import type { LawmindAppSettingsPanelProps } from "./LawmindAppSettingsPanel";
import { requestOpenCollaborationSettings } from "../lawmind-automations-nav-bus";
import { requestOpenWorkspaceFile } from "../lawmind-workspace-file-open";

export type UseLawmindAppSettingsPanelPropsInput = {
  config: AppConfig | null;
  projectDir: string | null;
  workspaceLabel: string;
  health: LawmindHealthState;
  collabSummarySettings: CollabSummaryState;
  selectedAssistantId: string;
  setSelectedAssistantId: (assistantId: string) => void;
  selectedAssistant: AssistantRow | undefined;
  selectedAssistantStats: AssistantRow["stats"] | undefined;
  retrievalLabel: string;
  retrievalSaving: boolean;
  draftWithModelSaving: boolean;
  openNewAssistant: (presetKey?: string) => void;
  openEditAssistant: () => void;
  removeAssistant: () => void | Promise<void>;
  duplicateAssistant: () => void | Promise<void>;
  patchAssistantRoster: (
    assistantId: string,
    patch: { pinned?: boolean; hidden?: boolean },
  ) => void | Promise<void>;
  applyRetrievalMode: (mode: "single" | "dual") => void | Promise<void>;
  applyDraftWithModelEnabled: (enabled: boolean) => void | Promise<void>;
  npcSaving?: boolean;
  applyOpenLawNpc?: (enabled: boolean) => void | Promise<void>;
  authoritySaving?: boolean;
  saveAuthority?: (payload: import("../LawmindAuthoritySetup").AuthoritySavePayload) => Promise<void>;
  reconnectLocalService: () => void | Promise<void>;
  localServiceReconnecting: boolean;
  openApiWizard: () => void;
  onVerifyModel?: () => void | Promise<void>;
  platformProviders: import("../lawmind-models-api").PlatformProviderKeyStatus[];
  platformMode: "proxy" | "platform_key" | "none";
  selectedModelId: string;
  modelCatalog: ModelCatalogEntry[];
  refreshModelsCatalog: (apiBase: string) => void | Promise<void>;
  pickProject: () => void | Promise<void>;
  clearProject: () => void | Promise<void>;
  setAgentsDeskTab: (tab: AgentsDeskTab) => void;
  setAgentsNeedsDecisionFocus?: (focus: boolean) => void;
  setAgentsDeskFocusTarget?: (target: NeedsDecisionDeskTarget | null) => void;
  setAgentsWorkflowFocus?: (target: AgentsWorkflowFocusTarget | null) => void;
  setContextMatterId?: (matterId: string | null) => void;
  setWsShowEditor?: (show: boolean) => void;
  setMainView: (view: LawmindMainView) => void;
  assistants: AssistantRow[];
  onPrefsChange: () => void;
  matterSidebarRows?: Array<{ matterId?: string | null; title: string }>;
  contextMatterId?: string | null;
  onOpenReviewFromAutomation?: (taskId: string, matterId?: string) => void;
  delegations?: DelegationRow[];
  collabEvents?: CollabEvent[];
  gateHistory?: GateHistoryItem[];
  formatRelativeTime?: (iso: string) => string;
  onRefreshCollaboration?: () => void | Promise<void>;
  onOpenDelegationTargetChat?: (delegation: DelegationRow) => void | Promise<void>;
  assistantDisplayById?: Record<string, string>;
  workflowModelLabel?: string;
};

export function useLawmindAppSettingsPanelProps(
  input: UseLawmindAppSettingsPanelPropsInput,
): LawmindAppSettingsPanelProps {
  const showSettings = useSettingsPanelStore((s) => s.open);
  const setShowSettings = useSettingsPanelStore((s) => s.setSettingsPanel);
  const settingsSectionId = useSettingsPanelStore((s) => s.sectionId);
  const settingsScrollAnchor = useSettingsPanelStore((s) => s.scrollAnchorId);

  const {
    config,
    projectDir,
    workspaceLabel,
    health,
    collabSummarySettings,
    selectedAssistantId,
    setSelectedAssistantId,
    selectedAssistant,
    selectedAssistantStats,
    retrievalLabel,
    retrievalSaving,
    draftWithModelSaving,
    openNewAssistant,
    openEditAssistant,
    removeAssistant,
    duplicateAssistant,
    patchAssistantRoster,
    applyRetrievalMode,
    applyDraftWithModelEnabled,
    npcSaving,
    applyOpenLawNpc,
    authoritySaving,
    saveAuthority,
    reconnectLocalService,
    localServiceReconnecting,
    openApiWizard,
    onVerifyModel,
    platformProviders,
    platformMode,
    selectedModelId,
    modelCatalog,
    refreshModelsCatalog,
    pickProject,
    clearProject,
    setAgentsDeskTab,
    setAgentsNeedsDecisionFocus,
    setAgentsDeskFocusTarget,
    setAgentsWorkflowFocus,
    setContextMatterId,
    setWsShowEditor,
    setMainView,
    assistants,
    onPrefsChange,
    matterSidebarRows = [],
    contextMatterId = null,
    onOpenReviewFromAutomation,
    delegations,
    collabEvents,
    gateHistory,
    formatRelativeTime,
    onRefreshCollaboration,
    onOpenDelegationTargetChat,
    assistantDisplayById,
    workflowModelLabel,
  } = input;

  const automationMatterOptions = useMemo(() => {
    const out: Array<{ id: string; title: string }> = [];
    const seen = new Set<string>();
    for (const row of matterSidebarRows) {
      const id = row.matterId?.trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      out.push({ id, title: row.title?.trim() || id });
    }
    return out;
  }, [matterSidebarRows]);

  const automationMatterId =
    contextMatterId?.trim() ||
    automationMatterOptions[0]?.id ||
    null;

  return useMemo(
    (): LawmindAppSettingsPanelProps => ({
      open: showSettings,
      initialSectionId: settingsSectionId,
      scrollAnchorId: settingsScrollAnchor,
      config,
      projectDir,
      workspaceLabel,
      health,
      collabSummarySettings,
      assistants,
      selectedAssistantId,
      onSelectAssistantId: setSelectedAssistantId,
      selectedAssistant,
      selectedAssistantStats,
      retrievalLabel,
      retrievalSaving,
      draftWithModelSaving,
      onClose: () => setShowSettings(false),
      onOpenNewAssistant: openNewAssistant,
      onOpenEditAssistant: openEditAssistant,
      onRemoveAssistant: () => void removeAssistant(),
      onDuplicateAssistant: () => void duplicateAssistant(),
      onPatchAssistantRoster: (assistantId, patch) => void patchAssistantRoster(assistantId, patch),
      onApplyRetrievalMode: applyRetrievalMode,
      onApplyDraftWithModelEnabled: applyDraftWithModelEnabled,
      npcSaving: npcSaving ?? false,
      onApplyOpenLawNpc: applyOpenLawNpc,
      authoritySaving: authoritySaving ?? false,
      onSaveAuthority: saveAuthority,
      onReconnectLocalService: reconnectLocalService,
      localServiceReconnecting,
      onOpenApiWizard: openApiWizard,
      onVerifyModel,
      platformProviders,
      platformMode,
      selectedModelId,
      customModels: modelCatalog.filter((m) => m.kind === "custom"),
      modelCatalog,
      onModelsChanged: async () => {
        if (config?.apiBase) {
          await refreshModelsCatalog(config.apiBase);
        }
      },
      onPickProject: () => void pickProject(),
      onClearProject: () => void clearProject(),
      onOpenArchiveOrganize: () => {
        setShowSettings(false);
        setMainView("archive");
      },
      onOpenCollaborationPage: () => {
        requestOpenCollaborationSettings();
      },
      onPrefsChange,
      automationMatterId,
      automationMatterOptions,
      onOpenAutomationsNeedsDecision: (target?: NeedsDecisionDeskTarget) => {
        const hasTarget = Boolean(
          target?.sessionId?.trim() ||
            target?.taskId?.trim() ||
            target?.queueItemId?.trim() ||
            target?.jobId?.trim() ||
            target?.preferStatus,
        );
        if (hasTarget && target) {
          setAgentsDeskFocusTarget?.(target);
          if (target.matterId?.trim()) {
            setContextMatterId?.(target.matterId.trim());
          }
        } else {
          setAgentsDeskFocusTarget?.(null);
        }
        const mid = target?.matterId?.trim();
        setShowSettings(false);
        if (mid) {
          setContextMatterId?.(mid);
          setMainView("desk");
          return;
        }
        setMainView("desk");
      },
      onOpenAutomationsReview: (taskId, matterId) => {
        setShowSettings(false);
        onOpenReviewFromAutomation?.(taskId, matterId);
      },
      onOpenAutomationsCollaboration: (matterId?: string, jobId?: string) => {
        const mid = matterId?.trim();
        const jid = jobId?.trim();
        if (mid) {
          setContextMatterId?.(mid);
        }
        setAgentsWorkflowFocus?.(
          mid || jid ? { matterId: mid || undefined, jobId: jid || undefined } : null,
        );
        requestOpenCollaborationSettings();
      },
      delegations,
      collabEvents,
      gateHistory,
      formatRelativeTime,
      onRefreshCollaboration,
      onOpenDelegationTargetChat,
      assistantDisplayById,
      workflowModelLabel,
      onOpenAutomationsWorkspaceFile: (relPath: string, matterId?: string) => {
        const path = relPath.trim();
        if (!path) {
          return;
        }
        const mid = matterId?.trim();
        if (mid) {
          setContextMatterId?.(mid);
        }
        setShowSettings(false);
        setMainView("workspace");
        setWsShowEditor?.(true);
        // 登记 pending + 立即派发：FileWorkbench 未挂载时挂载后消费，不再靠 setTimeout 竞速。
        requestOpenWorkspaceFile(path);
      },
    }),
    [
      showSettings,
      settingsSectionId,
      settingsScrollAnchor,
      config,
      projectDir,
      workspaceLabel,
      health,
      collabSummarySettings,
      assistants,
      selectedAssistantId,
      setSelectedAssistantId,
      selectedAssistant,
      selectedAssistantStats,
      retrievalLabel,
      retrievalSaving,
      draftWithModelSaving,
      setShowSettings,
      openNewAssistant,
      openEditAssistant,
      removeAssistant,
      duplicateAssistant,
      patchAssistantRoster,
      applyRetrievalMode,
      applyDraftWithModelEnabled,
      reconnectLocalService,
      localServiceReconnecting,
      openApiWizard,
      onVerifyModel,
      platformProviders,
      platformMode,
      selectedModelId,
      modelCatalog,
      refreshModelsCatalog,
      pickProject,
      clearProject,
      setAgentsDeskTab,
      setAgentsNeedsDecisionFocus,
      setAgentsDeskFocusTarget,
      setAgentsWorkflowFocus,
      setContextMatterId,
      setWsShowEditor,
      setMainView,
      delegations,
      collabEvents,
      gateHistory,
      formatRelativeTime,
      onRefreshCollaboration,
      onOpenDelegationTargetChat,
      assistantDisplayById,
      workflowModelLabel,
      onPrefsChange,
      automationMatterId,
      automationMatterOptions,
      onOpenReviewFromAutomation,
    ],
  );
}
