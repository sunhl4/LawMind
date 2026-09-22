/**
 * Minimal OpenAI-compatible JSON chat completion helper (LawMind internal).
 * Used by model-driven router / reasoning when retrieval adapters are not involved.
 */

import {
  assistantOutputLooksTruncated,
  extractAssistantText,
  shouldResampleSidecarJson,
} from "../agent/assistant-text.js";
import {
  resolveCapabilityEnvelope,
  resolveTemperatureForTask,
  type CapabilityTaskKind,
} from "../models/capability-envelope.js";
import { createOutboundProxy } from "../platform/outbound-proxy.js";
import { modelAttemptBudget, shouldRetryTransportFailure, waitModelRetry } from "./http-retry.js";
import {
  looksLikeStrictSchemaRejection,
  markStrictSchemaRejected,
  resolveJsonSchemaMode,
  type JsonResponseFormatMode,
} from "./json-schema-capability.js";

/**
 * 调用方提供的 JSON Schema（P2.1）。给出后，支持 strict 的端点会把
 * 「结构上不可能返回非法值」变成协议保证；不支持的端点自动退回 `json_object`。
 *
 * 注意：schema 必须满足 OpenAI strict 模式的子集约束（所有属性 required、
 * 根为 object、`additionalProperties: false`）。不满足时端点会 400 —— 本模块会
 * 识别并回落，但调用方应尽量写合规的 schema。
 */
export type JsonResponseSchema = {
  name: string;
  schema: Record<string, unknown>;
};

export type OpenAiJsonClientConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
  /** Sidecar budget; default classify. Draft critic should pass `review`. */
  taskKind?: CapabilityTaskKind;
};

type ChatRole = "system" | "user";

const jsonProxy = createOutboundProxy({ requestTag: "llm-json" });

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function sidecarLimits(cfg: OpenAiJsonClientConfig): {
  maxTokens: number;
  timeoutMs: number;
  temperature: number;
} {
  const taskKind = cfg.taskKind ?? "classify";
  const envelope = resolveCapabilityEnvelope({
    taskKind,
    timeoutMs: cfg.timeoutMs,
  });
  return {
    maxTokens: envelope.maxOutputTokens,
    timeoutMs: envelope.modelTimeoutMs,
    temperature: resolveTemperatureForTask(taskKind, cfg.temperature),
  };
}

function stripMarkdownFence(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = stripMarkdownFence(raw);
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 构造 `response_format`。返回 mode 便于调用方观察/记录是否真的拿到了结构保证。
 */
export function buildJsonResponseFormat(
  baseUrl: string,
  schema: JsonResponseSchema | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { responseFormat: Record<string, unknown>; mode: JsonResponseFormatMode; reason: string } {
  const decision = resolveJsonSchemaMode(baseUrl, env);
  if (!schema || decision.mode === "json_object") {
    return {
      responseFormat: { type: "json_object" },
      mode: "json_object",
      reason: schema ? decision.reason : "no_schema_provided",
    };
  }
  return {
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: schema.name,
        strict: true,
        schema: schema.schema,
      },
    },
    mode: "json_schema",
    reason: decision.reason,
  };
}

/**
 * Call /v1/chat/completions with response_format json_object; return parsed JSON or null.
 *
 * P2.1：若 `opts.schema` 提供了且端点支持 strict，则用 `json_schema`；
 * 端点以 400 拒绝时记入进程内缓存并**用同一次调用的余量**退回 `json_object` 重试，
 * 而不是把这次采样算作失败。
 */
export async function completeJsonObject<T>(
  cfg: OpenAiJsonClientConfig,
  messages: Array<{ role: ChatRole; content: string }>,
  opts?: { schema?: JsonResponseSchema; env?: NodeJS.ProcessEnv },
): Promise<T | null> {
  const limits = sidecarLimits(cfg);
  const timeoutMs = cfg.timeoutMs ?? limits.timeoutMs;
  const attempts = modelAttemptBudget();
  const url = `${trimSlash(cfg.baseUrl)}/chat/completions`;
  const strict = buildJsonResponseFormat(cfg.baseUrl, opts?.schema, opts?.env);
  let responseFormat: Record<string, unknown> = strict.responseFormat;
  let strictDowngraded = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature ?? limits.temperature,
        max_tokens: limits.maxTokens,
        response_format: responseFormat,
        messages,
      });
      const res = await jsonProxy.fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        // strict 被拒：记住该端点，然后**在同一次调用里**降级重试，
        // 不消耗采样预算（否则第一次用 strict 的调用必然白跑一次）。
        if (!strictDowngraded && strict.mode === "json_schema") {
          const errText = await res.text().catch(() => "");
          if (looksLikeStrictSchemaRejection(res.status, errText)) {
            // 返回值只在「首次记录」时为 true；此处无指标通道，不去消费它，
            // 但绝不静默——退回到 json_object 这一事实已经记在进程内缓存里，
            // 可用 `listStrictSchemaRejectedHosts()` 观察。
            markStrictSchemaRejected(cfg.baseUrl);
            responseFormat = { type: "json_object" };
            strictDowngraded = true;
            attempt -= 1; // 本次不计入采样预算
            continue;
          }
        }
        if (
          attempt + 1 < attempts &&
          shouldRetryTransportFailure(undefined, { httpStatus: res.status })
        ) {
          await waitModelRetry(attempt);
          continue;
        }
        return null;
      }
      const json = (await res.json()) as {
        choices?: Array<{
          message?: { content?: string | null; reasoning_content?: string | null };
          finish_reason?: string | null;
        }>;
      };
      const view = extractAssistantText(json);
      const parsed = view.text ? (safeJsonParse(view.text) as T | null) : null;
      if (
        !shouldResampleSidecarJson({
          parsed: parsed !== null,
          truncated: assistantOutputLooksTruncated(view),
          attempt,
          attempts,
        })
      ) {
        return parsed;
      }
      await waitModelRetry(attempt);
    } catch (err) {
      if (attempt + 1 < attempts && shouldRetryTransportFailure(err)) {
        await waitModelRetry(attempt);
        continue;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export function routerLlmConfigFromEnv(): OpenAiJsonClientConfig | null {
  const baseUrl =
    process.env.LAWMIND_ROUTER_BASE_URL ??
    process.env.LAWMIND_AGENT_BASE_URL ??
    process.env.QWEN_BASE_URL;
  const apiKey =
    process.env.LAWMIND_ROUTER_API_KEY ??
    process.env.LAWMIND_AGENT_API_KEY ??
    process.env.QWEN_API_KEY;
  const model =
    process.env.LAWMIND_ROUTER_MODEL ?? process.env.LAWMIND_AGENT_MODEL ?? process.env.QWEN_MODEL;
  if (!baseUrl?.trim() || !apiKey?.trim() || !model?.trim()) {
    return null;
  }
  return {
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
    taskKind: "classify",
    ...(envNumber("LAWMIND_ROUTER_TEMPERATURE") !== undefined
      ? { temperature: envNumber("LAWMIND_ROUTER_TEMPERATURE") }
      : {}),
    ...(envNumber("LAWMIND_ROUTER_TIMEOUT_MS") !== undefined
      ? { timeoutMs: envNumber("LAWMIND_ROUTER_TIMEOUT_MS") }
      : {}),
  };
}

export function reasoningLlmConfigFromEnv(): OpenAiJsonClientConfig | null {
  const baseUrl =
    process.env.LAWMIND_REASONING_BASE_URL ??
    process.env.LAWMIND_AGENT_BASE_URL ??
    process.env.QWEN_BASE_URL;
  const apiKey =
    process.env.LAWMIND_REASONING_API_KEY ??
    process.env.LAWMIND_AGENT_API_KEY ??
    process.env.QWEN_API_KEY;
  const model =
    process.env.LAWMIND_REASONING_MODEL ??
    process.env.LAWMIND_AGENT_MODEL ??
    process.env.QWEN_MODEL;
  if (!baseUrl?.trim() || !apiKey?.trim() || !model?.trim()) {
    return null;
  }
  return {
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
    taskKind: "review",
    ...(envNumber("LAWMIND_REASONING_TEMPERATURE") !== undefined
      ? { temperature: envNumber("LAWMIND_REASONING_TEMPERATURE") }
      : {}),
    ...(envNumber("LAWMIND_REASONING_TIMEOUT_MS") !== undefined
      ? { timeoutMs: envNumber("LAWMIND_REASONING_TIMEOUT_MS") }
      : {}),
  };
}

/** Only LAWMIND_REASONING_* vars — for a dedicated drafting model without chat fallback. */
export function reasoningLlmConfigExplicitFromEnv(): OpenAiJsonClientConfig | null {
  const baseUrl = process.env.LAWMIND_REASONING_BASE_URL?.trim();
  const apiKey = process.env.LAWMIND_REASONING_API_KEY?.trim();
  const model = process.env.LAWMIND_REASONING_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) {
    return null;
  }
  return {
    baseUrl,
    apiKey,
    model,
    taskKind: "review",
    ...(envNumber("LAWMIND_REASONING_TEMPERATURE") !== undefined
      ? { temperature: envNumber("LAWMIND_REASONING_TEMPERATURE") }
      : {}),
    ...(envNumber("LAWMIND_REASONING_TIMEOUT_MS") !== undefined
      ? { timeoutMs: envNumber("LAWMIND_REASONING_TIMEOUT_MS") }
      : {}),
  };
}
