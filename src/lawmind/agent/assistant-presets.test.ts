import { describe, expect, it } from "vitest";
import {
  ASSISTANT_PRESETS,
  getAssistantPreset,
  listAssistantPresets,
  taskRiskExceedsPresetCeiling,
} from "./assistant-presets.js";

describe("assistant-presets", () => {
  it("has unique ids", () => {
    const ids = ASSISTANT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each preset has non-empty promptSection", () => {
    for (const p of ASSISTANT_PRESETS) {
      expect(p.promptSection.trim().length).toBeGreaterThan(10);
      expect(p.displayName.trim().length).toBeGreaterThan(0);
    }
  });

  it("getAssistantPreset returns undefined for unknown", () => {
    expect(getAssistantPreset("nope")).toBeUndefined();
  });

  it("listAssistantPresets matches ASSISTANT_PRESETS length", () => {
    expect(listAssistantPresets().length).toBe(ASSISTANT_PRESETS.length);
  });

  it("each preset has riskCeiling and non-empty acceptanceChecklist", () => {
    for (const p of ASSISTANT_PRESETS) {
      expect(["low", "medium", "high"]).toContain(p.riskCeiling);
      expect(p.acceptanceChecklist.length).toBeGreaterThan(0);
    }
  });

  it("taskRiskExceedsPresetCeiling compares risk levels", () => {
    const client = getAssistantPreset("client_memo");
    expect(client).toBeDefined();
    expect(taskRiskExceedsPresetCeiling("high", client)).toBe(true);
    expect(taskRiskExceedsPresetCeiling("low", client)).toBe(false);
  });
});
