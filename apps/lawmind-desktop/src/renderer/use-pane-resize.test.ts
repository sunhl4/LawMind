import { describe, expect, it } from "vitest";
import { nextBottomPaneHeightPx } from "./use-pane-resize";

describe("nextBottomPaneHeightPx", () => {
  it("grows the compose pane when the handle is dragged up", () => {
    expect(nextBottomPaneHeightPx(160, 400, 360)).toBe(200);
  });

  it("shrinks the compose pane when the handle is dragged down", () => {
    expect(nextBottomPaneHeightPx(160, 400, 440)).toBe(120);
  });
});
