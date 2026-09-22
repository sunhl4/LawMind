/**
 * Isolated read-only tool loop for draft_worker.
 * Not runTurn: no compact, playbook, CORE catalog, or approval pipeline.
 * The model may only execute the allowlisted read tools, then must return a draft.
 */

import {
  buildReadonlyToolRegistry,
  DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS,
  extractWorkerToolCalls,
  runReadonlyWorkerLoop,
  type ReadonlyWorkerLoopResult,
  type WorkerLoopMessage,
} from "./readonly-worker-loop.js";
import { exploreFolderTool } from "./tools/legal/explore-folder-tool.js";
import { analyzeDocument } from "./tools/legal/file-tools.js";
import { listDirTool } from "./tools/legal/list-dir-tool.js";
import { readProjectFile, searchCaseLaw, searchStatute } from "./tools/legal/search-tools.js";
import type { AgentContext, AgentModelConfig, AgentTool } from "./types.js";

export const DRAFT_WORKER_READONLY_TOOL_NAMES = [
  "analyze_document",
  "explore_folder",
  "list_dir",
  "read_project_file",
  "search_case_law",
  "search_statute",
] as const;

/** @deprecated Prefer resolveReadonlyWorkerMaxRounds / DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS */
export const DRAFT_WORKER_MAX_TOOL_ROUNDS = DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS;

export {
  extractWorkerToolCalls,
  DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS,
  resolveReadonlyWorkerMaxRounds,
} from "./readonly-worker-loop.js";
export type { WorkerLoopMessage, ReadonlyWorkerLoopResult };

let cachedRegistry: ReturnType<typeof buildReadonlyToolRegistry> | undefined;

export function draftWorkerReadonlyRegistry() {
  if (!cachedRegistry) {
    cachedRegistry = buildReadonlyToolRegistry([
      analyzeDocument,
      exploreFolderTool,
      listDirTool,
      readProjectFile,
      searchCaseLaw,
      searchStatute,
    ] satisfies AgentTool[]);
  }
  return cachedRegistry;
}

export async function runDraftWorkerReadOnlyLoop(opts: {
  model: AgentModelConfig;
  maxTokens: number;
  timeoutMs: number;
  temperature: number;
  messages: WorkerLoopMessage[];
  ctx: AgentContext;
  abortSignal?: AbortSignal;
  maxToolRounds?: number;
  onStep?: (step: { tool: string; ok: boolean }) => void;
}): Promise<ReadonlyWorkerLoopResult> {
  return runReadonlyWorkerLoop({
    ...opts,
    allowlist: DRAFT_WORKER_READONLY_TOOL_NAMES,
    registry: draftWorkerReadonlyRegistry(),
    roleLabel: "写稿工",
    closePrompt:
      "只读工具轮次已用尽。请立刻按任务输出草稿（JSON 或【正文】【出处】【缺口】）。不要再调用工具。",
  });
}
