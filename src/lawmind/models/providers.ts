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
    apiKeyEnvKeys: [
      "LAWMIND_PROVIDER_DASHSCOPE_API_KEY",
      "LAWMIND_QWEN_API_KEY",
      "LAWMIND_AGENT_API_KEY",
    ],
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
    apiKeyEnvKeys: ["LAWMIND_PROVIDER_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"],
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
  const def = getProviderDefinition(provider);
  for (const key of def.apiKeyEnvKeys) {
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
