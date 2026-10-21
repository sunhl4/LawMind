/**
 * Bounded read-only sidecar tool loop shared by draft_worker / explore_folder.
 * Not runTurn: no compact, playbook, CORE catalog, or approval pipeline.
 *
 * 2026-10-21：默认走共享内核 `sample-until-done`（与主路径同一套头尾截断、
 * 同一套取消语义、同一套回包预算）。旧实现在 `LAWMIND_WORKER_LEGACY_LOOP=1`
 * 时仍可切回，保留一个版本以便回滚。
 */

import { createModelUsageRecorder } from "../models/model-usage.js";
import { toolTableFingerprint } from "../models/tool-table-fingerprint.js";
import { withLeafToolSlot } from "../runtime/tool-concurrency.js";
import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
import { sampleUntilDone } from "./sample-until-done.js";
import {
  resolveToolDecisionMaxTokens,
  shouldRaiseToolDecisionOutput,
} from "./tool-decision-sampling.js";
import { stringifyToolResultForHistory } from "./tool-result-history.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentContext, AgentModelConfig, ToolCallResult } from "./types.js";
import {
  extractWorkerToolCalls,
  formatSidecarProgressLabel,
  LEGACY_DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS,
  resolveReadonlyWorkerMaxRounds,
  sidecarWaitLabel,
  WORKER_MODEL_WAIT_LABEL,
  workerLegacyLoopEnabled,
  type ReadonlyWorkerLoopResult,
  type WorkerLoopMessage,
  type WorkerModelChoice,
  type WorkerToolCall,
} from "./worker-loop-shared.js";

export {
  buildReadonlyToolRegistry,
  DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS,
  extractWorkerToolCalls,
  formatSidecarProgressLabel,
  resolveReadonlyWorkerMaxRounds,
  sidecarWaitLabel,
  WORKER_MODEL_WAIT_LABEL,
  workerLegacyLoopEnabled,
} from "./worker-loop-shared.js";
export type {
  ReadonlyWorkerLoopResult,
  WorkerLoopMessage,
  WorkerModelChoice,
  WorkerToolCall,
} from "./worker-loop-shared.js";

/** 旧实现的平切上限；新实现按 token 预算头尾截断。 */
const LEGACY_MAX_TOOL_RESULT_CHARS = 8_000;

export type RunReadonlyWorkerLoopOpts = {
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

/**
 * 子工循环入口：默认走共享内核；`LAWMIND_WORKER_LEGACY_LOOP=1` 时回到旧实现。
 */
export async function runReadonlyWorkerLoop(
  opts: RunReadonlyWorkerLoopOpts,
): Promise<ReadonlyWorkerLoopResult> {
  if (workerLegacyLoopEnabled()) {
    return runReadonlyWorkerLoopLegacy(opts);
  }
  return sampleUntilDone(opts);
}

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

/** 旧实现（5 轮 / 8K 平切）：仅作回滚开关保留。 */
async function runReadonlyWorkerLoopLegacy(
  opts: RunReadonlyWorkerLoopOpts,
): Promise<ReadonlyWorkerLoopResult> {
  const allowlist = opts.allowlist;
  const workerCtx: AgentContext = opts.abortSignal
    ? { ...opts.ctx, abortSignal: opts.abortSignal }
    : opts.ctx;
  const messages = [...opts.messages];
  const toolsUsed: string[] = [];
  const steps: Array<{ tool: string; ok: boolean }> = [];
  const groundingParts: string[] = [];
  const maxRounds = resolveReadonlyWorkerMaxRounds(
    opts.maxToolRounds,
    LEGACY_DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS,
  );
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
      signal: opts.abortSignal,
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

  const stopped = (): ReadonlyWorkerLoopResult =>
    done({
      text: "",
      grounding: groundingParts.join("\n"),
      toolsUsed,
      steps,
      aborted: true,
    });

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      if (opts.abortSignal?.aborted) {
        return stopped();
      }
      workerCtx.emitToolProgress?.(sidecarWaitLabel(opts.roleLabel));
      const tools = openaiTools(opts.registry, allowlist);
      const decisionMax =
        resolveToolDecisionMaxTokens(opts.maxTokens, tools.length > 0) ?? opts.maxTokens;
      let response = (await sample(tools, decisionMax)) as WorkerModelChoice;
      const firstChoice = response?.choices?.[0];
      if (
        firstChoice &&
        shouldRaiseToolDecisionOutput({
          toolsAdvertised: tools.length > 0,
          configuredMaxTokens: opts.maxTokens,
          finishReason: firstChoice.finish_reason,
        })
      ) {
        workerCtx.emitToolProgress?.(
          opts.roleLabel === "写稿工" ? "正在写成交件" : sidecarWaitLabel(opts.roleLabel),
        );
        response = (await sample(tools, opts.maxTokens)) as WorkerModelChoice;
      }
      if (!response?.choices?.[0]) {
        return done({
          text: "",
          grounding: groundingParts.join("\n"),
          toolsUsed,
          steps,
          error: `${opts.roleLabel}模型无返回`,
        });
      }
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

      if (opts.abortSignal?.aborted) {
        return stopped();
      }
      const results = await raceAbort(
        Promise.all(
          calls.map((call) =>
            executeAllowlistedTool(call, workerCtx, opts.registry, allowlist, opts.roleLabel),
          ),
        ),
        opts.abortSignal,
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
          maxChars: LEGACY_MAX_TOOL_RESULT_CHARS,
        });
        groundingParts.push(serialized);
        messages.push({
          role: "tool",
          content: serialized,
          tool_call_id: call.id,
        });
      }
    }

    if (opts.abortSignal?.aborted) {
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
    if (err instanceof ModelCallUserAbortError || opts.abortSignal?.aborted) {
      return done({
        text: "",
        grounding: groundingParts.join("\n"),
        toolsUsed,
        steps,
        aborted: true,
      });
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
