/**
 * 子工循环的公共原语：消息/结果类型、轮次解析、工具调用解析、律师可读标签。
 *
 * 主路径（`sample-until-done`）与旧实现（`readonly-worker-loop` 里的
 * `LAWMIND_WORKER_LEGACY_LOOP=1`）都从这里取，避免两套解析与两套文案。
 */

import { presentLawyerToolCall } from "./tool-lawyer-card.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentTool } from "./types.js";

/**
 * 子工默认轮次。律师常一次给二三十份材料，5 轮会提前收工；默认 8 轮，
 * 显式 override 与环境变量仍可收紧（上限 12）。
 */
export const DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS = 8;

/** 旧实现的轮次默认（`LAWMIND_WORKER_LEGACY_LOOP=1` 时沿用 5 轮）。 */
export const LEGACY_DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS = 5;

/** Shown on the parent tool card while this sidecar waits for a model slot. */
export const WORKER_MODEL_WAIT_LABEL = "子工在等模型空位";

export type WorkerLoopMessage = {
  role: string;
  content: string;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
  reasoning_content?: string;
};

export type WorkerToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments: string;
};

export type WorkerModelChoice = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
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
  /** Transcript of this sidecar only. Not written into the parent history. */
  messages: WorkerLoopMessage[];
  aborted?: boolean;
  error?: string;
};

export function resolveReadonlyWorkerMaxRounds(
  override?: number,
  fallback: number = DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS,
): number {
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
  return fallback;
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

export function extractWorkerToolCalls(response: WorkerModelChoice): WorkerToolCall[] {
  const calls = response.choices?.[0]?.message?.tool_calls ?? [];
  const out: WorkerToolCall[] = [];
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

/** Shown while the sidecar model is sampling, before an inner tool starts. */
export function sidecarWaitLabel(roleLabel: string): string {
  if (roleLabel === "写稿工") {
    return "正在写稿";
  }
  if (roleLabel === "审查工") {
    return "正在审查";
  }
  if (roleLabel === "探查工") {
    return "正在探查目录";
  }
  return "正在办理";
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

/**
 * 旧实现开关：`LAWMIND_WORKER_LEGACY_LOOP=1` 时回到 8K 平切 / 5 轮的旧循环。
 * 计划要求保留一个版本以便回滚。
 */
export function workerLegacyLoopEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.LAWMIND_WORKER_LEGACY_LOOP ?? "").trim() === "1";
}
