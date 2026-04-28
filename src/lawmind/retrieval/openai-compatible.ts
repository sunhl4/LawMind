/**
 * OpenAI-compatible retrieval adapter factory.
 *
 * 目标：
 * - 允许 LawMind 在不绑定具体厂商 SDK 的情况下接入真实模型
 * - 兼容 OpenAI 风格 /v1/chat/completions 接口
 */

import type { RetrievalAdapter } from "./index.js";
import { createGeneralModelAdapter, createLegalModelAdapter } from "./model-adapters.js";
import type { ModelRetrievalInput, ModelRetrievalOutput } from "./model-adapters.js";

type OpenAICompatibleClientConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
};

type CreateOpenAICompatibleAdaptersParams = {
  general?: OpenAICompatibleClientConfig;
  legal?: OpenAICompatibleClientConfig;
};

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildMessages(input: ModelRetrievalInput, role: "general" | "legal"): ChatMessage[] {
  const system =
    role === "legal"
      ? [
          "你是法律检索助手。输出必须保守、准确、可回溯。",
          "只输出 JSON，不要输出 markdown。",
          "JSON schema:",
          '{ "claims":[{"text":"string","confidence":0.0}], "sources":[{"title":"string","citation":"string","url":"string"}], "riskFlags":["string"], "missingItems":["string"] }',
        ].join("\n")
      : [
          "你是信息检索整理助手。输出结构化摘要，避免编造来源。",
          "只输出 JSON，不要输出 markdown。",
          "JSON schema:",
          '{ "claims":[{"text":"string","confidence":0.0}], "sources":[{"title":"string","citation":"string","url":"string"}], "riskFlags":["string"], "missingItems":["string"] }',
        ].join("\n");

  const user = [
    `任务类型: ${input.intent.kind}`,
    `任务摘要: ${input.intent.summary}`,
    `目标受众: ${input.intent.audience ?? "未指定"}`,
    "",
    "通用长期记忆:",
    input.memory.general || "(空)",
    "",
    "律师偏好记忆:",
    input.memory.profile || "(空)",
    "",
    "客户画像（长期合作，与单案事实区分；供检索整理时把握沟通与机构习惯）:",
    input.memory.clientProfile || "(空)",
    "",
    "最近日志（今天）:",
    input.memory.todayLog || "(空)",
    "",
    "最近日志（昨天）:",
    input.memory.yesterdayLog || "(空)",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 部分模型会返回 ```json 包裹，这里尝试剥离
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "");
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      return null;
    }
  }
}

async function callOpenAICompatible(
  cfg: OpenAICompatibleClientConfig,
  input: ModelRetrievalInput,
  role: "general" | "legal",
): Promise<ModelRetrievalOutput> {
  const timeoutMs = cfg.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${trimSlash(cfg.baseUrl)}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature ?? 0.1,
        response_format: { type: "json_object" },
        messages: buildMessages(input, role),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        claims: [],
        riskFlags: [`模型调用失败: HTTP ${res.status}`],
        missingItems: ["模型未返回有效结果"],
      };
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return {
        claims: [],
        riskFlags: ["模型返回为空"],
        missingItems: ["模型未返回结构化内容"],
      };
    }

    const parsed = safeJsonParse<ModelRetrievalOutput>(content);
    if (!parsed) {
      return {
        claims: [],
        riskFlags: ["模型返回非 JSON，已拒绝注入 claims"],
        missingItems: ["请重试并检查模型输出格式"],
      };
    }

    return {
      claims: parsed.claims ?? [],
      sources: parsed.sources ?? [],
      riskFlags: parsed.riskFlags ?? [],
      missingItems: parsed.missingItems ?? [],
    };
  } catch (err) {
    return {
      claims: [],
      riskFlags: [`模型调用异常: ${String(err)}`],
      missingItems: ["模型调用失败，请稍后重试"],
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 根据配置创建真实模型检索适配器（通用 + 法律）。
 * 未配置的角色不会返回适配器。
 */
export function createOpenAICompatibleAdapters(
  params: CreateOpenAICompatibleAdaptersParams,
): RetrievalAdapter[] {
  const adapters: RetrievalAdapter[] = [];

  if (params.general) {
    adapters.push(
      createGeneralModelAdapter((input) =>
        callOpenAICompatible(params.general as OpenAICompatibleClientConfig, input, "general"),
      ),
    );
  }

  if (params.legal) {
    adapters.push(
      createLegalModelAdapter((input) =>
        callOpenAICompatible(params.legal as OpenAICompatibleClientConfig, input, "legal"),
      ),
    );
  }

  return adapters;
}
