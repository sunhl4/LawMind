/**
 * Isolated read-only tool loop for draft_worker.
 * Not runTurn: no compact, playbook, CORE catalog, or approval pipeline.
 * The model may only execute the allowlisted read tools, then must return a draft.
 */

import { conformalQhatFor, formatFactorReadingLine } from "./factor-state.js";
import {
  buildReadonlyToolRegistry,
  DEFAULT_READONLY_WORKER_MAX_TOOL_ROUNDS,
  runReadonlyWorkerLoop,
  type ReadonlyWorkerLoopResult,
  type WorkerLoopMessage,
} from "./readonly-worker-loop.js";
import { exploreFolderTool } from "./tools/legal/explore-folder-tool.js";
import { analyzeDocument } from "./tools/legal/file-tools.js";
import { listDirTool } from "./tools/legal/list-dir-tool.js";
import { readProjectFile, searchCaseLaw, searchStatute } from "./tools/legal/search-tools.js";
import type { AgentContext, AgentModelConfig, AgentTool } from "./types.js";

/** On-demand reader for anchors the worker already saw in its marginal or boundary. */
export const DRAFT_WORKER_ANCHOR_TOOL_NAME = "read_marginal_anchor";

export const DRAFT_WORKER_READONLY_TOOL_NAMES = [
  "analyze_document",
  "explore_folder",
  "list_dir",
  DRAFT_WORKER_ANCHOR_TOOL_NAME,
  "read_project_file",
  "search_case_law",
  "search_statute",
] as const;

export const readMarginalAnchorTool: AgentTool = {
  definition: {
    name: DRAFT_WORKER_ANCHOR_TOOL_NAME,
    description:
      "按锚名读取当前子工边际或约化边界里列出的锚的已核读数。只接受提示里列出的锚；读不到就按缺口处理，不要编造。",
    category: "search",
    parameters: {
      anchor: {
        type: "string",
        description: "锚名，例如 citation:labor-47 或 amount:wage",
        required: true,
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const anchor = typeof params.anchor === "string" ? params.anchor.trim() : "";
    if (!anchor) {
      return { ok: false, error: "缺少 anchor。" };
    }
    const readable = ctx.readableFactorAnchors ?? [];
    if (!readable.includes(anchor)) {
      return {
        ok: false,
        error: `${anchor} 不在本子工可读范围；只读边际或边界里列出的锚，读不到就写缺口。`,
      };
    }
    const line = formatFactorReadingLine(
      ctx.factorState,
      anchor,
      conformalQhatFor(ctx.factorState),
    );
    if (!line) {
      return { ok: false, error: `${anchor} 没有已核读数；按缺口处理，不要编造。` };
    }
    return { ok: true, data: { anchor, line } };
  },
};

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
      readMarginalAnchorTool,
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
  /** Anchors this worker may pull on demand: marginal plus named boundary. */
  readableAnchors?: readonly string[];
  /** 默认是写稿收尾。协作问答传入自己的收尾，避免被要求输出文书 JSON。 */
  closePrompt?: string;
  roleLabel?: string;
}): Promise<ReadonlyWorkerLoopResult> {
  const { readableAnchors, ...rest } = opts;
  return runReadonlyWorkerLoop({
    ...rest,
    ctx: {
      ...rest.ctx,
      readableFactorAnchors: readableAnchors ? [...readableAnchors] : undefined,
    },
    allowlist: DRAFT_WORKER_READONLY_TOOL_NAMES,
    registry: draftWorkerReadonlyRegistry(),
    roleLabel: rest.roleLabel ?? "写稿工",
    closePrompt:
      rest.closePrompt ??
      "只读工具轮次已用尽。请立刻按任务输出草稿（JSON 或【正文】【出处】【缺口】）。不要再调用工具。",
  });
}
