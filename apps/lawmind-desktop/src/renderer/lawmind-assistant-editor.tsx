import type { AssistantRow } from "./lawmind-settings-models.ts";
import type { PresetRow } from "./lawmind-app-data";
import { apiSendJson } from "./api-client";

export type AssistantEditorDraft = {
  displayName: string;
  introduction: string;
  presetKey: string;
  customRoleTitle: string;
  customRoleInstructions: string;
};

const DEFAULT_PRESET_KEY = "general_default";

function emptyDraft(presets: PresetRow[]): AssistantEditorDraft {
  return {
    displayName: "新助手",
    introduction: "",
    presetKey: presets[0]?.id ?? DEFAULT_PRESET_KEY,
    customRoleTitle: "",
    customRoleInstructions: "",
  };
}

export function createAssistantDraft(
  mode: "create" | "edit",
  presets: PresetRow[],
  assistant?: AssistantRow,
): AssistantEditorDraft {
  if (mode === "edit" && assistant) {
    return {
      displayName: assistant.displayName,
      introduction: assistant.introduction,
      presetKey: assistant.presetKey ?? DEFAULT_PRESET_KEY,
      customRoleTitle: assistant.customRoleTitle ?? "",
      customRoleInstructions: assistant.customRoleInstructions ?? "",
    };
  }
  return emptyDraft(presets);
}

export async function saveAssistantDraft(args: {
  apiBase: string;
  editingAssistantId: string | null;
  draft: AssistantEditorDraft;
}): Promise<{ assistant?: AssistantRow }> {
  const { apiBase, editingAssistantId, draft } = args;
  const path =
    editingAssistantId === null
      ? "/api/assistants"
      : `/api/assistants/${encodeURIComponent(editingAssistantId)}`;
  const method = editingAssistantId === null ? "POST" : "PATCH";
  return apiSendJson<
    { ok?: boolean; error?: string; assistant?: AssistantRow },
    {
      displayName: string;
      introduction: string;
      presetKey?: string;
      customRoleTitle?: string;
      customRoleInstructions?: string;
    }
  >(apiBase, path, method, {
    displayName: draft.displayName.trim(),
    introduction: draft.introduction.trim(),
    presetKey: draft.presetKey.trim() || undefined,
    customRoleTitle: draft.customRoleTitle.trim() || undefined,
    customRoleInstructions: draft.customRoleInstructions.trim() || undefined,
  });
}

export async function deleteAssistant(apiBase: string, assistantId: string): Promise<void> {
  const response = await apiSendJson<{ ok?: boolean }, undefined>(
    apiBase,
    `/api/assistants/${encodeURIComponent(assistantId)}`,
    "DELETE",
  );
  if (!response.ok) {
    throw new Error("delete failed");
  }
}

type Props = {
  open: boolean;
  editingAssistantId: string | null;
  draft: AssistantEditorDraft;
  presets: PresetRow[];
  busy: boolean;
  error: string | null;
  onChange: (draft: AssistantEditorDraft) => void;
  onClose: () => void;
  onSave: () => void | Promise<void>;
};

export function LawmindAssistantEditorDialog({
  open,
  editingAssistantId,
  draft,
  presets,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: Props) {
  if (!open) {
    return null;
  }

  const presetOptions =
    presets.length > 0 ? presets : [{ id: DEFAULT_PRESET_KEY, displayName: "通用法律助理" }];

  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="助手编辑">
      <div className="lm-wizard">
        <h2>{editingAssistantId === null ? "新建助手" : "编辑助手"}</h2>
        <p className="lm-meta">设置名称、简介与岗位；岗位可套用内置预设并补充说明。</p>
        <label className="lm-field">
          <span>显示名称</span>
          <input
            type="text"
            value={draft.displayName}
            onChange={(e) => onChange({ ...draft, displayName: e.target.value })}
          />
        </label>
        <label className="lm-field">
          <span>简介</span>
          <textarea
            rows={3}
            value={draft.introduction}
            onChange={(e) => onChange({ ...draft, introduction: e.target.value })}
            placeholder="助手自我介绍，会写入系统提示"
          />
        </label>
        <label className="lm-field">
          <span>岗位预设</span>
          <select
            value={draft.presetKey}
            onChange={(e) => onChange({ ...draft, presetKey: e.target.value })}
          >
            {presetOptions.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="lm-field">
          <span>自定义岗位标题（可选）</span>
          <input
            type="text"
            value={draft.customRoleTitle}
            onChange={(e) => onChange({ ...draft, customRoleTitle: e.target.value })}
            placeholder="覆盖预设展示名"
          />
        </label>
        <label className="lm-field">
          <span>岗位补充说明（可选）</span>
          <textarea
            rows={4}
            value={draft.customRoleInstructions}
            onChange={(e) => onChange({ ...draft, customRoleInstructions: e.target.value })}
            placeholder="工作方式、输出风格等"
          />
        </label>
        {error && <div className="lm-error">{error}</div>}
        <div className="lm-wizard-actions">
          <button type="button" className="lm-btn lm-btn-secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="lm-btn"
            disabled={busy || !draft.displayName.trim()}
            onClick={() => void onSave()}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
