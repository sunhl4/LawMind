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

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const cleaned = stripMarkdownFence(raw);
    try {
      return JSON.parse(cleaned) as T;
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
 * Call /v1/chat/completions with response_format json_object; return parsed JSON or null.
 */
export async function completeJsonObject<T>(
  cfg: OpenAiJsonClientConfig,
  messages: Array<{ role: ChatRole; content: string }>,
): Promise<T | null> {
  const limits = sidecarLimits(cfg);
  const timeoutMs = cfg.timeoutMs ?? limits.timeoutMs;
  const attempts = modelAttemptBudget();
  const url = `${trimSlash(cfg.baseUrl)}/chat/completions`;
  const body = JSON.stringify({
    model: cfg.model,
    temperature: cfg.temperature ?? limits.temperature,
    max_tokens: limits.maxTokens,
    response_format: { type: "json_object" },
    messages,
  });

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
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
      const parsed = view.text ? safeJsonParse<T>(view.text) : null;
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
