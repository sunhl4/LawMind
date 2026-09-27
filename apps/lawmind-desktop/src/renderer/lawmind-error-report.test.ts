import { describe, expect, it } from "vitest";
import { describeThrown, formatErrorCauseReport, isIgnorableThrown } from "./lawmind-error-report";

describe("lawmind-error-report", () => {
  it("keeps the thrown type, message, and stack for locating the line", () => {
    const error = new TypeError("clientId is not defined");
    error.stack = "TypeError: clientId is not defined\n    at MatterHeader (MatterHeader.tsx:40:12)";
    const described = describeThrown(error);
    const text = formatErrorCauseReport({
      where: "工作台",
      ...described,
      componentStack: "\n    at MatterHeader\n    at Workbench",
      at: "2026-09-26T00:00:00.000Z",
    });
    expect(text).toContain("类型：TypeError");
    expect(text).toContain("说明：clientId is not defined");
    expect(text).toContain("at MatterHeader (MatterHeader.tsx:40:12)");
    expect(text).toContain("at MatterHeader");
    expect(text).not.toContain("案件");
  });

  it("does not pop for aborted requests or browser resize noise", () => {
    expect(isIgnorableThrown(describeThrown(new DOMException("aborted", "AbortError")))).toBe(true);
    expect(isIgnorableThrown({ name: "Error", message: "ResizeObserver loop completed with undelivered notifications." })).toBe(
      true,
    );
    expect(isIgnorableThrown(describeThrown(new Error("clientId is not defined")))).toBe(false);
  });
});
