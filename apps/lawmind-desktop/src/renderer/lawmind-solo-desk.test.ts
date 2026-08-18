import { describe, expect, it } from "vitest";
import {
  isSoloDeskEdition,
  settingsAssistantsEmptyCopy,
  settingsLeadCopy,
  shouldBounceSoloOffRoom,
  shouldEmbedSoloReviewRail,
  shouldShowCollaborationTab,
  shouldShowComposePlanPicker,
  shouldShowEditionBadge,
  shouldShowSettingsSection,
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
  });
});
