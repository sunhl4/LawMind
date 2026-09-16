/**
 * OpenAI-compatible retrieval adapter factory.
 *
 * 目标：
 * - 允许 LawMind 在不绑定具体厂商 SDK 的情况下接入真实模型
 * - 兼容 OpenAI 风格 /v1/chat/completions 接口
 */

import {
  assistantOutputLooksTruncated,
  extractAssistantText,
  shouldResampleSidecarJson,
} from "../agent/assistant-text.js";
import {
  modelAttemptBudget,
  shouldRetryTransportFailure,
  waitModelRetry,
} from "../llm/http-retry.js";
import { PROMPT_WINDOW, truncateForPrompt } from "../memory/prompt-windows.js";
import { resolveClassifySidecarLimits } from "../models/capability-envelope.js";
import { createOutboundProxy } from "../platform/outbound-proxy.js";
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
    truncateForPrompt(input.memory.general, PROMPT_WINDOW.retrievalMemoryChars) || "(空)",
    "",
    "律师偏好记忆:",
    truncateForPrompt(input.memory.profile, PROMPT_WINDOW.lawyerFingerprintChars, {
      overflow: { tool: "read_workspace_file", path: "LAWYER_PROFILE.md" },
    }) || "(空)",
    "",
    "客户画像（长期合作，与单案事实区分；供检索整理时把握沟通与机构习惯）:",
    truncateForPrompt(input.memory.clientProfile, PROMPT_WINDOW.clientFingerprintChars, {
      overflow: { tool: "read_workspace_file", path: "CLIENT_PROFILE.md" },
    }) || "(空)",
    "",
    "最近日志（今天）:",
    truncateForPrompt(input.memory.todayLog, PROMPT_WINDOW.dayLogIndexChars, {
      overflow: { tool: "read_workspace_file", path: "memory/today.md" },
    }) || "(空)",
    "",
    "最近日志（昨天）:",
    truncateForPrompt(input.memory.yesterdayLog, PROMPT_WINDOW.dayLogIndexChars, {
      overflow: { tool: "read_workspace_file", path: "memory/yesterday.md" },
    }) || "(空)",
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
      // Broader: first JSON object in the blob
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

/**
 * When the model ignores JSON mode, salvage markdown/plain text as a single
 * low-confidence claim instead of returning empty claims.
 */
export function fallbackRetrievalFromNonJson(content: string): ModelRetrievalOutput {
  const cleaned = content
    .trim()
    .replace(/^```(?:json|markdown|md|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const claimText = cleaned.slice(0, 2_500);
  if (!claimText) {
    return {
      claims: [],
      riskFlags: ["模型返回非 JSON，且无可提取文本"],
      missingItems: ["请重试并检查模型输出格式"],
    };
  }
  return {
    claims: [{ text: claimText, confidence: 0.35 }],
    sources: [],
    riskFlags: ["模型未返回合法 JSON，已降级为纯文本摘要（请人工核对，勿直接当权威出处）"],
    missingItems: ["结构化来源缺失，请核对原文与法规库"],
  };
}

const retrievalProxy = createOutboundProxy({ requestTag: "retrieval-openai" });

const EMPTY_RETRIEVAL: ModelRetrievalOutput = {
  claims: [],
  riskFlags: ["模型返回为空"],
  missingItems: ["模型未返回结构化内容"],
};

type RetrievalOnce =
  | { type: "ok"; value: ModelRetrievalOutput; truncated: boolean }
  | { type: "unusable"; text: string; truncated: boolean }
  | { type: "fatal"; value: ModelRetrievalOutput };

async function fetchOpenAICompatibleOnce(
  cfg: OpenAICompatibleClientConfig,
  input: ModelRetrievalInput,
  role: "general" | "legal",
  externalSignal?: AbortSignal,
): Promise<RetrievalOnce> {
  const sidecar = resolveClassifySidecarLimits({ timeoutMs: cfg.timeoutMs });
  const timeoutMs = cfg.timeoutMs ?? sidecar.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  try {
    const url = `${trimSlash(cfg.baseUrl)}/chat/completions`;
    const res = await retrievalProxy.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature ?? sidecar.temperature,
        max_tokens: sidecar.maxTokens,
        response_format: { type: "json_object" },
        messages: buildMessages(input, role),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = new Error(`模型调用失败: HTTP ${res.status}`);
      if (shouldRetryTransportFailure(err, { httpStatus: res.status, signal: externalSignal })) {
        throw err;
      }
      return {
        type: "fatal",
        value: {
          claims: [],
          riskFlags: [`模型调用失败: HTTP ${res.status}`],
          missingItems: ["模型未返回有效结果"],
        },
      };
    }

    const json = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | null; reasoning_content?: string | null };
        finish_reason?: string | null;
      }>;
    };
    const view = extractAssistantText(json);
    const truncated = assistantOutputLooksTruncated(view);
    if (!view.text) {
      return { type: "unusable", text: "", truncated };
    }

    const parsed = safeJsonParse<ModelRetrievalOutput>(view.text);
    if (!parsed) {
      return { type: "unusable", text: view.text, truncated };
    }

    return {
      type: "ok",
      truncated,
      value: {
        claims: parsed.claims ?? [],
        sources: parsed.sources ?? [],
        riskFlags: parsed.riskFlags ?? [],
        missingItems: parsed.missingItems ?? [],
      },
    };
  } catch (err) {
    if (externalSignal?.aborted) {
      return {
        type: "fatal",
        value: {
          claims: [],
          riskFlags: ["模型调用已取消"],
          missingItems: ["律师已停止"],
        },
      };
    }
    if (shouldRetryTransportFailure(err, { signal: externalSignal })) {
      throw err;
    }
    return {
      type: "fatal",
      value: {
        claims: [],
        riskFlags: [`模型调用异常: ${String(err)}`],
        missingItems: ["模型调用失败，请稍后重试"],
      },
    };
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

async function callOpenAICompatible(
  cfg: OpenAICompatibleClientConfig,
  input: ModelRetrievalInput,
  role: "general" | "legal",
  signal?: AbortSignal,
): Promise<ModelRetrievalOutput> {
  const attempts = modelAttemptBudget();
  let lastUnusable = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) {
      return {
        claims: [],
        riskFlags: ["模型调用已取消"],
        missingItems: ["律师已停止"],
      };
    }
    try {
      const once = await fetchOpenAICompatibleOnce(cfg, input, role, signal);
      if (once.type === "fatal") {
        return once.value;
      }
      if (once.type === "ok") {
        if (
          shouldResampleSidecarJson({
            parsed: true,
            truncated: once.truncated,
            attempt,
            attempts,
          })
        ) {
          await waitModelRetry(attempt);
          continue;
        }
        return once.value;
      }
      lastUnusable = once.text;
      if (
        shouldResampleSidecarJson({
          parsed: false,
          truncated: once.truncated,
          attempt,
          attempts,
        })
      ) {
        await waitModelRetry(attempt);
        continue;
      }
      return lastUnusable ? fallbackRetrievalFromNonJson(lastUnusable) : EMPTY_RETRIEVAL;
    } catch (err) {
      if (attempt + 1 < attempts && shouldRetryTransportFailure(err, { signal })) {
        await waitModelRetry(attempt);
        continue;
      }
      return {
        claims: [],
        riskFlags: [`模型调用异常: ${String(err)}`],
        missingItems: ["模型调用失败，请稍后重试"],
      };
    }
  }
  return lastUnusable ? fallbackRetrievalFromNonJson(lastUnusable) : EMPTY_RETRIEVAL;
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
        callOpenAICompatible(
          params.general as OpenAICompatibleClientConfig,
          input,
          "general",
          input.signal,
        ),
      ),
    );
  }

  if (params.legal) {
    adapters.push(
      createLegalModelAdapter((input) =>
        callOpenAICompatible(
          params.legal as OpenAICompatibleClientConfig,
          input,
          "legal",
          input.signal,
        ),
      ),
    );
  }

  return adapters;
}
