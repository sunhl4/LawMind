import { describe, expect, it } from "vitest";
import { isSafeTaskIdSegment } from "./safe-task-id.js";

describe("isSafeTaskIdSegment", () => {
  it("accepts alphanumeric ids with dots dashes underscores", () => {
    expect(isSafeTaskIdSegment("task-1")).toBe(true);
    expect(isSafeTaskIdSegment("a.b_c-9")).toBe(true);
  });

  it("rejects path traversal and separators", () => {
    expect(isSafeTaskIdSegment("..")).toBe(false);
    expect(isSafeTaskIdSegment("a/b")).toBe(false);
    expect(isSafeTaskIdSegment("a\\b")).toBe(false);
  });

  it("rejects empty and overlong", () => {
    expect(isSafeTaskIdSegment("")).toBe(false);
    expect(isSafeTaskIdSegment("x".repeat(201))).toBe(false);
  });
});
