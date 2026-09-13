import type { LawMindModelProviderId } from "./types.js";

export type ProviderDefinition = {
  id: Exclude<LawMindModelProviderId, "custom">;
  label: string;
  defaultBaseUrl: string;
  /** Env vars checked in order (first non-empty wins). */
  apiKeyEnvKeys: string[];
};

export const LAWMIND_MODEL_PROVIDERS: ProviderDefinition[] = [
  {
    id: "dashscope",
    label: "阿里云 DashScope / 通义",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnvKeys: ["LAWMIND_PROVIDER_DASHSCOPE_API_KEY", "LAWMIND_QWEN_API_KEY"],
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyEnvKeys: ["LAWMIND_PROVIDER_OPENAI_API_KEY", "OPENAI_API_KEY"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    apiKeyEnvKeys: [
      "LAWMIND_PROVIDER_DEEPSEEK_API_KEY",
      "LAWMIND_DEEPSEEK_API_KEY",
      "DEEPSEEK_API_KEY",
    ],
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnvKeys: ["LAWMIND_PROVIDER_MOONSHOT_API_KEY", "MOONSHOT_API_KEY"],
  },
  {
    id: "zhipu",
    label: "智谱 AI",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnvKeys: ["LAWMIND_PROVIDER_ZHIPU_API_KEY", "ZHIPU_API_KEY"],
  },
];

/** Strip trailing slash and optional `/v1` so `api.deepseek.com` matches the catalog URL. */
export function normalizeModelBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/v1$/i, "").toLowerCase();
}

export type BuiltinProviderId = Exclude<LawMindModelProviderId, "custom" | "platform">;

/**
 * Map an OpenAI-compatible Base URL to a builtin provider.
 * Empty URL follows the product default (DeepSeek).
 */
export function inferProviderIdFromBaseUrl(baseUrl: string | undefined): BuiltinProviderId | null {
  const fallback = getProviderDefinition("deepseek").defaultBaseUrl;
  const n = normalizeModelBaseUrl(baseUrl?.trim() ? baseUrl : fallback);
  for (const p of LAWMIND_MODEL_PROVIDERS) {
    if (p.id === "platform") {
      continue;
    }
    if (normalizeModelBaseUrl(p.defaultBaseUrl) === n) {
      return p.id as BuiltinProviderId;
    }
  }
  return null;
}

/** Wizard `LAWMIND_AGENT_*` key, only for the provider that matches the wizard Base URL. */
export function resolveWizardApiKeyForProvider(provider: BuiltinProviderId): string {
  const key = process.env.LAWMIND_AGENT_API_KEY?.trim() || "";
  if (!key) {
    return "";
  }
  const url =
    process.env.LAWMIND_AGENT_BASE_URL?.trim() || process.env.LAWMIND_QWEN_BASE_URL?.trim() || "";
  const inferred = inferProviderIdFromBaseUrl(url || undefined);
  return inferred === provider ? key : "";
}

/**
 * Old wizard copies wrote DeepSeek URL + key onto LAWMIND_QWEN_*.
 * Those must not light up DashScope rows.
 */
export function qwenEnvIsLeftoverAlias(): boolean {
  const qwenUrl = process.env.LAWMIND_QWEN_BASE_URL?.trim() || "";
  if (!qwenUrl) {
    return false;
  }
  const inferred = inferProviderIdFromBaseUrl(qwenUrl);
  return inferred !== null && inferred !== "dashscope";
}

export function getProviderDefinition(
  provider: Exclude<LawMindModelProviderId, "custom">,
): ProviderDefinition {
  const row = LAWMIND_MODEL_PROVIDERS.find((p) => p.id === provider);
  if (!row) {
    throw new Error(`unknown_provider:${provider}`);
  }
  return row;
}

export function resolveProviderApiKeyFromEnv(
  provider: Exclude<LawMindModelProviderId, "custom">,
): string {
  if (provider === "platform") {
    return "";
  }
  const wizard = resolveWizardApiKeyForProvider(provider);
  if (wizard) {
    return wizard;
  }
  const def = getProviderDefinition(provider);
  for (const key of def.apiKeyEnvKeys) {
    if (provider === "dashscope" && key === "LAWMIND_QWEN_API_KEY" && qwenEnvIsLeftoverAlias()) {
      continue;
    }
    const v = process.env[key]?.trim();
    if (v) {
      return v;
    }
  }
  return "";
}

export function listProviderKeyStatus(): Array<{
  provider: Exclude<LawMindModelProviderId, "custom">;
  label: string;
  configured: boolean;
  envKeys: string[];
}> {
  return LAWMIND_MODEL_PROVIDERS.map((p) => ({
    provider: p.id,
    label: p.label,
    configured: Boolean(resolveProviderApiKeyFromEnv(p.id)),
    envKeys: p.apiKeyEnvKeys,
  }));
}
