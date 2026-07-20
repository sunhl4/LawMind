import { describe, expect, it } from "vitest";
import { classifyModelWorkTier, modelWorkTierLabel } from "./model-tier.js";

describe("model-tier", () => {
  it("classifies advisor / worker / general", () => {
    expect(classifyModelWorkTier("qwen-max")).toBe("advisor");
    expect(classifyModelWorkTier("deepseek-reasoner")).toBe("advisor");
    expect(classifyModelWorkTier("gpt-4o")).toBe("advisor");
    expect(classifyModelWorkTier("qwen-turbo")).toBe("worker");
    expect(classifyModelWorkTier("gpt-4o-mini")).toBe("worker");
    expect(classifyModelWorkTier("qwen-plus")).toBe("general");
    expect(classifyModelWorkTier("")).toBe("general");
  });

  it("labels tiers in Chinese", () => {
    expect(modelWorkTierLabel("advisor")).toContain("Advisor");
    expect(modelWorkTierLabel("worker")).toContain("Worker");
    expect(modelWorkTierLabel("general")).toBe("通用");
  });
});
