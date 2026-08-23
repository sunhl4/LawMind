import { describe, expect, it } from "vitest";
import {
  DEFAULT_HARD_TOOL_CALL_CEILING,
  DEFAULT_SOFT_TOOL_CALLS,
  resolveToolCallBudgets,
  shouldCheckpointToolBudget,
  shouldHardStopToolBudget,
} from "./tool-budget.js";

describe("resolveToolCallBudgets", () => {
  it("defaults to 40 soft / at least 80 hard", () => {
    expect(resolveToolCallBudgets()).toEqual({
      soft: DEFAULT_SOFT_TOOL_CALLS,
      hard: DEFAULT_HARD_TOOL_CALL_CEILING,
    });
  });

  it("doubles an explicit soft cap", () => {
    expect(resolveToolCallBudgets(25)).toEqual({ soft: 25, hard: 80 });
    expect(resolveToolCallBudgets(50)).toEqual({ soft: 50, hard: 100 });
  });
});

describe("shouldCheckpointToolBudget", () => {
  it("pauses at soft unless this turn already continued", () => {
    expect(shouldCheckpointToolBudget({ used: 39, soft: 40 })).toBe(false);
    expect(shouldCheckpointToolBudget({ used: 40, soft: 40 })).toBe(true);
    expect(shouldCheckpointToolBudget({ used: 40, soft: 40, skipCheckpoint: true })).toBe(false);
  });
});

describe("shouldHardStopToolBudget", () => {
  it("stops only at the hard ceiling", () => {
    expect(shouldHardStopToolBudget(79, 80)).toBe(false);
    expect(shouldHardStopToolBudget(80, 80)).toBe(true);
  });
});
