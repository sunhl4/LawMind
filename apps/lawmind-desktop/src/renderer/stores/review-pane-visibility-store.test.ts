import { describe, expect, it, beforeEach } from "vitest";
import {
  resetReviewPaneVisibilityStoreForTest,
  useReviewPaneVisibilityStore,
} from "./review-pane-visibility-store";

describe("review-pane-visibility-store", () => {
  beforeEach(() => {
    resetReviewPaneVisibilityStoreForTest();
  });

  it("toggles a pane and writes back", () => {
    useReviewPaneVisibilityStore.getState().togglePane("meta");
    expect(useReviewPaneVisibilityStore.getState().visibility.meta).toBe(true);
  });

  it("refuses to hide the last visible pane", () => {
    useReviewPaneVisibilityStore.setState({ visibility: { meta: false, editor: true, preview: false } });
    useReviewPaneVisibilityStore.getState().togglePane("editor");
    expect(useReviewPaneVisibilityStore.getState().visibility.editor).toBe(true);
  });

  it("setVisibility replaces the whole map", () => {
    useReviewPaneVisibilityStore.getState().setVisibility({ meta: true, editor: true, preview: true });
    expect(useReviewPaneVisibilityStore.getState().visibility).toEqual({
      meta: true,
      editor: true,
      preview: true,
    });
  });
});
