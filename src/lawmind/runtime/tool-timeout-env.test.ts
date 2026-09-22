import { describe, expect, it } from "vitest";
import { formatWorkflowTimingSummary } from "../agent/tools/engine/engine-tool-shared.js";
import { isUnlimitedToolTimeoutMs, parseToolTimeoutMsEnv } from "./tool-timeout-env.js";

describe("parseToolTimeoutMsEnv", () => {
  it("defaults to 0 (no tool wall-clock kill)", () => {
    expect(parseToolTimeoutMsEnv(0, {})).toBe(0);
  });

  it("accepts 0 as unlimited", () => {
    expect(parseToolTimeoutMsEnv(999, { LAWMIND_TOOL_TIMEOUT_MS: "0" })).toBe(0);
  });

  it("parses positive caps", () => {
    expect(parseToolTimeoutMsEnv(0, { LAWMIND_TOOL_TIMEOUT_MS: "180000" })).toBe(180_000);
  });
});

describe("isUnlimitedToolTimeoutMs", () => {
  it("treats 0 and negative as unlimited", () => {
    expect(isUnlimitedToolTimeoutMs(0)).toBe(true);
    expect(isUnlimitedToolTimeoutMs(-1)).toBe(true);
    expect(isUnlimitedToolTimeoutMs(1)).toBe(false);
  });
});

describe("formatWorkflowTimingSummary", () => {
  it("labels model vs pipeline time", () => {
    const line = formatWorkflowTimingSummary({
      plan: 1200,
      research: 8500,
      draft_model: 142_000,
      draft_critic: 45_000,
      workflow_total: 200_000,
    });
    expect(line).toMatch(/耗时诊断/);
    expect(line).toMatch(/模型相关约 187\.0s/);
    expect(line).toMatch(/管线其它约 13\.0s/);
  });
});
