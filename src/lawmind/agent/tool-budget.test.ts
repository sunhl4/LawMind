import { describe, expect, it } from "vitest";
import {
  DEFAULT_HARD_TOOL_CALL_CEILING,
  DEFAULT_SOFT_TOOL_CALLS,
  resolveToolCallBudgets,
  shouldCheckpointToolBudget,
  shouldHardStopToolBudget,
} from "./tool-budget.js";

describe("resolveToolCallBudgets", () => {
  it("defaults to 80 silent ceiling (no lawyer checkpoint)", () => {
    expect(resolveToolCallBudgets()).toEqual({
      soft: DEFAULT_SOFT_TOOL_CALLS,
      hard: DEFAULT_HARD_TOOL_CALL_CEILING,
    });
  });

  it("gives default-scale turns the runaway ceiling and keeps tiny shards tight", () => {
    expect(resolveToolCallBudgets(25)).toEqual({ soft: 25, hard: DEFAULT_HARD_TOOL_CALL_CEILING });
    expect(resolveToolCallBudgets(50)).toEqual({ soft: 50, hard: DEFAULT_HARD_TOOL_CALL_CEILING });
    expect(resolveToolCallBudgets(1)).toEqual({ soft: 1, hard: 1 });
    expect(resolveToolCallBudgets(2)).toEqual({ soft: 2, hard: 2 });
  });
});

describe("shouldCheckpointToolBudget", () => {
  it("never asks the lawyer about step count", () => {
    expect(shouldCheckpointToolBudget({ used: 40, soft: 40 })).toBe(false);
    expect(shouldCheckpointToolBudget({ used: 80, soft: 40 })).toBe(false);
    expect(shouldCheckpointToolBudget({ used: 40, soft: 40, skipCheckpoint: true })).toBe(false);
  });
});

describe("shouldHardStopToolBudget", () => {
  it("stops only at the hard ceiling", () => {
    expect(shouldHardStopToolBudget(79, 80)).toBe(false);
    expect(shouldHardStopToolBudget(80, 80)).toBe(true);
  });
});
