import { describe, expect, it } from "vitest";
import { allowStaleCoverage, evaluateCoverageRatchet } from "./check-coverage-ratchet.mjs";

const floors = {
  statements: 62.77,
  branches: 53.27,
  functions: 61.99,
  lines: 62.88,
};

const policy = { tolerancePct: 1.5, maxHeadroomPct: 3 };

describe("coverage ratchet", () => {
  it("passes inside the band [floor − tolerance, floor + headroom]", () => {
    const current = {
      statements: 62.77 - 1.5,
      branches: 53.27,
      functions: 61.99 + 3,
      lines: 62.88 + 1.2,
    };
    expect(evaluateCoverageRatchet(current, floors, policy)).toEqual([]);
  });

  it("fails when a metric drops below the floor by more than the tolerance", () => {
    const current = { ...floors, statements: 62.77 - 1.5 - 0.01 };
    const failures = evaluateCoverageRatchet(current, floors, policy);
    expect(failures).toEqual([
      { key: "statements", kind: "below", value: current.statements, floor: floors.statements },
    ]);
  });

  it("fails when a metric sits far enough above the floor that the floor is stale", () => {
    const current = { ...floors, lines: 62.88 + 3 + 0.01 };
    const failures = evaluateCoverageRatchet(current, floors, policy);
    expect(failures).toEqual([
      { key: "lines", kind: "headroom", value: current.lines, floor: floors.lines },
    ]);
  });

  it("treats LAWMIND_ALLOW_STALE_COVERAGE=1 the same as --allow-stale", () => {
    expect(allowStaleCoverage([], { LAWMIND_ALLOW_STALE_COVERAGE: "1" })).toBe(true);
    expect(allowStaleCoverage(["--allow-stale"], {})).toBe(true);
    expect(allowStaleCoverage([], { LAWMIND_ALLOW_STALE_COVERAGE: "0" })).toBe(false);
    expect(allowStaleCoverage([], {})).toBe(false);
  });
});
