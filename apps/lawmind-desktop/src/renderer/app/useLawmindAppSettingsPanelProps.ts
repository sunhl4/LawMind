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
import type { ModelCatalogEntry, ProviderKeyStatus } from "../lawmind-models-api";
import type { LawmindMainView } from "../lawmind-main-view";
import type { LawmindAppSettingsPanelProps } from "./LawmindAppSettingsPanel";
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
  applyRetrievalMode: (mode: "single" | "dual") => void | Promise<void>;
  applyDraftWithModelEnabled: (enabled: boolean) => void | Promise<void>;
  reconnectLocalService: () => void | Promise<void>;
  localServiceReconnecting: boolean;
  openApiWizard: () => void;
  modelProviders: ProviderKeyStatus[];
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
    applyRetrievalMode,
    applyDraftWithModelEnabled,
    reconnectLocalService,
    localServiceReconnecting,
    openApiWizard,
    modelProviders,
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
      onApplyRetrievalMode: applyRetrievalMode,
      onApplyDraftWithModelEnabled: applyDraftWithModelEnabled,
      onReconnectLocalService: reconnectLocalService,
      localServiceReconnecting,
      onOpenApiWizard: openApiWizard,
      modelProviders,
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
      onOpenCollaborationPage: () => {
        // 「去在办处理」→ 待拍板（领导主入口）；按流程仍可从在办分区进入。
        setAgentsDeskTab("active");
        setMainView("agents");
        setShowSettings(false);
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
        setAgentsNeedsDecisionFocus?.(true);
        setAgentsDeskTab("active");
        setMainView("agents");
        setShowSettings(false);
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
        setAgentsDeskTab("workflows");
        setMainView("agents");
        setShowSettings(false);
      },
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
      applyRetrievalMode,
      applyDraftWithModelEnabled,
      reconnectLocalService,
      localServiceReconnecting,
      openApiWizard,
      modelProviders,
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
      onPrefsChange,
      automationMatterId,
      automationMatterOptions,
      onOpenReviewFromAutomation,
    ],
  );
}
