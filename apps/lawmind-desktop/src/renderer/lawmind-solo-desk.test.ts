import { describe, expect, it } from "vitest";
import {
  isSoloDeskEdition,
  shouldEmbedSoloReviewRail,
  shouldShowCollaborationTab,
  soloPrimaryTabLabel,
} from "./lawmind-solo-desk.js";

describe("lawmind-solo-desk", () => {
  it("embeds review in the workspace for Solo only", () => {
    expect(isSoloDeskEdition("solo")).toBe(true);
    expect(shouldEmbedSoloReviewRail("solo")).toBe(true);
    expect(shouldShowCollaborationTab("solo")).toBe(false);
    expect(soloPrimaryTabLabel("workspace")).toBe("对话");
    expect(soloPrimaryTabLabel("review")).toBe("改稿");
  });

  it("keeps Firm on the three-room shell", () => {
    expect(shouldEmbedSoloReviewRail("firm")).toBe(false);
    expect(shouldShowCollaborationTab("firm")).toBe(true);
  });
});
