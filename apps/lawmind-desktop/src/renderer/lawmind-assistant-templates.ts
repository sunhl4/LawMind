import type { PresetRow } from "./lawmind-app-data";
import type { AssistantEditorDraft } from "./lawmind-assistant-editor";

const DEFAULT_PRESET_KEY = "general_default";

/** Presets shown as quick-create cards (order matters for UI). */
export const QUICK_ASSISTANT_PRESET_IDS = [
  "general_default",
  "contract_review",
  "general_litigation",
  "compliance_research",
  "client_memo",
  "due_diligence",
] as const;

export function presetSummary(presets: PresetRow[], presetKey: string): string {
  const row = presets.find((p) => p.id === presetKey);
  if (!row) {
    return "通用法律助理";
  }
  const firstLine = row.promptSection.split("\n").find((l) => l.trim())?.trim() ?? "";
  return firstLine.replace(/^\*+|\*+$/g, "").slice(0, 80);
}

export function buildQuickCreateDraft(
  presets: PresetRow[],
  presetKey: string,
  displayName: string,
): AssistantEditorDraft {
  const preset = presets.find((p) => p.id === presetKey);
  const title = preset?.displayName ?? "法律助理";
  return {
    displayName: displayName.trim() || title,
    introduction: "",
    presetKey: presetKey || DEFAULT_PRESET_KEY,
    customRoleTitle: title,
    customRoleInstructions: "",
    orgRole: "",
    reportsToAssistantId: "",
    peerReviewDefaultAssistantId: "",
  };
}
