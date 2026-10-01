import { describe, expect, it } from "vitest";
import { deskMatterPaneSelector, matterHotPaneTarget } from "./desk-matter-focus";

describe("desk-matter-focus", () => {
  it("maps pane to dossier anchors", () => {
    expect(deskMatterPaneSelector("docs")).toBe('[data-testid="lm-matter-now"]');
    expect(deskMatterPaneSelector("volume")).toBe('[id="lm-matter-volume"]');
    expect(deskMatterPaneSelector("deadlines")).toBe('[id="lm-lawyer-pane-deadlines"]');
  });

  it("routes hot lines to the right pane", () => {
    expect(
      matterHotPaneTarget({
        overdueDeadline: true,
        outboundCount: 0,
        unreplied: false,
      }),
    ).toBe("deadlines");
    expect(
      matterHotPaneTarget({
        overdueDeadline: false,
        outboundCount: 1,
        unreplied: false,
      }),
    ).toBe("docs");
    expect(
      matterHotPaneTarget({
        overdueDeadline: false,
        outboundCount: 0,
        unreplied: true,
      }),
    ).toBe("docs");
    expect(
      matterHotPaneTarget({
        overdueDeadline: false,
        outboundCount: 0,
        unreplied: false,
        daysUntilDeadline: 2,
      }),
    ).toBe("deadlines");
  });
});
