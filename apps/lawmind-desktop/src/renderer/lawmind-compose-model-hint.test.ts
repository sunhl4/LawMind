import { describe, expect, it } from "vitest";
import { composeModelHintCalloutClass } from "./lawmind-compose-model-hint";

describe("composeModelHintCalloutClass", () => {
  it("uses info callout while quick test is busy with no hint text", () => {
    expect(composeModelHintCalloutClass(null, true)).toContain("lm-callout-info");
  });

  it("uses warn callout for failure-like hint text", () => {
    expect(composeModelHintCalloutClass("连接失败", false)).toContain("lm-callout-warn");
  });

  it("appends extra layout class when provided", () => {
    expect(composeModelHintCalloutClass("就绪", false, "lm-collab-model-rail-hint")).toContain(
      "lm-collab-model-rail-hint",
    );
  });
});
