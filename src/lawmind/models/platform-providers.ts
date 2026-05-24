import { getProviderDefinition } from "./providers.js";
import type { LawMindModelProviderId } from "./types.js";

/** SaaS proxy: desktop sends LawMind session token; keys stay on platform. */
export function resolvePlatformProxyFromEnv(): { baseUrl: string; accessToken: string } | null {
  const baseUrl = process.env.LAWMIND_PLATFORM_PROXY_URL?.trim().replace(/\/$/, "");
  const accessToken =
    process.env.LAWMIND_PLATFORM_ACCESS_TOKEN?.trim() ||
    process.env.LAWMIND_PLATFORM_API_TOKEN?.trim() ||
    "";
  if (!baseUrl || !accessToken) {
    return null;
  }
  return { baseUrl, accessToken };
}

const PLATFORM_PROVIDER_KEY_ENV: Record<
  Exclude<LawMindModelProviderId, "custom" | "platform">,
  string[]
> = {
  dashscope: ["LAWMIND_PLATFORM_PROVIDER_DASHSCOPE_API_KEY", "LAWMIND_PLATFORM_QWEN_API_KEY"],
  openai: ["LAWMIND_PLATFORM_PROVIDER_OPENAI_API_KEY"],
  deepseek: ["LAWMIND_PLATFORM_PROVIDER_DEEPSEEK_API_KEY"],
  moonshot: ["LAWMIND_PLATFORM_PROVIDER_MOONSHOT_API_KEY"],
  zhipu: ["LAWMIND_PLATFORM_PROVIDER_ZHIPU_API_KEY"],
};

/** Firm / SaaS operator keys — never exposed via GET /api/models. */
export function resolvePlatformProviderApiKeyFromEnv(
  provider: Exclude<LawMindModelProviderId, "custom" | "platform">,
): string {
  const keys = PLATFORM_PROVIDER_KEY_ENV[provider] ?? [];
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) {
      return v;
    }
  }
  return "";
}

export function isPlatformInferenceAvailable(): boolean {
  if (resolvePlatformProxyFromEnv()) {
    return true;
  }
  const providers: Array<Exclude<LawMindModelProviderId, "custom" | "platform">> = [
    "dashscope",
    "openai",
    "deepseek",
    "moonshot",
    "zhipu",
  ];
  return providers.some((p) => Boolean(resolvePlatformProviderApiKeyFromEnv(p)));
}

export function listPlatformProviderKeyStatus(): Array<{
  provider: Exclude<LawMindModelProviderId, "custom">;
  label: string;
  configured: boolean;
  mode: "proxy" | "platform_key" | "none";
}> {
  const proxy = resolvePlatformProxyFromEnv();
  const providers: Array<Exclude<LawMindModelProviderId, "custom" | "platform">> = [
    "dashscope",
    "openai",
    "deepseek",
    "moonshot",
    "zhipu",
  ];
  return providers.map((p) => {
    const def = getProviderDefinition(p);
    const hasPlatformKey = Boolean(resolvePlatformProviderApiKeyFromEnv(p));
    return {
      provider: p,
      label: def.label,
      configured: Boolean(proxy) || hasPlatformKey,
      mode: proxy ? "proxy" : hasPlatformKey ? "platform_key" : "none",
    };
  });
}
