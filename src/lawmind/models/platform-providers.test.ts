import { afterEach, describe, expect, it } from "vitest";
import { isPlatformInferenceAvailable, isPlatformModelConfigured } from "./platform-providers.js";

describe("platform provider configuration", () => {
  afterEach(() => {
    delete process.env.LAWMIND_PLATFORM_PROVIDER_DASHSCOPE_API_KEY;
    delete process.env.LAWMIND_PLATFORM_PROVIDER_DEEPSEEK_API_KEY;
    delete process.env.LAWMIND_PLATFORM_PROXY_URL;
    delete process.env.LAWMIND_PLATFORM_ACCESS_TOKEN;
  });

  it("is per-vendor when only a platform key is set", () => {
    process.env.LAWMIND_PLATFORM_PROVIDER_DASHSCOPE_API_KEY = "sk-platform";
    expect(isPlatformInferenceAvailable()).toBe(true);
    expect(isPlatformModelConfigured("dashscope")).toBe(true);
    expect(isPlatformModelConfigured("deepseek")).toBe(false);
    expect(isPlatformModelConfigured("openai")).toBe(false);
  });

  it("is all-or-nothing when the platform proxy is set", () => {
    process.env.LAWMIND_PLATFORM_PROXY_URL = "https://platform.example/v1";
    process.env.LAWMIND_PLATFORM_ACCESS_TOKEN = "tok-platform";
    expect(isPlatformModelConfigured("dashscope")).toBe(true);
    expect(isPlatformModelConfigured("deepseek")).toBe(true);
    expect(isPlatformModelConfigured("openai")).toBe(true);
  });
});
