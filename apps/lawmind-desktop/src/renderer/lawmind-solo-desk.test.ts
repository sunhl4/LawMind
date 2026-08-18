import { describe, expect, it } from "vitest";
import {
  isSoloDeskEdition,
  reviewRejectedNextStepCopy,
  settingsAssistantsEmptyCopy,
  settingsLeadCopy,
  shouldBounceSoloOffRoom,
  shouldEmbedSoloMatterRail,
  shouldEmbedSoloReviewRail,
  shouldReplaceWorkspaceWithMatterPage,
  shouldShowCollaborationTab,
  shouldShowReviewFirmLearningControls,
  soloDeskSurfacePane,
  shouldShowComposePlanPicker,
  shouldShowEditionBadge,
  shouldShowSettingsSection,
  soloPrimaryTabLabel,
} from "./lawmind-solo-desk.js";

describe("lawmind-solo-desk", () => {
  it("embeds review in the workspace for Solo only", () => {
    expect(isSoloDeskEdition("solo")).toBe(true);
    expect(shouldEmbedSoloReviewRail("solo")).toBe(true);
    expect(shouldEmbedSoloMatterRail("solo")).toBe(true);
    expect(shouldShowCollaborationTab("solo")).toBe(false);
    expect(soloPrimaryTabLabel("workspace")).toBe("对话");
    expect(soloPrimaryTabLabel("review")).toBe("改稿");
  });

  it("keeps Firm on the three-room shell", () => {
    expect(shouldEmbedSoloReviewRail("firm")).toBe(false);
    expect(shouldEmbedSoloMatterRail("firm")).toBe(false);
    expect(shouldReplaceWorkspaceWithMatterPage("firm", true)).toBe(true);
    expect(shouldReplaceWorkspaceWithMatterPage("solo", true)).toBe(false);
    expect(shouldShowCollaborationTab("firm")).toBe(true);
    expect(shouldBounceSoloOffRoom("firm", "review")).toBe(false);
    expect(shouldShowSettingsSection("firm", "collaboration")).toBe(true);
    expect(shouldShowEditionBadge("firm")).toBe(true);
    expect(shouldShowComposePlanPicker("firm")).toBe(true);
  });

  it("bounces Solo off review and collaboration rooms", () => {
    expect(shouldBounceSoloOffRoom("solo", "review")).toBe(true);
    expect(shouldBounceSoloOffRoom("solo", "collaboration")).toBe(true);
    expect(shouldBounceSoloOffRoom("solo", "workspace")).toBe(false);
  });

  it("thins Solo settings to model, workspace, and assistant", () => {
    expect(shouldShowSettingsSection("solo", "collaboration")).toBe(false);
    expect(shouldShowSettingsSection("solo", "roles")).toBe(false);
    expect(shouldShowSettingsSection("solo", "templates")).toBe(false);
    expect(shouldShowSettingsSection("solo", "edition")).toBe(false);
    expect(shouldShowSettingsSection("solo", "model")).toBe(true);
    expect(shouldShowSettingsSection("solo", "workspace")).toBe(true);
    expect(settingsLeadCopy("solo")).toContain("这一页写和改稿");
    expect(settingsLeadCopy("solo")).not.toContain("协作");
    expect(settingsAssistantsEmptyCopy("solo")).not.toContain("协作");
    expect(shouldShowEditionBadge("solo")).toBe(false);
    expect(shouldShowComposePlanPicker("solo")).toBe(false);
    expect(shouldShowReviewFirmLearningControls("solo")).toBe(false);
    expect(shouldShowReviewFirmLearningControls("firm")).toBe(true);
    expect(reviewRejectedNextStepCopy("solo", true)).not.toContain("案件工作台");
    expect(reviewRejectedNextStepCopy("firm", true)).toContain("案件工作台");
  });

  it("keeps Solo on one surface: review before matter before chat", () => {
    expect(soloDeskSurfacePane({ edition: "solo", reviewRail: true, matterOpen: true })).toBe(
      "review",
    );
    expect(soloDeskSurfacePane({ edition: "solo", reviewRail: false, matterOpen: true })).toBe(
      "matter",
    );
    expect(soloDeskSurfacePane({ edition: "solo", reviewRail: false, matterOpen: false })).toBe(
      "chat",
    );
    expect(soloDeskSurfacePane({ edition: "firm", reviewRail: false, matterOpen: true })).toBe(
      "chat",
    );
  });
});
