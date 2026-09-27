import { describe, expect, it } from "vitest";
import {
  resolveToolDecisionMaxTokens,
  shouldRaiseToolDecisionOutput,
  TOOL_DECISION_MAX_TOKENS,
} from "./tool-decision-sampling.js";

describe("tool decision sampling", () => {
  it("caps advertised tool rounds and leaves deliverable rounds alone", () => {
    expect(resolveToolDecisionMaxTokens(40_000, true)).toBe(TOOL_DECISION_MAX_TOKENS);
    expect(resolveToolDecisionMaxTokens(1_024, true)).toBe(1_024);
    expect(resolveToolDecisionMaxTokens(40_000, false)).toBe(40_000);
    expect(resolveToolDecisionMaxTokens(undefined, true)).toBe(TOOL_DECISION_MAX_TOKENS);
  });

  it("raises output only when a tool round comes back truncated", () => {
    expect(
      shouldRaiseToolDecisionOutput({
        toolsAdvertised: true,
        configuredMaxTokens: 40_000,
        finishReason: "length",
      }),
    ).toBe(true);
    expect(
      shouldRaiseToolDecisionOutput({
        toolsAdvertised: true,
        configuredMaxTokens: 40_000,
        finishReason: "tool_calls",
      }),
    ).toBe(false);
    expect(
      shouldRaiseToolDecisionOutput({
        toolsAdvertised: true,
        configuredMaxTokens: TOOL_DECISION_MAX_TOKENS,
        finishReason: "length",
      }),
    ).toBe(false);
    expect(
      shouldRaiseToolDecisionOutput({
        toolsAdvertised: false,
        configuredMaxTokens: 40_000,
        finishReason: "length",
      }),
    ).toBe(false);
  });
});
