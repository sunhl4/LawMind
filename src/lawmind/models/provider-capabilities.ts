/**
 * Provider 能力表：不同上游对「缓存」「可复现」「结构化输出」的支持不一样。
 *
 * 为什么要有这张表：
 *   - BYOK 与订阅两种计费下，同一份 usage 要能解释成「花了多少钱」和「用了多少额度」；
 *   - 缓存字段有两代口径（`prompt_cache_hit_tokens` 与
 *     `prompt_tokens_details.cached_tokens`），不能写死一个；
 *   - `seed` 只有部分上游支持，可复现模式必须先问表，不能盲发。
 *
 * 表里没有的 provider 一律按「保守未知」处理：不猜缓存、不发 seed。
 * 新增 provider 时只改这张表，不要在调用点写 if。
 */

import { isDeepSeekFlashUpstream } from "./catalog.js";

/** 上游报告缓存的字段形状。 */
export type CacheUsageShape =
  | "deepseek_prompt_cache_hit" // prompt_cache_hit_tokens / prompt_cache_miss_tokens
  | "openai_prompt_tokens_details" // prompt_tokens_details.cached_tokens
  | "both"
  | "none";

export type ProviderCapabilities = {
  /** 稳定 id，便于日志与审计。 */
  id: string;
  /** 律师可见的服务商名。 */
  labelZh: string;
  cacheUsage: CacheUsageShape;
  /** 是否接受 `seed`（可复现模式需要）。 */
  supportsSeed: boolean;
  /** 是否接受 `response_format: {type:"json_object"}`。 */
  supportsJsonObject: boolean;
  /**
   * 计费口径：`byok` 由律师自己的 key 结算；`subscription` 由平台额度结算。
   * 这里只声明「默认属于哪一类」，实际以会话配置为准。
   */
  defaultBillingScope: "byok" | "subscription";
};

const DEEPSEEK: ProviderCapabilities = {
  id: "deepseek",
  labelZh: "DeepSeek",
  cacheUsage: "deepseek_prompt_cache_hit",
  supportsSeed: false,
  supportsJsonObject: true,
  defaultBillingScope: "byok",
};

const DASHSCOPE: ProviderCapabilities = {
  id: "dashscope",
  labelZh: "通义千问",
  cacheUsage: "none",
  supportsSeed: false,
  supportsJsonObject: true,
  defaultBillingScope: "byok",
};

const OPENAI_COMPATIBLE: ProviderCapabilities = {
  id: "openai-compatible",
  labelZh: "OpenAI 兼容服务",
  cacheUsage: "both",
  supportsSeed: false,
  supportsJsonObject: true,
  defaultBillingScope: "byok",
};

const OPENAI: ProviderCapabilities = { ...OPENAI_COMPATIBLE, id: "openai", supportsSeed: true };

const PROVIDERS: readonly ProviderCapabilities[] = [DEEPSEEK, DASHSCOPE, OPENAI_COMPATIBLE];

/** 未知 provider 的保守默认：不假设支持缓存字段、不发 seed。 */
export const UNKNOWN_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  id: "unknown",
  labelZh: "未知服务商",
  cacheUsage: "none",
  supportsSeed: false,
  supportsJsonObject: false,
  defaultBillingScope: "byok",
};

/** 按 provider 名（`AgentModelConfig.provider`）取能力表。 */
export function providerCapabilities(provider?: string | null): ProviderCapabilities {
  const key = (provider ?? "").trim().toLowerCase();
  if (!key) {
    return UNKNOWN_PROVIDER_CAPABILITIES;
  }
  const found = PROVIDERS.find((p) => p.id === key);
  if (found) {
    return found;
  }
  // 常见别名，避免调用点各自映射。
  if (key === "deepseek-chat" || key === "deepseek") {
    return DEEPSEEK;
  }
  if (key === "qwen" || key === "dashscope-compatible-mode" || key === "aliyun") {
    return DASHSCOPE;
  }
  if (key === "custom") {
    return UNKNOWN_PROVIDER_CAPABILITIES;
  }
  if (key === "openai" || key === "azure-openai") {
    return OPENAI;
  }
  return UNKNOWN_PROVIDER_CAPABILITIES;
}

/**
 * 由「provider + 上游模型名」推断能力。
 *
 * 上游名比 provider 更具体：例如 provider 写成 `custom`、模型是 `deepseek-flash`，
 * 缓存字段仍应按 DeepSeek 读。已知模型优先，provider 兜底。
 */
export function resolveProviderCapabilities(input: {
  provider?: string | null;
  model?: string | null;
  baseUrl?: string;
}): ProviderCapabilities {
  const model = (input.model ?? "").trim();
  let host = "";
  try {
    host = new URL(input.baseUrl ?? "").hostname;
  } catch {
    /* Unknown endpoint. */
  }
  if (host.endsWith("dashscope.aliyuncs.com")) {
    return DASHSCOPE;
  }
  if (host === "api.deepseek.com" || /^deepseek-/i.test(model)) {
    return DEEPSEEK;
  }
  if (host === "api.openai.com" || host.endsWith(".openai.azure.com")) {
    return OPENAI;
  }
  if (model && isDeepSeekFlashUpstream(model)) {
    return DEEPSEEK;
  }
  return providerCapabilities(input.provider);
}
