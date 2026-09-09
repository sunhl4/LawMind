/**
 * Model HTTP call with retry.
 */

import { computeRetryDelayMs, isRetryableHttpFailure } from "../llm/http-retry.js";
import { createOutboundProxy } from "../platform/outbound-proxy.js";
import type { AgentModelConfig } from "./types.js";

/** 模型单次调用超时（起草等任务可能较慢，60s 减少 aborted） */
const DEFAULT_MODEL_TIMEOUT_MS = 60000;
const DEFAULT_MODEL_MAX_RETRIES = 2;

const modelProxy = createOutboundProxy({ requestTag: "model-api" });

export class ModelCallUserAbortError extends Error {
  readonly name = "ModelCallUserAbortError";
  constructor(message = "Model request cancelled (user stop).") {
    super(message);
  }
}

function formatModelFetchError(
  err: unknown,
  config: AgentModelConfig,
  timeoutMs: number,
  opts?: { userAbort?: boolean },
): Error {
  if (opts?.userAbort || err instanceof ModelCallUserAbortError) {
    return err instanceof ModelCallUserAbortError ? err : new ModelCallUserAbortError();
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new Error(
      `Model request timed out after ${timeoutMs}ms. Check network or increase LAWMIND_AGENT_TIMEOUT_MS in .env.lawmind.`,
    );
  }
  const cause =
    err instanceof Error && "cause" in err && err.cause instanceof Error ? err.cause.message : "";
  const msg = err instanceof Error ? err.message : String(err);
  const combined = `${msg} ${cause}`.trim();
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|certificate|TLS/i.test(combined)) {
    return new Error(
      `Model network error: ${combined}. Verify baseUrl (${config.baseUrl}), DNS, proxy, and firewall.`,
    );
  }
  return err instanceof Error ? err : new Error(combined || "Model call failed");
}

/** Combine timeout abort with optional external (Stop button) signal. */
export function combineAbortSignals(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void; wasUserAbort: () => boolean } {
  const timeoutController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  }
  let removeExternal: (() => void) | undefined;

  if (external) {
    const onExternal = () => {
      timeoutController.abort();
    };
    if (external.aborted) {
      timeoutController.abort();
    } else {
      external.addEventListener("abort", onExternal, { once: true });
      removeExternal = () => external.removeEventListener("abort", onExternal);
    }
  }

  const signal =
    external && timeoutMs <= 0
      ? external
      : timeoutMs <= 0
        ? new AbortController().signal
        : timeoutController.signal;

  return {
    signal,
    cleanup: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      removeExternal?.();
    },
    wasUserAbort: () => Boolean(external?.aborted),
  };
}

/** Streaming chunk shape (OpenAI SSE `data: {...}` lines). */
type ChatCompletionStreamChunk = {
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

type ChatCompletionMessage = {
  role: "assistant" | "user" | "system" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type ChatCompletionResponse = {
  choices: Array<{ message: ChatCompletionMessage; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export type CallModelOptions = {
  /** Request streaming SSE; deltas are pushed via `onDelta` and finally assembled to ChatCompletionResponse. */
  stream?: boolean;
  /** Per-chunk content delta (final round only). */
  onDelta?: (chunk: string) => void;
  /** When aborted (e.g. Stop button), cancel in-flight fetch/stream. */
  signal?: AbortSignal;
};

/** Accumulate streaming chunks into a final `ChatCompletionResponse` shape. */
export function aggregateStreamChunks(chunks: ChatCompletionStreamChunk[]): ChatCompletionResponse {
  let role = "assistant";
  let content = "";
  let finishReason = "stop";
  type ToolCallAcc = {
    id: string;
    name: string;
    args: string;
  };
  const toolCalls = new Map<number, ToolCallAcc>();
  let usage: ChatCompletionResponse["usage"];

  for (const chunk of chunks) {
    const choice = chunk.choices?.[0];
    if (!choice) {
      if (chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens ?? 0,
          completion_tokens: chunk.usage.completion_tokens ?? 0,
          total_tokens: chunk.usage.total_tokens ?? 0,
        };
      }
      continue;
    }
    const delta = choice.delta ?? {};
    if (delta.role) {
      role = delta.role;
    }
    if (typeof delta.content === "string") {
      content += delta.content;
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const acc = toolCalls.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) {
          acc.id = tc.id;
        }
        if (tc.function?.name) {
          acc.name = tc.function.name;
        }
        if (typeof tc.function?.arguments === "string") {
          acc.args += tc.function.arguments;
        }
        toolCalls.set(idx, acc);
      }
    }
    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
    if (chunk.usage) {
      usage = {
        prompt_tokens: chunk.usage.prompt_tokens ?? 0,
        completion_tokens: chunk.usage.completion_tokens ?? 0,
        total_tokens: chunk.usage.total_tokens ?? 0,
      };
    }
  }

  const message: ChatCompletionMessage = {
    role: role as "assistant",
    content: content || null,
  };
  if (toolCalls.size > 0) {
    message.tool_calls = [...toolCalls.entries()]
      .toSorted(([a], [b]) => a - b)
      .map(([, acc]) => ({
        id: acc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        type: "function" as const,
        function: { name: acc.name, arguments: acc.args || "{}" },
      }));
  }

  return {
    choices: [{ message, finish_reason: finishReason }],
    usage,
  };
}

/** Parse one SSE buffer (may contain multiple `\n\n`-separated events). */
export function parseSseChunks(buffer: string): {
  events: ChatCompletionStreamChunk[];
  rest: string;
  done: boolean;
} {
  const events: ChatCompletionStreamChunk[] = [];
  let done = false;
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) {
      continue;
    }
    const payload = dataLines.join("\n");
    if (payload === "[DONE]") {
      done = true;
      continue;
    }
    try {
      events.push(JSON.parse(payload) as ChatCompletionStreamChunk);
    } catch {
      /* skip malformed chunk */
    }
  }
  return { events, rest, done };
}

/**
 * 调用 OpenAI-compatible chat completions API
 */
async function callModelOnce(
  config: AgentModelConfig,
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>,
  tools: unknown[],
  opts: CallModelOptions = {},
): Promise<ChatCompletionResponse> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const timeoutMs = config.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: config.temperature ?? 0.3,
  };

  if (config.maxTokens) {
    body.max_tokens = config.maxTokens;
  }

  if (Array.isArray(config.stop) && config.stop.length > 0) {
    body.stop = config.stop.filter((s) => typeof s === "string" && s.length > 0).slice(0, 8);
  }

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const wantStream = opts.stream === true;
  if (wantStream) {
    body.stream = true;
  }

  if (opts.signal?.aborted) {
    throw new ModelCallUserAbortError();
  }

  const combined = combineAbortSignals(timeoutMs, opts.signal);
  let response: Response;
  try {
    response = await modelProxy.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...(wantStream ? { Accept: "text/event-stream" } : {}),
      },
      body: JSON.stringify(body),
      signal: combined.signal,
    });
  } catch (err) {
    throw formatModelFetchError(err, config, timeoutMs, {
      userAbort: combined.wasUserAbort(),
    });
  }

  if (!response.ok) {
    combined.cleanup();
    const text = await response.text();
    const is404 = response.status === 404;
    const attempted = `model="${config.model}" baseUrl=${config.baseUrl}`;
    let hint = "";
    if (is404) {
      hint =
        " 常见原因：模型名与端点不匹配（自定义模型请确认「模型 ID」填写的值正是该 Base URL 所支持的名称，不是 LawMind 内部的 custom:xxx；向导模型请确认 LAWMIND_AGENT_MODEL 与实际一致）。也可能是 Base URL 缺少 /v1 后缀、模型名大小写/后缀不符、或该 Key 无权限访问此模型。";
    }
    throw new Error(
      `Model API error ${response.status} (${attempted}): ${text.slice(0, 300)}${hint}`,
    );
  }

  if (!wantStream || !response.body) {
    combined.cleanup();
    return (await response.json()) as ChatCompletionResponse;
  }

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: ChatCompletionStreamChunk[] = [];
    let buffer = "";
    let suppressDeltas = false;
    while (true) {
      if (opts.signal?.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new ModelCallUserAbortError();
      }
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunks(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) {
          chunks.push(event);
          const delta = event.choices?.[0]?.delta;
          if (delta?.tool_calls && delta.tool_calls.length > 0) {
            suppressDeltas = true;
          }
          const deltaContent = delta?.content;
          if (
            !suppressDeltas &&
            typeof deltaContent === "string" &&
            deltaContent.length > 0 &&
            opts.onDelta
          ) {
            try {
              opts.onDelta(deltaContent);
            } catch {
              /* ignore consumer errors */
            }
          }
        }
        if (parsed.done) {
          break;
        }
      }
      if (done) {
        break;
      }
    }
    return aggregateStreamChunks(chunks);
  } catch (err) {
    throw formatModelFetchError(err, config, timeoutMs, {
      userAbort: combined.wasUserAbort() || err instanceof ModelCallUserAbortError,
    });
  } finally {
    combined.cleanup();
  }
}

export async function callModelWithRetry(
  config: AgentModelConfig,
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>,
  tools: unknown[],
  opts: CallModelOptions = {},
): Promise<ChatCompletionResponse> {
  const maxRetries = config.maxRetries ?? DEFAULT_MODEL_MAX_RETRIES;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await callModelOnce(config, messages, tools, opts);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Never retry user Stop — that would ignore the lawyer's cancel.
      if (
        err instanceof ModelCallUserAbortError ||
        opts.signal?.aborted ||
        attempt >= maxRetries ||
        !isRetryableHttpFailure(err)
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, computeRetryDelayMs(attempt)));
    }
  }
  throw lastError ?? new Error("Model call failed");
}
