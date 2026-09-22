import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import { LawmindDraftDocumentEditor } from "../LawmindDraftDocumentEditor";
import { LawmindDraftDocumentPreview } from "../LawmindDraftDocumentPreview";
import {
  isDraftDocumentEditable,
  type DraftDocumentEditorValue,
} from "../lawmind-draft-document-editor";
import { reviewStatusDisplayLabel } from "../lawmind-review-display";
import type { ReviewPaneId, ReviewPaneVisibility } from "../lawmind-review-pane-prefs";
import {
  hasVisibleReviewPaneAfter,
  lastVisibleReviewPaneId,
} from "../lawmind-review-pane-prefs";

export type ReviewWorkbenchDocumentColumnProps = {
  apiBase: string;
  detail: ArtifactDraft;
  editorValue: DraftDocumentEditorValue;
  savedEditorValue: DraftDocumentEditorValue | null;
  editorDirty: boolean;
  editorSaving: boolean;
  editorSaveError: string | null;
  onEditorChange: (value: DraftDocumentEditorValue) => void;
  onEditorSave: () => void;
  onEditorRevert: () => void;
  lastExportPath: string | null;
  paneVisibility: ReviewPaneVisibility;
  reviewMetaWidth: number;
  reviewEditorWidth: number;
  onReviewEditorResize: (e: ReactPointerEvent) => void;
  hasDetailPane: boolean;
  templateOptions?: Array<{ id: string; label: string; kind: "built-in" | "uploaded" }>;
  renderTemplateId?: string;
  onRenderTemplateIdChange?: (id: string) => void;
  actionBusy?: boolean;
  onExportWord?: () => void;
  onOpenAgentsDesk?: () => void;
  exportReady?: boolean;
  includeProvenance?: boolean;
  onIncludeProvenanceChange?: (checked: boolean) => void;
};

function reviewPaneLayoutStyle(
  id: ReviewPaneId,
  growReviewPaneId: ReviewPaneId | null,
  reviewMetaWidth: number,
  reviewEditorWidth: number,
): CSSProperties {
  if (growReviewPaneId === id) {
    return { flex: "1 1 0", minWidth: 0, minHeight: 0, width: "100%", maxWidth: "none" };
  }
  const widthPx = id === "meta" ? reviewMetaWidth : reviewEditorWidth;
  return { flex: `0 0 ${widthPx}px`, width: widthPx, minWidth: 0, minHeight: 0 };
}

function reviewPaneClassName(base: string, id: ReviewPaneId, growReviewPaneId: ReviewPaneId | null): string {
  return growReviewPaneId === id ? `${base} lm-review-pane-grow` : base;
}

function renderReviewSplit(
  afterPane: ReviewPaneId,
  paneVisibility: ReviewPaneVisibility,
  hasDetailPane: boolean,
  onResize: (e: ReactPointerEvent) => void,
  label: string,
) {
  if (!hasVisibleReviewPaneAfter(afterPane, paneVisibility, hasDetailPane)) {
    return null;
  }
  return (
    <div
      className="lm-split-handle lm-split-handle-vertical"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onPointerDown={onResize}
    />
  );
}

export function ReviewWorkbenchDocumentColumn(props: ReviewWorkbenchDocumentColumnProps) {
  const {
    apiBase,
    detail,
    editorValue,
    savedEditorValue,
    editorDirty,
    editorSaving,
    editorSaveError,
    onEditorChange,
    onEditorSave,
    onEditorRevert,
    lastExportPath,
    paneVisibility,
    reviewMetaWidth,
    reviewEditorWidth,
    onReviewEditorResize,
    hasDetailPane,
    templateOptions = [],
    renderTemplateId = "",
    onRenderTemplateIdChange,
    actionBusy = false,
    onExportWord,
    onOpenAgentsDesk,
    exportReady = false,
    includeProvenance = false,
    onIncludeProvenanceChange,
  } = props;

  const growReviewPaneId = lastVisibleReviewPaneId(paneVisibility);
  const showWritingChrome =
    Boolean(onRenderTemplateIdChange) || Boolean(onExportWord) || Boolean(onOpenAgentsDesk);

  return (
    <div className="lm-review-compose-main">
      <div className="lm-review-compose-panes">
        {paneVisibility.editor ? (
          <div
            className={reviewPaneClassName("lm-review-editor-pane", "editor", growReviewPaneId)}
            style={reviewPaneLayoutStyle("editor", growReviewPaneId, reviewMetaWidth, reviewEditorWidth)}
          >
            <LawmindDraftDocumentEditor
              taskId={detail.taskId}
              apiBase={apiBase}
              value={editorValue}
              onChange={onEditorChange}
              editable={isDraftDocumentEditable(detail.reviewStatus)}
              dirty={editorDirty}
              saving={editorSaving}
              saveError={editorSaveError}
              onSave={onEditorSave}
              onRevert={() => {
                if (savedEditorValue) {
                  onEditorRevert();
                }
              }}
              reviewStatus={detail.reviewStatus}
            />
          </div>
        ) : null}

        {paneVisibility.editor
          ? renderReviewSplit("editor", paneVisibility, hasDetailPane, onReviewEditorResize, "调整文档编辑区宽度")
          : null}

        {paneVisibility.preview ? (
          <div
            className={reviewPaneClassName("lm-review-preview-pane", "preview", growReviewPaneId)}
            style={reviewPaneLayoutStyle("preview", growReviewPaneId, reviewMetaWidth, reviewEditorWidth)}
          >
            {templateOptions.length > 0 && onRenderTemplateIdChange ? (
              <div className="lm-review-preview-template-bar">
                <label className="lm-review-template-pick lm-review-template-pick-inline">
                  <span>交付模板</span>
                  <select
                    value={renderTemplateId}
                    onChange={(e) => onRenderTemplateIdChange(e.target.value)}
                    disabled={actionBusy}
                    aria-label="选择交付模板"
                  >
                    {templateOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                        {o.kind === "uploaded" ? "（上传）" : "（内置）"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            <LawmindDraftDocumentPreview
              taskId={detail.taskId}
              apiBase={apiBase}
              value={editorValue}
              outputPath={lastExportPath ?? detail.outputPath ?? null}
              reviewStatusLabel={
                editorDirty ? "预览（含未保存修改）" : reviewStatusDisplayLabel(detail.reviewStatus)
              }
            />
          </div>
        ) : null}
      </div>

      {showWritingChrome ? (
        <footer className="lm-review-writing-dock" aria-label="撰写操作">
          <div className="lm-review-writing-dock-status" role="status">
            {editorSaving
              ? "保存中…"
              : editorSaveError
                ? editorSaveError
                : editorDirty
                  ? "有未保存修改"
                  : "已保存"}
            {" · "}
            {reviewStatusDisplayLabel(detail.reviewStatus)}
          </div>
          {onIncludeProvenanceChange ? (
            <label className="lm-review-writing-dock-option" title="导出时把每段来源作为 Word 批注">
              <input
                type="checkbox"
                checked={includeProvenance}
                onChange={(e) => onIncludeProvenanceChange(e.target.checked)}
                disabled={actionBusy}
              />
              <span>导出来源批注</span>
            </label>
          ) : null}
          <div className="lm-review-writing-dock-actions">
            {editorDirty ? (
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-small"
                disabled={editorSaving || !isDraftDocumentEditable(detail.reviewStatus)}
                onClick={onEditorSave}
              >
                {editorSaving ? "保存中…" : "保存"}
              </button>
            ) : null}
            {onExportWord && exportReady ? (
              <button
                type="button"
                className="lm-btn lm-btn-accent lm-btn-small"
                disabled={actionBusy}
                title="按当前模板导出 Word"
                onClick={onExportWord}
              >
                {actionBusy ? "导出中…" : "导出 Word"}
              </button>
            ) : null}
          </div>
        </footer>
      ) : null}
    </div>
  );
}
