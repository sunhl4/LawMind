import { describe, expect, it } from "vitest";
import { retrievalShareLabel, webSearchStatusLabel } from "./lawmind-settings-models.ts";

describe("retrievalShareLabel", () => {
  it("labels shared vs split retrieval for lawyers", () => {
    expect(retrievalShareLabel("single")).toBe("共用同一模型");
    expect(retrievalShareLabel(undefined)).toBe("共用同一模型");
    expect(retrievalShareLabel("dual")).toBe("对话与检索分开");
  });
});

describe("webSearchStatusLabel", () => {
  it("prefers native vendor search over Brave", () => {
    expect(webSearchStatusLabel({ webSearchNativeAvailable: true }).label).toBe("随当前模型");
    expect(webSearchStatusLabel({ webSearchApiKeyConfigured: true }).label).toBe("Brave 备用已配置");
  });
});
