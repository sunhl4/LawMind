import { describe, expect, it } from "vitest";
import { buildQuickCreateDraft, presetSummary } from "./lawmind-assistant-templates";

const presets = [
  {
    id: "contract_review",
    displayName: "合同审查",
    promptSection: "你侧重**合同审查**相关工作。",
  },
];

describe("lawmind-assistant-templates", () => {
  it("builds draft from preset and name", () => {
    const d = buildQuickCreateDraft(presets, "contract_review", "并购合同专员");
    expect(d.displayName).toBe("并购合同专员");
    expect(d.presetKey).toBe("contract_review");
    expect(d.customRoleTitle).toBe("合同审查");
  });

  it("summarizes preset for cards", () => {
    expect(presetSummary(presets, "contract_review")).toContain("合同审查");
  });
});
