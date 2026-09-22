import { describe, expect, it } from "vitest";
import {
  countVisibleReviewPanes,
  hasVisibleReviewPaneAfter,
  lastVisibleReviewPaneId,
  readReviewPaneVisibility,
} from "./lawmind-review-pane-prefs";

describe("lawmind-review-pane-prefs", () => {
  it("defaults editor and preview visible; meta hidden until toggled", () => {
    const v = readReviewPaneVisibility();
    expect(v.meta).toBe(false);
    expect(v.editor && v.preview).toBe(true);
    expect(countVisibleReviewPanes(v)).toBe(2);
  });

  it("detects visible pane after meta when detail is active", () => {
    const v = { meta: true, editor: false, preview: true };
    expect(hasVisibleReviewPaneAfter("meta", v, true)).toBe(true);
    expect(hasVisibleReviewPaneAfter("editor", v, true)).toBe(true);
    expect(hasVisibleReviewPaneAfter("preview", v, true)).toBe(false);
  });

  it("returns false when no draft is selected", () => {
    const v = { meta: true, editor: true, preview: true };
    expect(hasVisibleReviewPaneAfter("meta", v, false)).toBe(false);
  });

  it("picks rightmost visible pane for flex grow", () => {
    expect(lastVisibleReviewPaneId({ meta: true, editor: true, preview: true })).toBe("preview");
    expect(lastVisibleReviewPaneId({ meta: true, editor: false, preview: true })).toBe("preview");
    expect(lastVisibleReviewPaneId({ meta: true, editor: true, preview: false })).toBe("editor");
    expect(lastVisibleReviewPaneId({ meta: true, editor: false, preview: false })).toBe("meta");
  });
});
