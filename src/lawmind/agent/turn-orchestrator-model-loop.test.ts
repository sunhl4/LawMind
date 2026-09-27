import { describe, expect, it } from "vitest";
import {
  advanceIdenticalToolStreak,
  formatIdenticalToolRepeatNudge,
  formatIdenticalToolRepeatStop,
  identicalToolRepeatDecision,
  resolveStrictUpstreamToolStreaming,
  shouldWarnToolBudget,
  toolCallBatchSignature,
} from "./turn-orchestrator-model-loop.js";

describe("shouldWarnToolBudget", () => {
  it("warns at 80% of max (ceil)", () => {
    expect(shouldWarnToolBudget(31, 40)).toBe(false);
    expect(shouldWarnToolBudget(32, 40)).toBe(true);
    expect(shouldWarnToolBudget(0, 40)).toBe(false);
    expect(shouldWarnToolBudget(10, 0)).toBe(false);
  });
});

describe("identical tool-call streak", () => {
  const batch = [{ name: "search_matter", arguments: { q: "定金", limit: 5 } }];

  it("ignores argument key order", () => {
    const flipped = [{ name: "search_matter", arguments: { limit: 5, q: "定金" } }];
    expect(toolCallBatchSignature(batch)).toBe(toolCallBatchSignature(flipped));
  });

  it("nudges on the third identical batch and stops only after that nudge", () => {
    let streak = advanceIdenticalToolStreak(null, toolCallBatchSignature(batch));
    expect(identicalToolRepeatDecision(streak)).toBe("ok");
    streak = advanceIdenticalToolStreak(streak, toolCallBatchSignature(batch));
    expect(identicalToolRepeatDecision(streak)).toBe("ok");
    streak = advanceIdenticalToolStreak(streak, toolCallBatchSignature(batch));
    expect(identicalToolRepeatDecision(streak)).toBe("nudge");
    streak = { ...streak, nudged: true };
    streak = advanceIdenticalToolStreak(streak, toolCallBatchSignature(batch));
    expect(identicalToolRepeatDecision(streak)).toBe("stop");
    expect(formatIdenticalToolRepeatNudge().startsWith("【重复调用】")).toBe(true);
    expect(formatIdenticalToolRepeatStop()).toContain("接着办");
  });

  it("resets when the batch changes", () => {
    let streak = advanceIdenticalToolStreak(null, toolCallBatchSignature(batch));
    streak = advanceIdenticalToolStreak(streak, toolCallBatchSignature(batch));
    streak = { ...streak, nudged: true };
    streak = advanceIdenticalToolStreak(
      streak,
      toolCallBatchSignature([{ name: "read_host_file", arguments: { path: "a.docx" } }]),
    );
    expect(streak.streak).toBe(1);
    expect(streak.nudged).toBe(false);
    expect(identicalToolRepeatDecision(streak)).toBe("ok");
  });
});

describe("resolveStrictUpstreamToolStreaming", () => {
  it("is false without onEvent", () => {
    expect(resolveStrictUpstreamToolStreaming(false)).toBe(false);
  });

  it("defaults to relaxed when env unset (D3 opt-in)", () => {
    expect(resolveStrictUpstreamToolStreaming(true, {})).toBe(false);
  });

  it("enables when LAWMIND_STRICT_TOOL_STREAM=1", () => {
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "1" })).toBe(
      true,
    );
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "true" })).toBe(
      true,
    );
  });

  it("stays relaxed for 0/false/off", () => {
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "0" })).toBe(
      false,
    );
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "false" })).toBe(
      false,
    );
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "off" })).toBe(
      false,
    );
  });
});
