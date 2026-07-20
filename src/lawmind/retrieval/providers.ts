/**
 * Provider presets and adapter builders.
 *
 * 目标：
 * - 提供国内通用模型 API 接入口（OpenAI-compatible 风格）
 * - 提供法律专用模型（ChatLaw / LaWGPT）和 LexEdge 框架适配入口
 * - 为后续合作方本地部署模型预留统一扩展点
 */

import type { RetrievalAdapter } from "./index.js";
import { createLegalModelAdapter, type ModelRetriever } from "./model-adapters.js";
import { createOpenAICompatibleAdapters } from "./openai-compatible.js";

type GeneralProviderKey = "qwen" | "deepseek" | "glm" | "moonshot" | "siliconflow";

type ProviderPreset = {
  baseUrl: string;
  modelEnv: string;
  keyEnv: string;
};

const GENERAL_PROVIDER_PRESETS: Record<GeneralProviderKey, ProviderPreset> = {
  // 阿里云 DashScope OpenAI-compatible 接口
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelEnv: "LAWMIND_QWEN_MODEL",
    keyEnv: "LAWMIND_QWEN_API_KEY",
  },
  // DeepSeek OpenAI-compatible 接口
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    modelEnv: "LAWMIND_DEEPSEEK_MODEL",
    keyEnv: "LAWMIND_DEEPSEEK_API_KEY",
  },
  // 智谱 GLM 开放平台（OpenAI-compatible 路径）
  glm: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    modelEnv: "LAWMIND_GLM_MODEL",
    keyEnv: "LAWMIND_GLM_API_KEY",
  },
  // Moonshot / Kimi OpenAI-compatible 接口
  moonshot: {
    baseUrl: "https://api.moonshot.cn/v1",
    modelEnv: "LAWMIND_MOONSHOT_MODEL",
    keyEnv: "LAWMIND_MOONSHOT_API_KEY",
  },
  // SiliconFlow（常见免费额度入口，具体配额按平台策略）
  siliconflow: {
    baseUrl: "https://api.siliconflow.cn/v1",
    modelEnv: "LAWMIND_SILICONFLOW_MODEL",
    keyEnv: "LAWMIND_SILICONFLOW_API_KEY",
  },
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * 从环境变量创建国内通用模型适配器（可并行启用多个）。
 *
 * 用法示例：
 * - 设置 LAWMIND_QWEN_API_KEY + LAWMIND_QWEN_MODEL
 * - 设置 LAWMIND_DEEPSEEK_API_KEY + LAWMIND_DEEPSEEK_MODEL
 */
export function createDomesticGeneralAdaptersFromEnv(): RetrievalAdapter[] {
  const adapters: RetrievalAdapter[] = [];
  for (const [provider, preset] of Object.entries(GENERAL_PROVIDER_PRESETS) as Array<
    [GeneralProviderKey, ProviderPreset]
  >) {
    const apiKey = env(preset.keyEnv);
    const model = env(preset.modelEnv);
    if (!apiKey || !model) {
      continue;
    }
    adapters.push(
      ...createOpenAICompatibleAdapters({
        general: {
          baseUrl: preset.baseUrl,
          apiKey,
          model,
        },
      }).map((a) => ({ ...a, name: `model-general-${provider}` })),
    );
  }
  return adapters;
}

/**
 * ChatLaw / LaWGPT 本地部署适配（通常通过 vLLM / one-api / lmdeploy 暴露 OpenAI-compatible API）。
 *
 * 环境变量：
 * - LAWMIND_CHATLAW_BASE_URL / LAWMIND_CHATLAW_API_KEY / LAWMIND_CHATLAW_MODEL
 * - LAWMIND_LAWGPT_BASE_URL / LAWMIND_LAWGPT_API_KEY / LAWMIND_LAWGPT_MODEL
 */
export function createOpenSourceLegalAdaptersFromEnv(): RetrievalAdapter[] {
  const adapters: RetrievalAdapter[] = [];

  const chatlawBase = env("LAWMIND_CHATLAW_BASE_URL");
  const chatlawKey = env("LAWMIND_CHATLAW_API_KEY") ?? "local";
  const chatlawModel = env("LAWMIND_CHATLAW_MODEL");
  if (chatlawBase && chatlawModel) {
    adapters.push(
      ...createOpenAICompatibleAdapters({
        legal: {
          baseUrl: chatlawBase,
          apiKey: chatlawKey,
          model: chatlawModel,
        },
      }).map((a) => ({ ...a, name: "model-legal-chatlaw" })),
    );
  }

  const lawgptBase = env("LAWMIND_LAWGPT_BASE_URL");
  const lawgptKey = env("LAWMIND_LAWGPT_API_KEY") ?? "local";
  const lawgptModel = env("LAWMIND_LAWGPT_MODEL");
  if (lawgptBase && lawgptModel) {
    adapters.push(
      ...createOpenAICompatibleAdapters({
        legal: {
          baseUrl: lawgptBase,
          apiKey: lawgptKey,
          model: lawgptModel,
        },
      }).map((a) => ({ ...a, name: "model-legal-lawgpt" })),
    );
  }

  return adapters;
}

/**
 * LexEdge **opt-in 集成占位**（stub），非桌面 agent 检索热路径。
 *
 * - 桌面引擎 `buildAdaptersFromEnv`（`engine-tool-shared.ts`）**不包含**本适配器。
 * - 仅 CLI `scripts/lawmind/lawmind-engine-adapters.ts` 在 spread 时可能纳入。
 * - 未设置 `LAWMIND_LEXEDGE_ENDPOINT` 时恒返回 `[]`（stub 态）。
 *
 * 假设 LexEdge 服务暴露 HTTP endpoint，返回与 `ModelRetrievalOutput` 同结构 JSON；
 * 后续团队可按真实接口替换为更具体的 client。
 */
export function createLexEdgeAdapterFromEnv(): RetrievalAdapter[] {
  const endpoint = env("LAWMIND_LEXEDGE_ENDPOINT");
  if (!endpoint) {
    return [];
  }

  const token = env("LAWMIND_LEXEDGE_TOKEN");
  const run: ModelRetriever = async ({ intent, memory }) => {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ intent, memory }),
      });
      if (!res.ok) {
        return {
          claims: [],
          riskFlags: [`LexEdge 调用失败: HTTP ${res.status}`],
          missingItems: ["LexEdge 暂不可用"],
        };
      }
      return (await res.json()) as Awaited<ReturnType<ModelRetriever>>;
    } catch (err) {
      return {
        claims: [],
        riskFlags: [`LexEdge 调用异常: ${String(err)}`],
        missingItems: ["LexEdge 调用失败"],
      };
    }
  };

  return [createLegalModelAdapter(run)].map((a) => ({ ...a, name: "model-legal-lexedge" }));
}

/**
 * 合作方本地部署扩展位（后续接入其他专用法律模型时沿用）。
 *
 * 约定：
 * - base URL: LAWMIND_PARTNER_LEGAL_BASE_URL
 * - model: LAWMIND_PARTNER_LEGAL_MODEL
 * - key: LAWMIND_PARTNER_LEGAL_API_KEY（可选，本地可填 local）
 */
export function createPartnerLegalAdapterFromEnv(): RetrievalAdapter[] {
  const baseUrl = env("LAWMIND_PARTNER_LEGAL_BASE_URL");
  const model = env("LAWMIND_PARTNER_LEGAL_MODEL");
  const apiKey = env("LAWMIND_PARTNER_LEGAL_API_KEY") ?? "local";
  if (!baseUrl || !model) {
    return [];
  }
  return createOpenAICompatibleAdapters({
    legal: { baseUrl, apiKey, model },
  }).map((a) => ({ ...a, name: "model-legal-partner" }));
}
