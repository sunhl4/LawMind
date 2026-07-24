import { describe, expect, it } from "vitest";
import { resolveStrictUpstreamToolStreaming } from "./turn-orchestrator-model-loop.js";

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
