import { describe, expect, it } from "vitest";
import {
  paneInitialDeskMatterFocus,
  paneInitialMatterCockpitOpen,
} from "./pane-window-state";

describe("pane-window-state", () => {
  it("opens the matter desk only when the route is explicitly/resumably a matter", () => {
    expect(
      paneInitialMatterCockpitOpen({
        kind: "workspace-pane",
        pane: "middle",
        matterId: "m-1",
      }),
    ).toBe(true);
    expect(
      paneInitialMatterCockpitOpen({
        kind: "workspace-pane",
        pane: "middle",
        matterId: "m-1",
        middleView: "matter",
      }),
    ).toBe(true);
    expect(
      paneInitialMatterCockpitOpen({
        kind: "workspace-pane",
        pane: "middle",
        matterId: "m-1",
        middleView: "file",
        relPath: "a.docx",
      }),
    ).toBe(false);
    expect(
      paneInitialMatterCockpitOpen({
        kind: "workspace-pane",
        pane: "middle",
        matterId: "m-1",
        draftTaskId: "d-1",
      }),
    ).toBe(false);
    expect(
      paneInitialMatterCockpitOpen({ kind: "workspace-pane", pane: "chat", matterId: "m-1" }),
    ).toBe(false);
    expect(paneInitialMatterCockpitOpen(undefined)).toBe(false);
  });

  it("focuses the dragged matter exactly once", () => {
    expect(
      paneInitialDeskMatterFocus({
        kind: "workspace-pane",
        pane: "middle",
        matterId: " m-1 ",
      }),
    ).toEqual({ id: "m-1", n: 1 });
    expect(
      paneInitialDeskMatterFocus({
        kind: "workspace-pane",
        pane: "middle",
        middleView: "file",
        relPath: "a.docx",
      }),
    ).toBeNull();
    expect(paneInitialDeskMatterFocus(undefined)).toBeNull();
  });
});
