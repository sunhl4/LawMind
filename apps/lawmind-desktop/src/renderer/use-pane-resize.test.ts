import { describe, expect, it } from "vitest";
import { nextBottomPaneHeightPx, nextPaneWidthPx } from "./use-pane-resize";

describe("nextBottomPaneHeightPx", () => {
  it("grows the compose pane when the handle is dragged up", () => {
    expect(nextBottomPaneHeightPx(160, 400, 360)).toBe(200);
  });

  it("shrinks the compose pane when the handle is dragged down", () => {
    expect(nextBottomPaneHeightPx(160, 400, 440)).toBe(120);
  });
});

describe("nextPaneWidthPx", () => {
  it("grows a leading pane when the handle is dragged right", () => {
    expect(nextPaneWidthPx(348, 200, 260, "leading")).toBe(408);
  });

  it("shrinks a trailing pane when the handle is dragged right so the sash follows the pointer", () => {
    expect(nextPaneWidthPx(380, 200, 260, "trailing")).toBe(320);
  });

  it("grows a trailing pane when the handle is dragged left", () => {
    expect(nextPaneWidthPx(380, 200, 140, "trailing")).toBe(440);
  });
});
