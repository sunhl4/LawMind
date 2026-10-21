/**
 * 共享采样内核：子工（只读 sidecar）在工具轮里「采样 → 执行 → 收窄」直到完成。
 *
 * 不是 runTurn：无 compact 摘要、无 playbook、无审批管线。
 * 「压缩」= 工具回包收窄（头尾截断），不做历史摘要——子工没有父子历史。
 */

import { createModelUsageRecorder } from "../models/model-usage.js";
import { toolTableFingerprint } from "../models/tool-table-fingerprint.js";
import { withLeafToolSlot } from "../runtime/tool-concurrency.js";
import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
import { runSamplingLoop, sampleModelDecision } from "./sampling-loop.js";
import {
  MID_TURN_PRUNE_KEEP_RECENT,
  MID_TURN_PRUNE_MAX_TOKENS,
  pruneToolResultsInHistory,
} from "./session-tool-result-prune.js";
import { resolveToolDecisionMaxTokens } from "./tool-decision-sampling.js";
import {
  resolveToolResultHistoryTokens,
  stringifyToolResultForHistory,
} from "./tool-result-history.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { AgentContext, AgentModelConfig, ToolCallResult } from "./types.js";
import {
  extractWorkerToolCalls,
  formatSidecarProgressLabel,
  resolveReadonlyWorkerMaxRounds,
  sidecarWaitLabel,
  WORKER_MODEL_WAIT_LABEL,
  type ReadonlyWorkerLoopResult,
  type WorkerLoopMessage,
  type WorkerModelChoice,
  type WorkerToolCall,
} from "./worker-loop-shared.js";

export type SampleUntilDoneOpts = {
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
};

function openaiTools(registry: ToolRegistry, names: readonly string[]): unknown[] {
  return registry.toOpenAITools({ names: [...names] });
}

function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return work;
  }
  if (signal.aborted) {
    return Promise.reject(new ModelCallUserAbortError());
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new ModelCallUserAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

async function executeAllowlistedTool(
  call: WorkerToolCall,
  ctx: AgentContext,
  registry: ToolRegistry,
  allowlist: readonly string[],
  roleLabel: string,
): Promise<ToolCallResult> {
  if (ctx.abortSignal?.aborted) {
    throw new ModelCallUserAbortError();
  }
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
    const result = await withLeafToolSlot(
      () =>
        raceAbort(
          tool.execute(call.arguments, { ...ctx, inReadonlyWorkerLoop: true }),
          ctx.abortSignal,
        ),
      { signal: ctx.abortSignal },
    );
    ctx.emitToolProgress?.(
      formatSidecarProgressLabel(call.name, call.arguments, result.ok ? "ok" : "fail"),
    );
    return result;
  } catch (err) {
    if (err instanceof ModelCallUserAbortError || ctx.abortSignal?.aborted) {
      throw err instanceof ModelCallUserAbortError ? err : new ModelCallUserAbortError();
    }
    const message = err instanceof Error ? err.message : String(err);
    ctx.emitToolProgress?.(formatSidecarProgressLabel(call.name, call.arguments, "fail"));
    return { ok: false, error: `只读工具失败：${message}` };
  }
}

/**
 * 子工历史收窄：保留最近几条工具回包，旧回包按主路径同类预算头尾截断
 * （复用 `summarizeToolResultForHistory` 的头尾保留，不整段平切）。
 */
export function narrowWorkerToolResults(
  messages: WorkerLoopMessage[],
  opts?: { maxTokens?: number; keepRecent?: number },
): { prunedCount: number } {
  const projection = messages.map((message) => ({
    role: message.role as import("./types.js").AgentMessage["role"],
    content: message.content,
    timestamp: "",
  }));
  const result = pruneToolResultsInHistory(projection, {
    maxTokens: opts?.maxTokens ?? MID_TURN_PRUNE_MAX_TOKENS,
    keepRecent: opts?.keepRecent ?? MID_TURN_PRUNE_KEEP_RECENT,
  });
  result.messages.forEach((message, index) => {
    if (message.content !== messages[index]?.content) {
      messages[index] = { ...messages[index], content: message.content };
    }
  });
  return { prunedCount: result.prunedCount };
}

/** 采样直到模型不再要工具；轮次用尽则强制收尾一次。 */
export async function sampleUntilDone(
  opts: SampleUntilDoneOpts,
): Promise<ReadonlyWorkerLoopResult> {
  const signal = opts.abortSignal ?? opts.ctx.abortSignal;
  const allowlist = opts.allowlist;
  const workerCtx: AgentContext = opts.abortSignal
    ? { ...opts.ctx, abortSignal: opts.abortSignal }
    : opts.ctx;
  const messages = [...opts.messages];
  const toolsUsed: string[] = [];
  const steps: Array<{ tool: string; ok: boolean }> = [];
  const groundingParts: string[] = [];
  const decisionFlags = { emptyChoiceRetryUsed: false };
  const maxRounds = resolveReadonlyWorkerMaxRounds(opts.maxToolRounds);
  const contextTokens = opts.model.contextTokens;
  const resultBudgetTokens = resolveToolResultHistoryTokens(contextTokens);
  const modelCfg = {
    ...opts.model,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    temperature: opts.temperature,
    maxRetries: 0,
  };

  const sample = async (tools: unknown[], maxTokens: number) => {
    let waited = false;
    return callModelWithRetry({ ...modelCfg, maxTokens }, messages, tools, {
      signal,
      admission: { sessionId: opts.ctx.sessionId, kind: "worker" },
      onModelUsage: createModelUsageRecorder(opts.ctx.workspaceDir, {
        sessionId: opts.ctx.sessionId,
        turnId: opts.ctx.turnId,
        matterId: opts.ctx.matterId,
        model: modelCfg.model,
        provider: modelCfg.provider,
        purpose: "worker",
        billingScope: opts.ctx.billingScope,
        toolTableFingerprint: toolTableFingerprint(tools),
      }),
      onAdmissionWait: () => {
        waited = true;
        workerCtx.emitToolProgress?.(WORKER_MODEL_WAIT_LABEL);
      },
      onAdmissionGranted: () => {
        if (!waited) {
          return;
        }
        waited = false;
        workerCtx.emitToolProgress?.(sidecarWaitLabel(opts.roleLabel));
      },
    });
  };

  const done = (partial: Omit<ReadonlyWorkerLoopResult, "messages">): ReadonlyWorkerLoopResult => ({
    ...partial,
    messages,
  });

  const stopped = (): ReadonlyWorkerLoopResult => {
    const paired = new Set(
      messages.filter((message) => message.role === "tool").map((message) => message.tool_call_id),
    );
    for (const message of messages) {
      for (const call of message.tool_calls ?? []) {
        if (call.id && !paired.has(call.id)) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              aborted: true,
              error: "已停止，工具结果未取得。",
            }),
          });
          paired.add(call.id);
        }
      }
    }
    return done({
      text: "",
      grounding: groundingParts.join("\n"),
      toolsUsed,
      steps,
      aborted: true,
    });
  };

  try {
    const completed = await runSamplingLoop<ReadonlyWorkerLoopResult>({
      maxRounds,
      step: async () => {
        if (signal?.aborted) {
          return stopped();
        }
        workerCtx.emitToolProgress?.(sidecarWaitLabel(opts.roleLabel));
        const tools = openaiTools(opts.registry, allowlist);
        const decisionMax =
          resolveToolDecisionMaxTokens(opts.maxTokens, tools.length > 0) ?? opts.maxTokens;
        const { response } = await sampleModelDecision<WorkerModelChoice>({
          sample: async (mode) =>
            sample(
              tools,
              mode === "deliverable" ? opts.maxTokens : decisionMax,
            ) as Promise<WorkerModelChoice>,
          toolsAdvertised: tools.length > 0,
          configuredMaxTokens: opts.maxTokens,
          flags: decisionFlags,
          onRaiseOutput: () =>
            workerCtx.emitToolProgress?.(
              opts.roleLabel === "写稿工" ? "正在写成交件" : sidecarWaitLabel(opts.roleLabel),
            ),
        });
        const calls = extractWorkerToolCalls(response);
        const text = (response.choices?.[0]?.message?.content ?? "").trim();
        if (calls.length === 0) {
          if (text) {
            messages.push({ role: "assistant", content: text });
          }
          return done({ text, grounding: groundingParts.join("\n"), toolsUsed, steps });
        }

        const openaiCalls = calls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.rawArguments },
        }));
        const reasoning = response.choices?.[0]?.message?.reasoning_content?.trim() ?? "";
        messages.push({
          role: "assistant",
          content: text,
          tool_calls: openaiCalls,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
        });

        if (signal?.aborted) {
          return stopped();
        }
        const results = await raceAbort(
          Promise.all(
            calls.map((call) =>
              executeAllowlistedTool(call, workerCtx, opts.registry, allowlist, opts.roleLabel),
            ),
          ),
          signal,
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
            maxTokens: resultBudgetTokens,
            contextTokens,
          });
          groundingParts.push(serialized);
          messages.push({
            role: "tool",
            content: serialized,
            tool_call_id: call.id,
          });
        }
        // 多轮后收窄旧回包：30 份材料不再把上下文塞满，也不会 8K 平切丢事实尾部。
        narrowWorkerToolResults(messages);
        return "continue";
      },
    });
    if (completed) {
      return completed;
    }

    if (signal?.aborted) {
      return stopped();
    }
    messages.push({
      role: "user",
      content: opts.closePrompt,
    });
    workerCtx.emitToolProgress?.(
      opts.roleLabel === "写稿工" ? "正在写成交件" : sidecarWaitLabel(opts.roleLabel),
    );
    const closing = (await sample([], opts.maxTokens)) as WorkerModelChoice;
    const text = (closing.choices?.[0]?.message?.content ?? "").trim();
    if (text) {
      messages.push({ role: "assistant", content: text });
    }
    return done({ text, grounding: groundingParts.join("\n"), toolsUsed, steps });
  } catch (err) {
    if (err instanceof ModelCallUserAbortError || signal?.aborted) {
      return stopped();
    }
    const message = err instanceof Error ? err.message : String(err);
    return done({
      text: "",
      grounding: groundingParts.join("\n"),
      toolsUsed,
      steps,
      error: message,
    });
  }
}
