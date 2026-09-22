import { describe, expect, it } from "vitest";
import { BUILTIN_LEGAL_REPLAY_FIXTURES, listReplayFixtureCategories } from "./replay-fixtures.js";
import { evaluateReplayFixtureStructure } from "./replay-gate-mapping.js";

describe("legal replay fixtures", () => {
  it("provides at least ten real-task-style replay fixtures", () => {
    expect(BUILTIN_LEGAL_REPLAY_FIXTURES.length).toBeGreaterThanOrEqual(10);
  });

  it("covers the Q1 legal production categories", () => {
    expect(listReplayFixtureCategories()).toEqual([
      "client_update",
      "contract_review",
      "demand_letter",
      "evidence_index",
      "legal_memo",
      "matter_chronology",
    ]);
  });

  it("keeps each fixture tied to sources and expected gate outcomes", () => {
    for (const fixture of BUILTIN_LEGAL_REPLAY_FIXTURES) {
      expect(fixture.requiredSources.length).toBeGreaterThan(0);
      expect(fixture.expectedGateOutcomes.length).toBeGreaterThan(0);
      expect(fixture.expectedDeliverableType).not.toBe("");
    }
  });

  for (const fixture of BUILTIN_LEGAL_REPLAY_FIXTURES) {
    it(`structural gate mapping: ${fixture.fixtureId}`, () => {
      const result = evaluateReplayFixtureStructure(fixture);
      expect(result.fixtureId).toBe(fixture.fixtureId);
      expect(result.checks.length).toBe(fixture.expectedGateOutcomes.length);
      expect(result.allSatisfied).toBe(true);
    });
  }
});
