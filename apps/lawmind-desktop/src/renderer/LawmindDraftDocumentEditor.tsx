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

  return (
    <section className="lm-draft-doc-editor" aria-label="文档正文">
      <header className="lm-draft-doc-editor-header">
        <div className="lm-draft-doc-editor-header-main">
          <span className="lm-draft-doc-editor-kicker">文档正文</span>
          <span className="lm-draft-doc-editor-status" role="status" aria-live="polite">
            {!editable
              ? "只读（签批完成后需先恢复待审核才可编辑）"
              : dirty
                ? "未保存的修改"
                : "已保存"}
          </span>
        </div>
        <div className="lm-draft-doc-editor-actions">
          {editable && onRevert ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-small"
              disabled={!dirty || saving}
              onClick={onRevert}
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
            >
              {saving ? "保存中…" : "保存正文"}
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
          <span className="lm-draft-doc-field-label">文书标题</span>
          {editable ? (
            <input
              type="text"
              value={value.title}
              onChange={(e) => onChange({ ...value, title: e.target.value })}
              disabled={saving}
              spellCheck
            />
          ) : (
            <div className="lm-draft-doc-readonly">{value.title}</div>
          )}
        </label>

        <label className="lm-draft-doc-field lm-draft-doc-field-summary">
          <span className="lm-draft-doc-field-label" id={summaryId}>
            执行摘要
          </span>
          {editable ? (
            <textarea
              aria-labelledby={summaryId}
              value={value.summary}
              onChange={(e) => onChange({ ...value, summary: e.target.value })}
              rows={4}
              disabled={saving}
              spellCheck
            />
          ) : (
            <div className="lm-draft-doc-readonly">{value.summary || "—"}</div>
          )}
        </label>

        <div className="lm-draft-doc-sections">
          {value.sections.map((section, index) => {
            const citations = (section.citations ?? []).filter(Boolean);
            const sectionKey = `${index}-${section.heading.slice(0, 24)}`;
            return (
              <article key={sectionKey} className="lm-draft-doc-section">
                <div className="lm-draft-doc-section-head">
                  <label className="lm-draft-doc-field lm-draft-doc-field-heading">
                    <span className="lm-draft-doc-field-label">章节标题</span>
                    {editable ? (
                      <input
                        type="text"
                        value={section.heading}
                        onChange={(e) => onChange(updateSection(value, index, { heading: e.target.value }))}
                        disabled={saving}
                        spellCheck
                      />
                    ) : (
                      <div className="lm-draft-doc-readonly lm-draft-doc-section-title">{section.heading}</div>
                    )}
                  </label>
                  {editable && value.sections.length > 1 ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-secondary lm-btn-small lm-draft-doc-remove-section"
                      disabled={saving}
                      onClick={() => removeSection(index)}
                    >
                      删除章节
                    </button>
                  ) : null}
                </div>

                <label className="lm-draft-doc-field lm-draft-doc-field-body">
                  <span className="lm-draft-doc-field-label">正文</span>
                  {editable ? (
                    <textarea
                      className="lm-draft-doc-body-input"
                      value={section.body}
                      onChange={(e) => onChange(updateSection(value, index, { body: e.target.value }))}
                      rows={16}
                      disabled={saving}
                      spellCheck
                    />
                  ) : (
                    <div className="lm-draft-doc-readonly lm-draft-doc-body-readonly">{section.body}</div>
                  )}
                </label>

                {citations.length > 0 ? (
                  <div className="lm-draft-section-cites">
                    <span className="lm-meta">引用：</span>
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
            >
              添加章节
            </button>
            <span className="lm-meta">
              {reviewStatus === "modified"
                ? "可直接改正文后保存，或签批「需修改」交给助手后台修订。"
                : "支持 ⌘/Ctrl+S 保存；保存后验收门禁会重新计算。"}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
