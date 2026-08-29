import { readStoredBool, writeStoredBool } from "./lawmind-panel-layout";

export type ReviewPaneId = "meta" | "editor" | "preview";

export type ReviewPaneVisibility = Record<ReviewPaneId, boolean>;

export const REVIEW_PANE_IDS: ReviewPaneId[] = ["meta", "editor", "preview"];

const STORAGE_KEYS: Record<ReviewPaneId, string> = {
  meta: "lawmind.ui.reviewPaneMeta",
  editor: "lawmind.ui.reviewPaneEditor",
  preview: "lawmind.ui.reviewPanePreview",
};

export function readReviewPaneVisibility(): ReviewPaneVisibility {
  return {
    meta: readStoredBool(STORAGE_KEYS.meta, false),
    editor: readStoredBool(STORAGE_KEYS.editor, true),
    preview: readStoredBool(STORAGE_KEYS.preview, true),
  };
}

export function writeReviewPaneVisibility(visibility: ReviewPaneVisibility): void {
  for (const id of REVIEW_PANE_IDS) {
    writeStoredBool(STORAGE_KEYS[id], visibility[id]);
  }
}

export function countVisibleReviewPanes(visibility: ReviewPaneVisibility): number {
  return REVIEW_PANE_IDS.filter((id) => visibility[id]).length;
}

/** 最右侧仍显示的分栏；该列应 flex-grow 占满剩余宽度（类 Cursor）。 */
export function lastVisibleReviewPaneId(visibility: ReviewPaneVisibility): ReviewPaneId | null {
  let last: ReviewPaneId | null = null;
  for (const id of REVIEW_PANE_IDS) {
    if (visibility[id]) {
      last = id;
    }
  }
  return last;
}

export function hasVisibleReviewPaneAfter(
  id: ReviewPaneId,
  visibility: ReviewPaneVisibility,
  hasDetail: boolean,
): boolean {
  if (!hasDetail) {
    return false;
  }
  const idx = REVIEW_PANE_IDS.indexOf(id);
  for (let i = idx + 1; i < REVIEW_PANE_IDS.length; i++) {
    const nextId = REVIEW_PANE_IDS[i];
    if (visibility[nextId]) {
      return true;
    }
  }
  return false;
}
