import { describe, expect, it } from "vitest";
import {
  ISOLATION_PARENT_BUDGET_CHARS,
  isolationKey,
  resetIsolationBudget,
  takeIsolationBudget,
} from "./context-isolation-budget.js";

describe("isolation budget", () => {
  it("shares one pool across admissions and stops when it is spent", () => {
    const key = isolationKey("/tmp/budget-a", "sess-a");
    resetIsolationBudget(key);
    expect(takeIsolationBudget(key, 2_000)).toBe(2_000);
    expect(takeIsolationBudget(key, 2_000)).toBe(ISOLATION_PARENT_BUDGET_CHARS - 2_000);
    expect(takeIsolationBudget(key, 100)).toBe(0);
    resetIsolationBudget(key);
    expect(takeIsolationBudget(key, 100)).toBe(100);
  });
});
