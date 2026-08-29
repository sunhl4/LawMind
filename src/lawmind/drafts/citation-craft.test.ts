import { describe, expect, it } from "vitest";
import { CITATION_GROUNDING_SKILL, formatCitationGateCoach } from "./citation-craft.js";

describe("citation-craft", () => {
  it("exports grounding skill with next steps", () => {
    expect(CITATION_GROUNDING_SKILL).toContain("引用锚定");
    expect(CITATION_GROUNDING_SKILL).toContain("render_document");
  });

  it("formatCitationGateCoach is executable coach text", () => {
    const coach = formatCitationGateCoach("missing=2");
    expect(coach).toContain("【引用教练】");
    expect(coach).toContain("research_task");
    expect(coach).toContain("missing=2");
  });
});
