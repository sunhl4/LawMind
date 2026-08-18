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
import { LawmindSettingsWorkspace } from "./LawmindSettingsWorkspace";
import type { AppConfig } from "./lawmind-app-bootstrap";
import type { AssistantRow } from "./lawmind-settings-models.ts";
import { settingsLeadCopy, shouldShowSettingsSection } from "./lawmind-solo-desk";

type SetProjectDirBridge = NonNullable<Window["lawmindDesktop"]>["setProjectDir"];

export async function clearProjectDirectory(args: {
  config: AppConfig | null;
  setProjectDir?: SetProjectDirBridge;
}): Promise<{ projectDir?: string | null; error?: string }> {
  const { config, setProjectDir } = args;
  if (!config || !setProjectDir) {
    return {};
  }
  const response = await setProjectDir(null);
  if (!response.ok) {
    return { error: response.error || "关闭项目失败" };
  }
  return { projectDir: response.projectDir ?? null };
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
  } | null;
  collabSummarySettings: CollabSummaryState;
  assistants: AssistantRow[];
  selectedAssistantId: string;
  onSelectAssistantId: (assistantId: string) => void;
  selectedAssistant?: AssistantRow;
  selectedAssistantStats?: AssistantRow["stats"];
  retrievalLabel: string;
  retrievalSaving: boolean;
  onClose: () => void;
  onOpenNewAssistant: () => void;
  onOpenEditAssistant: () => void;
  onRemoveAssistant: () => void | Promise<void>;
  onApplyRetrievalMode: (mode: "single" | "dual") => void | Promise<void>;
  onOpenApiWizard: () => void;
  onPickProject: () => void | Promise<void>;
  onClearProject: () => void | Promise<void>;
  onOpenCollaborationPage: () => void;
  edition?: string;
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
  onClose,
  onOpenNewAssistant,
  onOpenEditAssistant,
  onRemoveAssistant,
  onApplyRetrievalMode,
  onOpenApiWizard,
  onPickProject,
  onClearProject,
  onOpenCollaborationPage,
  edition,
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
        <p className="lm-meta lm-settings-lead">{settingsLeadCopy(edition)}</p>

        {config && shouldShowSettingsSection(edition, "onboarding") ? (
          <LawmindSettingsOnboarding
            health={health}
            projectDir={projectDir}
            compact={edition === "solo"}
          />
        ) : null}

        {config && shouldShowSettingsSection(edition, "collaboration") ? (
          <LawmindSettingsCollaborationBrief
            collabSummarySettings={collabSummarySettings}
            onOpenCollaborationPage={() => {
              onClose();
              onOpenCollaborationPage();
            }}
          />
        ) : null}

        {shouldShowSettingsSection(edition, "assistants") ? (
          <LawmindSettingsAssistants
            assistants={assistants}
            selectedAssistantId={selectedAssistantId}
            onSelectAssistantId={onSelectAssistantId}
            selectedAssistant={selectedAssistant}
            selectedAssistantStats={selectedAssistantStats}
            onOpenNew={onOpenNewAssistant}
            onOpenEdit={onOpenEditAssistant}
            onRemove={() => void onRemoveAssistant()}
            edition={edition}
          />
        ) : null}

        {config && shouldShowSettingsSection(edition, "model") ? (
          <LawmindSettingsModelRetrieval
            config={{
              workspaceDir: config.workspaceDir,
              projectDir: config.projectDir,
              retrievalMode: config.retrievalMode,
            }}
            health={health}
            retrievalLabel={retrievalLabel}
            retrievalSaving={retrievalSaving}
            applyRetrievalMode={onApplyRetrievalMode}
            onOpenApiWizard={onOpenApiWizard}
          />
        ) : null}

        {config && shouldShowSettingsSection(edition, "workspace") ? (
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
        ) : null}
        {config && shouldShowSettingsSection(edition, "roles") ? (
          <LawmindSettingsRoles apiBase={config.apiBase} />
        ) : null}
        {config && shouldShowSettingsSection(edition, "templates") ? (
          <LawmindSettingsTemplates apiBase={config.apiBase} />
        ) : null}
        {config && shouldShowSettingsSection(edition, "edition") ? (
          <LawmindSettingsEdition apiBase={config.apiBase} />
        ) : null}
        {shouldShowSettingsSection(edition, "update") ? <LawmindSettingsAppUpdate config={config} /> : null}
        {shouldShowSettingsSection(edition, "disclaimer") ? <LawmindSettingsDisclaimer /> : null}
      </div>
    </div>
  );
}
