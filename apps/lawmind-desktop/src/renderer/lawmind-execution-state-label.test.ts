import { describe, expect, it } from "vitest";
import { formatExecutionStateLabel } from "./lawmind-execution-state-label.js";

describe("formatExecutionStateLabel", () => {
  it("returns Chinese phase and status", () => {
    expect(
      formatExecutionStateLabel({ phase: "draft", status: "running", recoverable: true }),
    ).toBe("起草 · 进行中");
  });

  it("returns null for missing state", () => {
    expect(formatExecutionStateLabel(null)).toBeNull();
  });
});
