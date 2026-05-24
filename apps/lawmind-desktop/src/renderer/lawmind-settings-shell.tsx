import { LawmindSettingsAppUpdate } from "./LawmindSettingsAppUpdate";
import { LawmindSettingsAssistants } from "./LawmindSettingsAssistants";
import type { CollabSummaryState } from "./LawmindSettingsCollaboration";
import { LawmindSettingsCollaborationBrief } from "./LawmindSettingsCollaboration";
import { LawmindSettingsDisclaimer } from "./LawmindSettingsDisclaimer";
import { LawmindSettingsEdition } from "./LawmindSettingsEdition";
import { LawmindSettingsModelRetrieval } from "./LawmindSettingsModelRetrieval";
import { LawmindSettingsOnboarding } from "./LawmindSettingsOnboarding";
import { LawmindSettingsRoles } from "./LawmindSettingsRoles";
import { LawmindSettingsTemplates } from "./LawmindSettingsTemplates";
import { LawmindSettingsAppearance } from "./LawmindSettingsAppearance";
import { LawmindSettingsReviewPrefs } from "./LawmindSettingsReviewPrefs";
import { LawmindSettingsWorkspace } from "./LawmindSettingsWorkspace";
import { LawmindSettingsDoctor } from "./LawmindSettingsDoctor";
import { LawmindSettingsTools } from "./LawmindSettingsTools";
import { LawmindSettingsUsageStats } from "./LawmindSettingsUsageStats";
import type { AppConfig } from "./lawmind-app-bootstrap";
import type { ModelCatalogEntry, ProviderKeyStatus } from "./lawmind-models-api";
import type { AssistantRow } from "./lawmind-settings-models.ts";

type SetProjectDirBridge = NonNullable<Window["lawmindDesktop"]>["setProjectDir"];

export async function clearProjectDirectory(args: {
  config: AppConfig | null;
  setProjectDir?: SetProjectDirBridge;
}): Promise<{ projectDir?: string | null; apiBase?: string; error?: string }> {
  const { config, setProjectDir } = args;
  if (!config || !setProjectDir) {
    return {};
  }
  const response = await setProjectDir(null);
  if (!response.ok) {
    return { error: response.error || "关闭项目失败" };
  }
  return {
    projectDir: response.projectDir ?? null,
    apiBase: typeof response.apiBase === "string" ? response.apiBase : undefined,
  };
}

type Props = {
  open: boolean;
  config: AppConfig | null;
  projectDir: string | null;
  workspaceLabel: string;
  health: {
    modelConfigured: boolean;
    retrievalMode?: string;
    dualLegalConfigured?: boolean;
    webSearchApiKeyConfigured?: boolean;
    modelName?: string | null;
    modelEnvFileExists?: boolean;
    draftWithModelEnabled?: boolean;
    draftWithModelActive?: boolean;
  } | null;
  collabSummarySettings: CollabSummaryState;
  assistants: AssistantRow[];
  selectedAssistantId: string;
  onSelectAssistantId: (assistantId: string) => void;
  selectedAssistant?: AssistantRow;
  selectedAssistantStats?: AssistantRow["stats"];
  retrievalLabel: string;
  retrievalSaving: boolean;
  draftWithModelSaving?: boolean;
  onClose: () => void;
  onOpenNewAssistant: () => void;
  onOpenEditAssistant: () => void;
  onRemoveAssistant: () => void | Promise<void>;
  onApplyRetrievalMode: (mode: "single" | "dual") => void | Promise<void>;
  onApplyDraftWithModelEnabled?: (enabled: boolean) => void | Promise<void>;
  onReconnectLocalService?: () => void | Promise<void>;
  localServiceReconnecting?: boolean;
  onOpenApiWizard: () => void;
  modelProviders?: ProviderKeyStatus[];
  platformProviders?: import("./lawmind-models-api").PlatformProviderKeyStatus[];
  platformMode?: "proxy" | "platform_key" | "none";
  selectedModelId?: string;
  customModels?: ModelCatalogEntry[];
  modelCatalog?: ModelCatalogEntry[];
  onModelsChanged?: () => void | Promise<void>;
  onPickProject: () => void | Promise<void>;
  onClearProject: () => void | Promise<void>;
  onOpenCollaborationPage: () => void;
  onPrefsChange?: () => void;
};

export function LawmindSettingsDialog({
  open,
  config,
  projectDir,
  workspaceLabel,
  health,
  collabSummarySettings,
  assistants,
  selectedAssistantId,
  onSelectAssistantId,
  selectedAssistant,
  selectedAssistantStats,
  retrievalLabel,
  retrievalSaving,
  draftWithModelSaving = false,
  onClose,
  onOpenNewAssistant,
  onOpenEditAssistant,
  onRemoveAssistant,
  onApplyRetrievalMode,
  onApplyDraftWithModelEnabled,
  onReconnectLocalService,
  localServiceReconnecting = false,
  onOpenApiWizard,
  modelProviders,
  platformProviders,
  platformMode,
  selectedModelId,
    customModels,
    modelCatalog = customModels,
    onModelsChanged,
  onPickProject,
  onClearProject,
  onOpenCollaborationPage,
  onPrefsChange,
}: Props) {
  if (!open) {
    return null;
  }

  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="设置">
      <div className="lm-wizard lm-settings-panel">
        <div className="lm-settings-header">
          <h2>设置</h2>
          <button
            type="button"
            className="lm-settings-close"
            onClick={onClose}
            aria-label="关闭设置"
          >
            ×
          </button>
        </div>
        <p className="lm-meta lm-settings-lead">
          本机律师工作台：可建<strong>多个智能体</strong>各管一摊事；多步团队流程与后台任务在顶部<strong>协作</strong>页运行与查看。出具对外材料前，务必在顶部<strong>审核</strong>里通过把关。
        </p>

        {config && <LawmindSettingsOnboarding health={health} projectDir={projectDir} />}

        {config && <LawmindSettingsUsageStats apiBase={config.apiBase} />}

        {config && (
          <LawmindSettingsDoctor
            health={null}
            apiBase={config.apiBase}
            onOpenApiWizard={onOpenApiWizard}
            onOpenCollaborationPage={() => {
              onClose();
              onOpenCollaborationPage();
            }}
            onScrollToWorkspace={() => {
              document.getElementById("lawmind-settings-workspace")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }}
          />
        )}

        <LawmindSettingsAppearance onPrefsChange={onPrefsChange} />

        <LawmindSettingsReviewPrefs />

        {config && (
          <LawmindSettingsCollaborationBrief
            collabSummarySettings={collabSummarySettings}
            localServiceReconnecting={localServiceReconnecting}
            onReconnectLocalService={onReconnectLocalService}
            onOpenCollaborationPage={() => {
              onClose();
              onOpenCollaborationPage();
            }}
          />
        )}

        <LawmindSettingsAssistants
          assistants={assistants}
          selectedAssistantId={selectedAssistantId}
          onSelectAssistantId={onSelectAssistantId}
          selectedAssistant={selectedAssistant}
          selectedAssistantStats={selectedAssistantStats}
          onOpenNew={onOpenNewAssistant}
          onOpenEdit={onOpenEditAssistant}
          onRemove={() => void onRemoveAssistant()}
        />

        {config && (
          <LawmindSettingsModelRetrieval
            config={{
              workspaceDir: config.workspaceDir,
              projectDir: config.projectDir,
              retrievalMode: config.retrievalMode,
            }}
            health={health}
            envFilePath={config.envFilePath}
            retrievalLabel={retrievalLabel}
            retrievalSaving={retrievalSaving}
            draftWithModelSaving={draftWithModelSaving}
            applyRetrievalMode={onApplyRetrievalMode}
            applyDraftWithModelEnabled={onApplyDraftWithModelEnabled}
            apiBase={config.apiBase}
            modelProviders={modelProviders}
            platformProviders={platformProviders}
            platformMode={platformMode}
            selectedModelId={selectedModelId}
            customModels={customModels}
            modelCatalog={modelCatalog}
            onModelsChanged={onModelsChanged}
            onOpenApiWizard={onOpenApiWizard}
          />
        )}

        {config && (
          <LawmindSettingsWorkspace
            config={{
              workspaceDir: config.workspaceDir,
              projectDir: config.projectDir,
              retrievalMode: config.retrievalMode,
            }}
            workspaceLabel={workspaceLabel}
            projectDir={projectDir}
            onPickProject={() => void onPickProject()}
            onClearProject={() => void onClearProject()}
          />
        )}
        {config && <LawmindSettingsTools apiBase={config.apiBase} />}
        {config && <LawmindSettingsRoles apiBase={config.apiBase} />}
        {config && <LawmindSettingsTemplates apiBase={config.apiBase} />}
        {config && <LawmindSettingsEdition apiBase={config.apiBase} />}
        <LawmindSettingsAppUpdate config={config} />
        <LawmindSettingsDisclaimer />
      </div>
    </div>
  );
}
