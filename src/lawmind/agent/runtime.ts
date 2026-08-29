/**
 * LawMind Agent Runtime — 自主推理循环
 *
 * 核心 loop：
 *   1. 收到用户指令
 *   2. 构建 system prompt（包含律师 profile、案件上下文、可用工具）
 *   3. 发送给 LLM，附带 function calling tools
 *   4. LLM 决定调用工具 → 执行工具 → 把结果返还给 LLM
 *   5. 重复 3-4 直到 LLM 给出最终回答
 *   6. 保存 session，记录审计
 *
 * 与 reference agent stack 的差异：
 *   - reference agent stack 基于 pi-agent-core / pi-coding-agent
 *   - LawMind 直接使用 OpenAI compatible API + 自建工具调度
 *   - 但设计理念相同：LLM 驱动的自主推理 + tool use
 */

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
export { callModelWithRetry } from "./runtime-model-call.js";
export { runTurn, type RunTurnEvent } from "./turn-orchestrator.js";

export { validateToolArguments } from "./runtime-tool-validation.js";
