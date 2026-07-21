/**
 * 审核台文档正文编辑区 — 类似 Cursor 文档栏的可编辑面板。
 */

import { useCallback, useEffect, useId } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { LawmindSourcePillList } from "./LawmindSourcePreview";
import type { DraftDocumentEditorSection, DraftDocumentEditorValue } from "./lawmind-draft-document-editor";

type Props = {
  taskId: string;
  apiBase: string;
  value: DraftDocumentEditorValue;
  onChange: (value: DraftDocumentEditorValue) => void;
  editable: boolean;
  dirty?: boolean;
  saving?: boolean;
  saveError?: string | null;
  onSave?: () => void;
  onRevert?: () => void;
  reviewStatus?: ArtifactDraft["reviewStatus"];
};

function updateSection(
  value: DraftDocumentEditorValue,
  index: number,
  patch: Partial<DraftDocumentEditorSection>,
): DraftDocumentEditorValue {
  const sections = value.sections.map((section, i) => (i === index ? { ...section, ...patch } : section));
  return { ...value, sections };
}

export function LawmindDraftDocumentEditor(props: Props) {
  const {
    taskId,
    apiBase,
    value,
    onChange,
    editable,
    dirty = false,
    saving = false,
    saveError = null,
    onSave,
    onRevert,
    reviewStatus,
  } = props;
  const summaryId = useId();

  const handleSaveShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (!editable || !onSave || saving) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave();
      }
    },
    [editable, onSave, saving],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleSaveShortcut);
    return () => document.removeEventListener("keydown", handleSaveShortcut);
  }, [handleSaveShortcut]);

  const addSection = () => {
    onChange({
      ...value,
      sections: [...value.sections, { heading: "新章节", body: "" }],
    });
  };

  const removeSection = (index: number) => {
    if (value.sections.length <= 1) {
      return;
    }
    onChange({
      ...value,
      sections: value.sections.filter((_, i) => i !== index),
    });
  };

  const statusLabel = !editable ? "只读" : dirty ? "未保存" : "已保存";
  const statusTitle = !editable
    ? "签批完成后需先恢复待审核才可编辑"
    : dirty
      ? "有未保存修改，⌘/Ctrl+S 保存"
      : "已与服务器同步";

  return (
    <section className="lm-draft-doc-editor" aria-label="文档编辑">
      <header className="lm-draft-doc-editor-header">
        <div className="lm-draft-doc-editor-header-main">
          <span className="lm-draft-doc-editor-kicker">编辑</span>
          <span
            className="lm-draft-doc-editor-status"
            data-tone={!editable ? "muted" : dirty ? "warn" : "ok"}
            role="status"
            aria-live="polite"
            title={statusTitle}
          >
            {statusLabel}
          </span>
        </div>
        <div className="lm-draft-doc-editor-actions">
          {editable && onRevert ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-small"
              disabled={!dirty || saving}
              onClick={onRevert}
              title="还原为上次保存"
            >
              还原
            </button>
          ) : null}
          {editable && onSave ? (
            <button
              type="button"
              className="lm-btn lm-btn-accent lm-btn-small"
              disabled={!dirty || saving}
              onClick={onSave}
              title="⌘/Ctrl+S"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          ) : null}
        </div>
      </header>

      {saveError ? (
        <div className="lm-callout lm-callout-danger lm-draft-doc-editor-error" role="alert">
          <p className="lm-callout-body">{saveError}</p>
        </div>
      ) : null}

      <div className="lm-draft-doc-editor-body">
        <label className="lm-draft-doc-field lm-draft-doc-field-title">
          <span className="lm-sr-only">文书标题</span>
          {editable ? (
            <input
              type="text"
              value={value.title}
              onChange={(e) => onChange({ ...value, title: e.target.value })}
              disabled={saving}
              placeholder="文书标题"
              spellCheck
            />
          ) : (
            <div className="lm-draft-doc-readonly">{value.title || "（无标题）"}</div>
          )}
        </label>

        <label className="lm-draft-doc-field lm-draft-doc-field-summary">
          <span className="lm-sr-only" id={summaryId}>
            执行摘要
          </span>
          {editable ? (
            <textarea
              aria-labelledby={summaryId}
              value={value.summary}
              onChange={(e) => onChange({ ...value, summary: e.target.value })}
              rows={3}
              disabled={saving}
              placeholder="执行摘要（可选）"
              spellCheck
            />
          ) : value.summary?.trim() ? (
            <div className="lm-draft-doc-readonly">{value.summary}</div>
          ) : null}
        </label>

        <div className="lm-draft-doc-sections">
          {value.sections.map((section, index) => {
            const citations = (section.citations ?? []).filter(Boolean);
            const sectionKey = `${index}-${section.heading.slice(0, 24)}`;
            return (
              <article key={sectionKey} className="lm-draft-doc-section">
                <div className="lm-draft-doc-section-head">
                  <label className="lm-draft-doc-field lm-draft-doc-field-heading">
                    <span className="lm-sr-only">章节标题</span>
                    {editable ? (
                      <input
                        type="text"
                        value={section.heading}
                        onChange={(e) => onChange(updateSection(value, index, { heading: e.target.value }))}
                        disabled={saving}
                        placeholder={`第 ${index + 1} 节标题`}
                        spellCheck
                      />
                    ) : (
                      <div className="lm-draft-doc-readonly lm-draft-doc-section-title">{section.heading}</div>
                    )}
                  </label>
                  {editable && value.sections.length > 1 ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-ghost lm-btn-small lm-draft-doc-remove-section"
                      disabled={saving}
                      onClick={() => removeSection(index)}
                      aria-label={`删除第 ${index + 1} 节`}
                      title="删除本节"
                    >
                      删除
                    </button>
                  ) : null}
                </div>

                <label className="lm-draft-doc-field lm-draft-doc-field-body">
                  <span className="lm-sr-only">正文</span>
                  {editable ? (
                    <textarea
                      className="lm-draft-doc-body-input"
                      value={section.body}
                      onChange={(e) => onChange(updateSection(value, index, { body: e.target.value }))}
                      rows={14}
                      disabled={saving}
                      placeholder="在此撰写正文…"
                      spellCheck
                    />
                  ) : (
                    <div className="lm-draft-doc-readonly lm-draft-doc-body-readonly">{section.body}</div>
                  )}
                </label>

                {citations.length > 0 ? (
                  <div className="lm-draft-section-cites lm-draft-section-cites-legal">
                    <LawmindSourcePillList apiBase={apiBase} taskId={taskId} sourceIds={citations} />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

        {editable ? (
          <div className="lm-draft-doc-editor-foot">
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-small"
              disabled={saving}
              onClick={addSection}
              title={
                reviewStatus === "modified"
                  ? "也可在侧栏标「需修改」交给助手改稿"
                  : undefined
              }
            >
              添加章节
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
