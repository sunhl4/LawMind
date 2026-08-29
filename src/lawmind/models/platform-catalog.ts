import type { BuiltinModelDefinition } from "./types.js";

const DASHSCOPE = "https://dashscope.aliyuncs.com/compatible-mode/v1";

/**
 * Platform-hosted catalog (Cursor-style): selectable in UI without exposing API keys.
 * Keys resolve from LAWMIND_PLATFORM_* env or LAWMIND_PLATFORM_PROXY_URL + access token.
 */
export const LAWMIND_PLATFORM_MODELS: BuiltinModelDefinition[] = [
  {
    id: "platform:qwen-plus",
    kind: "builtin",
    label: "通义千问 Plus",
    description: "LawMind 平台模型 · 无需自备 Key",
    provider: "dashscope",
    baseUrl: DASHSCOPE,
    model: "qwen-plus",
    group: "平台模型",
    contextTokens: 32_768,
  },
  {
    id: "platform:qwen-turbo",
    kind: "builtin",
    label: "通义千问 Turbo",
    provider: "dashscope",
    baseUrl: DASHSCOPE,
    model: "qwen-turbo",
    group: "平台模型",
    contextTokens: 8_192,
  },
  {
    id: "platform:qwen-max",
    kind: "builtin",
    label: "通义千问 Max",
    provider: "dashscope",
    baseUrl: DASHSCOPE,
    model: "qwen-max",
    group: "平台模型",
    contextTokens: 32_768,
  },
  {
    id: "platform:gpt-4o-mini",
    kind: "builtin",
    label: "GPT-4o mini",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    group: "平台模型",
    contextTokens: 128_000,
  },
];

export function getPlatformModelById(id: string): BuiltinModelDefinition | undefined {
  return LAWMIND_PLATFORM_MODELS.find((m) => m.id === id);
}
