import { describe, expect, it } from "vitest";
import {
  stringifyToolResultForHistory,
  summarizeToolResultForHistory,
} from "./tool-result-history.js";

describe("tool-result-history", () => {
  it("passes through small results unchanged", () => {
    const small = { ok: true, taskId: "t1", text: "short" };
    expect(summarizeToolResultForHistory(small)).toEqual(small);
  });

  it("truncates huge results but keeps ok/error", () => {
    const huge = {
      ok: true,
      text: "x".repeat(40_000),
      nested: { blob: "y".repeat(10_000) },
    };
    const slim = summarizeToolResultForHistory(huge, { maxChars: 2_000 }) as Record<
      string,
      unknown
    >;
    expect(slim.ok).toBe(true);
    expect(slim.truncated).toBe(true);
    expect(stringifyToolResultForHistory(huge, { maxChars: 2_000 }).length).toBeLessThan(8_000);
    expect(typeof slim.text === "string" ? slim.text.length : 0).toBeLessThanOrEqual(4_000);
  });
});
