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
  } = props;

  const growReviewPaneId = lastVisibleReviewPaneId(paneVisibility);

  return (
    <>
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

    </>
  );
}
