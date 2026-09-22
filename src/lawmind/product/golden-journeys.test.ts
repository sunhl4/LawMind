import { describe, expect, it } from "vitest";
import {
  LAWMIND_Q1_GOLDEN_JOURNEYS,
  buildGoldenJourneysMarkdown,
  getGoldenJourney,
  listGoldenJourneyIds,
} from "./golden-journeys.js";

describe("LawMind Q1 golden journeys", () => {
  it("freezes the three Q1 product journeys", () => {
    expect(listGoldenJourneyIds()).toEqual([
      "matter-production-flow",
      "contract-review-trust-flow",
      "role-delegation-memory-flow",
    ]);
  });

  it("keeps every journey tied to acceptance criteria and evidence", () => {
    for (const journey of LAWMIND_Q1_GOLDEN_JOURNEYS) {
      expect(journey.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
      expect(journey.requiredSurfaces.length).toBeGreaterThan(0);
      expect(journey.requiredCommands.length).toBeGreaterThan(0);
      expect(journey.steps.length).toBeGreaterThanOrEqual(3);
      expect(journey.steps.every((step) => step.evidence.length > 0)).toBe(true);
    }
  });

  it("renders a markdown baseline for release reports", () => {
    const report = buildGoldenJourneysMarkdown();
    expect(report).toContain("Matter production flow");
    expect(report).toContain("Contract review trust flow");
    expect(report).toContain("Role delegation and memory flow");
  });

  it("retrieves journeys by id", () => {
    expect(getGoldenJourney("matter-production-flow").title).toBe("Matter production flow");
  });
});
