import type { BuiltinModelDefinition } from "./types.js";

const DASHSCOPE = "https://dashscope.aliyuncs.com/compatible-mode/v1";

/** Curated built-in models (Cursor-style picker). Keys come from env per provider. */
export const LAWMIND_BUILTIN_MODELS: BuiltinModelDefinition[] = [
  // 通义千问
  {
    id: "builtin:qwen-plus",
    kind: "builtin",
    label: "通义千问 Plus",
    description: "均衡质量与速度，日常法律对话推荐",
    provider: "dashscope",
    baseUrl: DASHSCOPE,
    model: "qwen-plus",
    group: "通义千问",
    contextTokens: 32_768,
  },
  {
    id: "builtin:qwen-turbo",
    kind: "builtin",
    label: "通义千问 Turbo",
    description: "更快、成本更低",
    provider: "dashscope",
    baseUrl: DASHSCOPE,
    model: "qwen-turbo",
    group: "通义千问",
    contextTokens: 8_192,
  },
  {
    id: "builtin:qwen-max",
    kind: "builtin",
    label: "通义千问 Max",
    description: "更强推理与长文",
    provider: "dashscope",
    baseUrl: DASHSCOPE,
    model: "qwen-max",
    group: "通义千问",
    contextTokens: 32_768,
  },
  {
    id: "builtin:qwen3.5-plus",
    kind: "builtin",
    label: "通义千问 3.5 Plus",
    provider: "dashscope",
    baseUrl: DASHSCOPE,
    model: "qwen3.5-plus",
    group: "通义千问",
    contextTokens: 131_072,
  },
  // OpenAI
  {
    id: "builtin:gpt-4o",
    kind: "builtin",
    label: "GPT-4o",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    group: "OpenAI",
    contextTokens: 128_000,
  },
  {
    id: "builtin:gpt-4o-mini",
    kind: "builtin",
    label: "GPT-4o mini",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    group: "OpenAI",
    contextTokens: 128_000,
  },
  {
    id: "builtin:o1-mini",
    kind: "builtin",
    label: "o1-mini",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "o1-mini",
    group: "OpenAI",
    contextTokens: 128_000,
    tags: ["推理"],
  },
  // DeepSeek
  {
    id: "builtin:deepseek-chat",
    kind: "builtin",
    label: "DeepSeek Chat",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    group: "DeepSeek",
    contextTokens: 64_000,
  },
  {
    id: "builtin:deepseek-reasoner",
    kind: "builtin",
    label: "DeepSeek Reasoner",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-reasoner",
    group: "DeepSeek",
    contextTokens: 64_000,
    tags: ["推理"],
  },
  // Moonshot
  {
    id: "builtin:moonshot-v1-8k",
    kind: "builtin",
    label: "Moonshot v1 8K",
    provider: "moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    group: "Moonshot",
    contextTokens: 8_192,
  },
  // 智谱
  {
    id: "builtin:glm-4-flash",
    kind: "builtin",
    label: "GLM-4 Flash",
    provider: "zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    group: "智谱",
    contextTokens: 128_000,
  },
  {
    id: "builtin:glm-4-plus",
    kind: "builtin",
    label: "GLM-4 Plus",
    provider: "zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-plus",
    group: "智谱",
    contextTokens: 128_000,
  },
];

export function getBuiltinModelById(id: string): BuiltinModelDefinition | undefined {
  return LAWMIND_BUILTIN_MODELS.find((m) => m.id === id);
}

export function builtinIdForEnvModelName(modelName: string): string | undefined {
  const norm = modelName.trim().toLowerCase();
  if (!norm) {
    return undefined;
  }
  const exact = LAWMIND_BUILTIN_MODELS.find((m) => m.model.toLowerCase() === norm);
  if (exact) {
    return exact.id;
  }
  if (norm === "qwen3.5-plus" || norm === "qwen-plus-latest") {
    return "builtin:qwen3.5-plus";
  }
  return undefined;
}
