import { afterEach, describe, expect, it } from "vitest";
import {
  inferProviderIdFromBaseUrl,
  listProviderKeyStatus,
  normalizeModelBaseUrl,
  resolveProviderApiKeyFromEnv,
} from "./providers.js";

describe("model providers", () => {
  afterEach(() => {
    delete process.env.LAWMIND_AGENT_API_KEY;
    delete process.env.LAWMIND_AGENT_BASE_URL;
    delete process.env.LAWMIND_QWEN_API_KEY;
    delete process.env.LAWMIND_QWEN_BASE_URL;
    delete process.env.LAWMIND_DEEPSEEK_API_KEY;
    delete process.env.LAWMIND_PROVIDER_DASHSCOPE_API_KEY;
  });

  it("normalizes DeepSeek host with and without /v1", () => {
    expect(normalizeModelBaseUrl("https://api.deepseek.com/v1/")).toBe("https://api.deepseek.com");
    expect(inferProviderIdFromBaseUrl("https://api.deepseek.com")).toBe("deepseek");
    expect(inferProviderIdFromBaseUrl("")).toBe("deepseek");
    expect(inferProviderIdFromBaseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(
      "dashscope",
    );
  });

  it("uses the wizard key only for the Base URL's provider", () => {
    process.env.LAWMIND_AGENT_API_KEY = "sk-wizard";
    process.env.LAWMIND_AGENT_BASE_URL = "https://api.deepseek.com/v1";
    expect(resolveProviderApiKeyFromEnv("deepseek")).toBe("sk-wizard");
    expect(resolveProviderApiKeyFromEnv("dashscope")).toBe("");
    const deepseek = listProviderKeyStatus().find((p) => p.provider === "deepseek");
    const qwen = listProviderKeyStatus().find((p) => p.provider === "dashscope");
    expect(deepseek?.configured).toBe(true);
    expect(qwen?.configured).toBe(false);
  });

  it("keeps DashScope BYOK on LAWMIND_QWEN_API_KEY without marking DeepSeek", () => {
    process.env.LAWMIND_QWEN_API_KEY = "sk-qwen";
    expect(resolveProviderApiKeyFromEnv("dashscope")).toBe("sk-qwen");
    expect(resolveProviderApiKeyFromEnv("deepseek")).toBe("");
  });

  it("prefers the wizard key over a leftover DeepSeek env key", () => {
    process.env.LAWMIND_AGENT_API_KEY = "sk-wizard";
    process.env.LAWMIND_AGENT_BASE_URL = "https://api.deepseek.com/v1";
    process.env.LAWMIND_DEEPSEEK_API_KEY = "sk-stale";
    expect(resolveProviderApiKeyFromEnv("deepseek")).toBe("sk-wizard");
  });

  it("does not treat leftover LAWMIND_QWEN_* DeepSeek copies as DashScope", () => {
    delete process.env.LAWMIND_PROVIDER_DASHSCOPE_API_KEY;
    process.env.LAWMIND_QWEN_API_KEY = "sk-leftover";
    process.env.LAWMIND_QWEN_BASE_URL = "https://api.deepseek.com/v1";
    expect(resolveProviderApiKeyFromEnv("dashscope")).toBe("");
    expect(listProviderKeyStatus().find((p) => p.provider === "dashscope")?.configured).toBe(false);
  });

  it("still uses LAWMIND_QWEN_API_KEY for DashScope when Base URL is empty", () => {
    process.env.LAWMIND_QWEN_API_KEY = "sk-qwen";
    expect(resolveProviderApiKeyFromEnv("dashscope")).toBe("sk-qwen");
  });

  it("still uses a dedicated DashScope key when Qwen URL is a leftover alias", () => {
    process.env.LAWMIND_QWEN_API_KEY = "sk-leftover";
    process.env.LAWMIND_QWEN_BASE_URL = "https://api.deepseek.com/v1";
    process.env.LAWMIND_PROVIDER_DASHSCOPE_API_KEY = "sk-real-qwen";
    expect(resolveProviderApiKeyFromEnv("dashscope")).toBe("sk-real-qwen");
  });
});
