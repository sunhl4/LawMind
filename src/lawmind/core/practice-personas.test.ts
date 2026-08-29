import { describe, expect, it } from "vitest";
import { PRACTICE_PERSONAS, practicePersonaByPresetKey } from "./practice-personas.js";

describe("practice-personas", () => {
  it("maps contract_review preset to commercial persona", () => {
    const p = practicePersonaByPresetKey("contract_review");
    expect(p?.id).toBe("commercial");
  });

  it("includes litigation and due diligence entries", () => {
    expect(PRACTICE_PERSONAS.some((p) => p.id === "litigation")).toBe(true);
    expect(PRACTICE_PERSONAS.some((p) => p.id === "due_diligence")).toBe(true);
  });
});
