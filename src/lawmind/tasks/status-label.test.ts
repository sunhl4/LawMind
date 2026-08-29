import { describe, expect, it } from "vitest";
import { resolveTaskStatusLabel } from "./status-label";

describe("resolveTaskStatusLabel", () => {
  it("maps approved without output to render-ready", () => {
    expect(
      resolveTaskStatusLabel({ status: "completed", reviewStatus: "approved", outputPath: null }),
    ).toBe("可渲染");
  });

  it("maps clarification execution state", () => {
    expect(
      resolveTaskStatusLabel({
        status: "running",
        executionState: { phase: "clarify", status: "awaiting_clarification", recoverable: true },
      }),
    ).toBe("待澄清");
  });
});
