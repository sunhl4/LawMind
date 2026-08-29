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

  it("preserves craftSignals and gateDecision when truncating", () => {
    const huge = {
      ok: true,
      data: {
        taskId: "t1",
        craftSignals: [{ level: "warn", code: "rewrite_amplitude_soft", message: "宽改" }],
        gateDecision: {
          gate: "reasoning_gate",
          decision: "allow",
          category: "judgment_soft",
        },
        redlinePending: 3,
        warning: "幅度较大",
        applied: Array.from({ length: 200 }, (_, i) => ({
          find: `find-${i}-${"x".repeat(80)}`,
          replace: `rep-${i}`,
        })),
      },
    };
    const slim = summarizeToolResultForHistory(huge, { maxChars: 800 }) as {
      truncated?: boolean;
      data?: Record<string, unknown>;
    };
    expect(slim.truncated).toBe(true);
    expect(slim.data?.craftSignals).toEqual(huge.data.craftSignals);
    expect(slim.data?.gateDecision).toEqual(huge.data.gateDecision);
    expect(slim.data?.redlinePending).toBe(3);
    expect(slim.data?.warning).toBe("幅度较大");
  });
});
