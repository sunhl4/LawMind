/**
 * Bounded read-only sidecar tool loop shared by draft_worker / explore_folder.
 * Not runTurn: no compact, playbook, CORE catalog, or approval pipeline.
 */

import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
import { presentLawyerToolCall } from "./tool-lawyer-card.js";
import { stringifyToolResultForHistory } from "./tool-result-history.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentContext, AgentModelConfig, AgentTool, ToolCallResult } from "./types.js";

export const DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS = 5;

const MAX_TOOL_RESULT_CHARS = 8_000;

export type WorkerLoopMessage = {
  role: string;
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
};

type AssistantToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments: string;
};

type ModelChoice = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
};

export type ReadonlyWorkerLoopResult = {
  text: string;
  grounding: string;
  toolsUsed: string[];
  steps: Array<{ tool: string; ok: boolean }>;
  aborted?: boolean;
  error?: string;
};

export function resolveReadonlyWorkerMaxRounds(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 1) {
    return Math.min(12, Math.floor(override));
  }
  const raw = process.env.LAWMIND_READONLY_WORKER_MAX_ROUNDS?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) {
      return Math.min(12, Math.floor(n));
    }
  }
  return DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS;
}

export function extractWorkerToolCalls(response: ModelChoice): AssistantToolCall[] {
  const calls = response.choices?.[0]?.message?.tool_calls ?? [];
  const out: AssistantToolCall[] = [];
  for (const [index, call] of calls.entries()) {
    const name = call.function?.name?.trim() ?? "";
    if (!name) {
      continue;
    }
    const rawArguments =
      typeof call.function?.arguments === "string" ? call.function.arguments : "{}";
    out.push({
      id: call.id?.trim() || `readonly-worker-${index + 1}`,
      name,
      arguments: parseToolArgs(rawArguments),
      rawArguments,
    });
  }
  return out;
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* invalid JSON from the model */
  }
  return {};
}

function openaiTools(registry: ToolRegistry, names: readonly string[]): unknown[] {
  return registry.toOpenAITools({ names: [...names] });
}

async function executeAllowlistedTool(
  call: AssistantToolCall,
  ctx: AgentContext,
  registry: ToolRegistry,
  allowlist: readonly string[],
  roleLabel: string,
): Promise<ToolCallResult> {
  if (!allowlist.includes(call.name)) {
    return {
      ok: false,
      error: `${roleLabel}不能调用 ${call.name}。只读工具：${allowlist.join("、")}。`,
    };
  }
  const tool = registry.get(call.name);
  if (!tool) {
    return { ok: false, error: `未注册只读工具：${call.name}` };
  }
  try {
    ctx.emitToolProgress?.(formatSidecarProgressLabel(call.name, call.arguments, "start"));
    const result = await tool.execute(call.arguments, { ...ctx, inReadonlyWorkerLoop: true });
    ctx.emitToolProgress?.(
      formatSidecarProgressLabel(call.name, call.arguments, result.ok ? "ok" : "fail"),
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.emitToolProgress?.(formatSidecarProgressLabel(call.name, call.arguments, "fail"));
    return { ok: false, error: `只读工具失败：${message}` };
  }
}

/** Lawyer-facing inner-step labels for explore/draft sidecars. */
export function formatSidecarProgressLabel(
  tool: string,
  args: Record<string, unknown>,
  phase: "start" | "ok" | "fail",
): string {
  const card = presentLawyerToolCall(tool, args);
  const title = card.detail ? `${card.title} · ${card.detail}` : card.title;
  if (phase === "start") {
    return title.startsWith("正在") ? title : `正在${title}`;
  }
  if (phase === "ok") {
    return `已完成 · ${title}`;
  }
  return `未读到 · ${title}`;
}

export function buildReadonlyToolRegistry(tools: AgentTool[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of tools) {
    registry.register(tool);
  }
  return registry;
}

export async function runReadonlyWorkerLoop(opts: {
  model: AgentModelConfig;
  maxTokens: number;
  timeoutMs: number;
  temperature: number;
  messages: WorkerLoopMessage[];
  ctx: AgentContext;
  allowlist: readonly string[];
  registry: ToolRegistry;
  roleLabel: string;
  closePrompt: string;
  maxToolRounds?: number;
  abortSignal?: AbortSignal;
  onStep?: (step: { tool: string; ok: boolean }) => void;
}): Promise<ReadonlyWorkerLoopResult> {
  const allowlist = opts.allowlist;
  const messages = [...opts.messages];
  const toolsUsed: string[] = [];
  const steps: Array<{ tool: string; ok: boolean }> = [];
  const groundingParts: string[] = [];
  const maxRounds = resolveReadonlyWorkerMaxRounds(opts.maxToolRounds);
  const modelCfg = {
    ...opts.model,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    temperature: opts.temperature,
    maxRetries: 0,
  };

  const sample = async (tools: unknown[]) =>
    callModelWithRetry(modelCfg, messages, tools, { signal: opts.abortSignal });

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      const response = (await sample(openaiTools(opts.registry, allowlist))) as ModelChoice;
      if (!response?.choices?.[0]) {
        return {
          text: "",
          grounding: groundingParts.join("\n"),
          toolsUsed,
          steps,
          error: `${opts.roleLabel}模型无返回`,
        };
      }
      const calls = extractWorkerToolCalls(response);
      const text = (response.choices?.[0]?.message?.content ?? "").trim();
      if (calls.length === 0) {
        return { text, grounding: groundingParts.join("\n"), toolsUsed, steps };
      }

      const openaiCalls = calls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.rawArguments },
      }));
      messages.push({
        role: "assistant",
        content: text,
        tool_calls: openaiCalls,
      });

      const results = await Promise.all(
        calls.map((call) =>
          executeAllowlistedTool(call, opts.ctx, opts.registry, allowlist, opts.roleLabel),
        ),
      );
      for (const [index, call] of calls.entries()) {
        const result = results[index] ?? { ok: false, error: "工具无返回" };
        const step = { tool: call.name, ok: result.ok };
        steps.push(step);
        opts.onStep?.(step);
        if (allowlist.includes(call.name) && result.ok) {
          toolsUsed.push(call.name);
        }
        const serialized = stringifyToolResultForHistory(result, {
          maxChars: MAX_TOOL_RESULT_CHARS,
        });
        groundingParts.push(serialized);
        messages.push({
          role: "tool",
          content: serialized,
          tool_call_id: call.id,
        });
      }
    }

    messages.push({
      role: "user",
      content: opts.closePrompt,
    });
    const closing = (await sample([])) as ModelChoice;
    const text = (closing.choices?.[0]?.message?.content ?? "").trim();
    return { text, grounding: groundingParts.join("\n"), toolsUsed, steps };
  } catch (err) {
    if (err instanceof ModelCallUserAbortError || opts.abortSignal?.aborted) {
      return { text: "", grounding: groundingParts.join("\n"), toolsUsed, steps, aborted: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { text: "", grounding: groundingParts.join("\n"), toolsUsed, steps, error: message };
  }
}
