import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AssistantOrgRole, AssistantRow } from "./lawmind-settings-models.ts";
import type { PresetRow } from "./lawmind-app-data";
import { apiSendJson } from "./api-client";
import type { AssistantUpsertRequest } from "./lawmind-api-request-types.ts";
import { apiPatchAssistant, apiPost } from "./lawmind-api-routes.ts";
import {
  buildQuickCreateDraft,
  presetSummary,
  QUICK_ASSISTANT_PRESET_IDS,
} from "./lawmind-assistant-templates";

export type AssistantEditorDraft = {
  displayName: string;
  introduction: string;
  presetKey: string;
  customRoleTitle: string;
  customRoleInstructions: string;
  orgRole: AssistantOrgRole | "";
  reportsToAssistantId: string;
  peerReviewDefaultAssistantId: string;
};

const DEFAULT_PRESET_KEY = "general_default";

function emptyDraft(presets: PresetRow[]): AssistantEditorDraft {
  return {
    displayName: "新智能体",
    introduction: "",
    presetKey: presets[0]?.id ?? DEFAULT_PRESET_KEY,
    customRoleTitle: "",
    customRoleInstructions: "",
    orgRole: "",
    reportsToAssistantId: "",
    peerReviewDefaultAssistantId: "",
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
      orgRole: assistant.orgRole ?? "",
      reportsToAssistantId: assistant.reportsToAssistantId ?? "",
      peerReviewDefaultAssistantId: assistant.peerReviewDefaultAssistantId ?? "",
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
  const body: AssistantUpsertRequest = {
    displayName: draft.displayName.trim(),
    introduction: draft.introduction.trim(),
    presetKey: draft.presetKey.trim() || undefined,
    customRoleTitle: draft.customRoleTitle.trim() || undefined,
    customRoleInstructions: draft.customRoleInstructions.trim() || undefined,
    orgRole: draft.orgRole || undefined,
    reportsToAssistantId: draft.reportsToAssistantId.trim() || undefined,
    peerReviewDefaultAssistantId: draft.peerReviewDefaultAssistantId.trim() || undefined,
  };
  if (editingAssistantId === null) {
    return apiPost(apiBase, "/api/assistants", body) as Promise<{
      ok?: boolean;
      error?: string;
      assistant?: AssistantRow;
    }>;
  }
  return apiPatchAssistant(apiBase, editingAssistantId, body) as Promise<{
    ok?: boolean;
    error?: string;
    assistant?: AssistantRow;
  }>;
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

function AssistantAdvancedFields(props: {
  draft: AssistantEditorDraft;
  presetOptions: PresetRow[];
  assistantLinkOptions: Array<{ assistantId: string; displayName: string }>;
  onChange: (draft: AssistantEditorDraft) => void;
}): ReactNode {
  const { draft, presetOptions, assistantLinkOptions, onChange } = props;
  const showOrg = assistantLinkOptions.length > 0;
  return (
    <details className="lm-settings-advanced lm-assistant-advanced">
      <summary>高级：岗位细节</summary>
      <div className="lm-settings-advanced-body">
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
          />
        </label>
        <label className="lm-field">
          <span>岗位补充说明（可选）</span>
          <textarea
            rows={3}
            value={draft.customRoleInstructions}
            onChange={(e) => onChange({ ...draft, customRoleInstructions: e.target.value })}
          />
        </label>
        {showOrg ? (
          <details className="lm-settings-advanced lm-assistant-org-advanced">
            <summary>虚拟团队（可选）</summary>
            <div className="lm-settings-advanced-body">
              <p className="lm-field-hint">
                用于多智能体协作时的角色与互审关系；日常单助手对话可留空。
              </p>
              <label className="lm-field">
                <span>组织角色</span>
                <select
                  value={draft.orgRole}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      orgRole: e.target.value as AssistantEditorDraft["orgRole"],
                    })
                  }
                >
                  <option value="">未设置</option>
                  <option value="lead">主办 / 牵头</option>
                  <option value="member">协办</option>
                  <option value="intern">实习 / 辅助</option>
                </select>
              </label>
              <label className="lm-field">
                <span>汇报对象</span>
                <select
                  value={draft.reportsToAssistantId}
                  onChange={(e) => onChange({ ...draft, reportsToAssistantId: e.target.value })}
                >
                  <option value="">无</option>
                  {assistantLinkOptions.map((a) => (
                    <option key={a.assistantId} value={a.assistantId}>
                      {a.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="lm-field">
                <span>建议互审对象</span>
                <select
                  value={draft.peerReviewDefaultAssistantId}
                  onChange={(e) =>
                    onChange({ ...draft, peerReviewDefaultAssistantId: e.target.value })
                  }
                >
                  <option value="">无</option>
                  {assistantLinkOptions.map((a) => (
                    <option key={`peer-${a.assistantId}`} value={a.assistantId}>
                      {a.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
}

function AssistantQuickCreateWizard(props: {
  presets: PresetRow[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (draft: AssistantEditorDraft) => void | Promise<void>;
}): ReactNode {
  const { presets, busy, error, onClose, onSave } = props;
  const presetOptions =
    presets.length > 0
      ? presets
      : [{ id: DEFAULT_PRESET_KEY, displayName: "通用法律助理", promptSection: "" }];
  const quickPresets = useMemo(() => {
    const byId = new Map(presetOptions.map((p) => [p.id, p]));
    const ordered = QUICK_ASSISTANT_PRESET_IDS.map((id) => byId.get(id)).filter(Boolean) as PresetRow[];
    for (const p of presetOptions) {
      if (!ordered.some((o) => o.id === p.id)) {
        ordered.push(p);
      }
    }
    return ordered.slice(0, 6);
  }, [presetOptions]);

  const [step, setStep] = useState(1);
  const [presetKey, setPresetKey] = useState(quickPresets[0]?.id ?? DEFAULT_PRESET_KEY);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (step === 2 && !displayName.trim()) {
      const preset = presetOptions.find((p) => p.id === presetKey);
      setDisplayName(preset?.displayName ?? "新智能体");
    }
  }, [step, presetKey, displayName, presetOptions]);

  const selectedPreset = presetOptions.find((p) => p.id === presetKey);

  return (
    <div className="lm-wizard lm-assistant-quick-wizard">
      <h2>新建智能体</h2>
      <ol className="lm-assistant-wizard-steps" aria-label="新建步骤">
        <li className={step >= 1 ? "done" : ""}>① 选岗位模板</li>
        <li className={step >= 2 ? "done" : ""}>② 命名</li>
        <li className={step >= 3 ? "done" : ""}>③ 保存</li>
      </ol>
      {step === 1 ? (
        <div className="lm-assistant-template-grid" role="list">
          {quickPresets.map((p) => (
            <button
              key={p.id}
              type="button"
              role="listitem"
              className={`lm-assistant-template-card ${presetKey === p.id ? "active" : ""}`}
              onClick={() => setPresetKey(p.id)}
            >
              <span className="lm-assistant-template-title">{p.displayName}</span>
              <span className="lm-meta">{presetSummary(presetOptions, p.id)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {step === 2 ? (
        <>
          <p className="lm-meta">
            已选模板：<strong>{selectedPreset?.displayName ?? presetKey}</strong>
          </p>
          <label className="lm-field">
            <span>显示名称</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例如：并购合同审查专员"
            />
          </label>
        </>
      ) : null}
      {step === 3 ? (
        <div className="lm-callout lm-callout-muted" role="status">
          <p className="lm-callout-body">
            将创建「<strong>{displayName.trim() || selectedPreset?.displayName}</strong>」（
            {selectedPreset?.displayName ?? "通用法律助理"}）。保存后可在对话栏切换；组织关系请用「高级编辑」。
          </p>
        </div>
      ) : null}
      {error ? (
        <div className="lm-callout lm-callout-danger" role="alert">
          <p className="lm-callout-body">{error}</p>
        </div>
      ) : null}
      <div className="lm-wizard-actions">
        <button type="button" className="lm-btn lm-btn-secondary" onClick={onClose} disabled={busy}>
          取消
        </button>
        {step > 1 ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            disabled={busy}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            上一步
          </button>
        ) : null}
        {step < 3 ? (
          <button
            type="button"
            className="lm-btn"
            disabled={busy || (step === 2 && !displayName.trim())}
            onClick={() => setStep((s) => s + 1)}
          >
            下一步
          </button>
        ) : (
          <button
            type="button"
            className="lm-btn"
            disabled={busy || !displayName.trim()}
            onClick={() => void onSave(buildQuickCreateDraft(presetOptions, presetKey, displayName))}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        )}
      </div>
    </div>
  );
}

type Props = {
  open: boolean;
  editingAssistantId: string | null;
  draft: AssistantEditorDraft;
  presets: PresetRow[];
  /** 可选汇报 / 互审对象（不含当前正在编辑的智能体） */
  assistantLinkOptions: Array<{ assistantId: string; displayName: string }>;
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
  assistantLinkOptions,
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
    presets.length > 0
      ? presets
      : [{ id: DEFAULT_PRESET_KEY, displayName: "通用法律助理", promptSection: "" }];

  const handleQuickSave = async (quickDraft: AssistantEditorDraft) => {
    onChange(quickDraft);
    await onSave();
  };

  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="智能体编辑">
      {editingAssistantId === null ? (
        <AssistantQuickCreateWizard
          presets={presets}
          busy={busy}
          error={error}
          onClose={onClose}
          onSave={handleQuickSave}
        />
      ) : (
        <div className="lm-wizard">
          <h2>编辑智能体</h2>
          <p className="lm-wizard-lead lm-settings-hint">改名称与简介即可；组织关系在「高级」中配置。</p>
          <label className="lm-field">
            <span>显示名称</span>
            <input
              type="text"
              value={draft.displayName}
              onChange={(e) => onChange({ ...draft, displayName: e.target.value })}
            />
          </label>
          <label className="lm-field">
            <span>简介（可选）</span>
            <textarea
              rows={2}
              value={draft.introduction}
              onChange={(e) => onChange({ ...draft, introduction: e.target.value })}
            />
          </label>
          <AssistantAdvancedFields
            draft={draft}
            presetOptions={presetOptions}
            assistantLinkOptions={assistantLinkOptions}
            onChange={onChange}
          />
        {error ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{error}</p>
          </div>
        ) : null}
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
      )}
    </div>
  );
}
