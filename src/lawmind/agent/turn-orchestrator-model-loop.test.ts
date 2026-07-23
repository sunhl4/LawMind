import { describe, expect, it } from "vitest";
import { resolveStrictUpstreamToolStreaming } from "./turn-orchestrator-model-loop.js";

describe("resolveStrictUpstreamToolStreaming", () => {
  it("is false without onEvent", () => {
    expect(resolveStrictUpstreamToolStreaming(false)).toBe(false);
  });

  it("defaults to strict when env unset", () => {
    expect(resolveStrictUpstreamToolStreaming(true, {})).toBe(true);
  });

  it("relaxes when LAWMIND_STRICT_TOOL_STREAM=0", () => {
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "0" })).toBe(
      false,
    );
  });

  it("relaxes for false/off", () => {
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "false" })).toBe(
      false,
    );
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "off" })).toBe(
      false,
    );
  });
});
