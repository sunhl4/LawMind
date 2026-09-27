import { IDEMPOTENT_READ_TOOLS } from "../agent/tool-name-sets.js";
import type { ToolRegistry } from "../agent/tools/registry.js";

export type ToolCallRef = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolCallBatch = {
  concurrencySafe: boolean;
  calls: ToolCallRef[];
};

export function getMaxToolUseConcurrency(): number {
  const raw = process.env.LAWMIND_MAX_TOOL_CONCURRENCY?.trim();
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(n) && n > 0) {
    return Math.min(n, 16);
  }
  return 4;
}

/**
 * Leaf tool slots shared by readonly sidecars.
 * Parent batches and workflow steps already chunk at the same cap and must
 * not hold a slot for the whole call: a draft_worker that occupied the last
 * slot could not run its own search tools.
 */
let leafInFlight = 0;
const leafWaiters: Array<() => void> = [];

export async function withLeafToolSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireLeafSlot();
  try {
    return await fn();
  } finally {
    releaseLeafSlot();
  }
}

function acquireLeafSlot(): Promise<void> {
  const cap = Math.max(1, getMaxToolUseConcurrency());
  if (leafInFlight < cap) {
    leafInFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    leafWaiters.push(() => {
      leafInFlight += 1;
      resolve();
    });
  });
}

function releaseLeafSlot(): void {
  leafInFlight = Math.max(0, leafInFlight - 1);
  const next = leafWaiters.shift();
  next?.();
}

export function isToolConcurrencySafe(registry: ToolRegistry, toolName: string): boolean {
  const tool = registry.get(toolName);
  // Approval-gated tools must never share a concurrent batch (approvalRequest race).
  if (tool?.definition.requiresApproval === true) {
    return false;
  }
  if (tool?.definition.isConcurrencySafe === true) {
    return true;
  }
  if (tool?.definition.isConcurrencySafe === false) {
    return false;
  }
  // One list with governance. A second hardcoded read set drifted and
  // serialized read_case_file / search_precedents / list_mail_inbox.
  return IDEMPOTENT_READ_TOOLS.has(toolName);
}

/**
 * Partition tool calls into batches: consecutive concurrency-safe tools run together.
 */
export function partitionToolCalls(calls: ToolCallRef[], registry: ToolRegistry): ToolCallBatch[] {
  if (calls.length === 0) {
    return [];
  }
  const batches: ToolCallBatch[] = [];
  let current: ToolCallBatch | null = null;

  for (const call of calls) {
    const safe = isToolConcurrencySafe(registry, call.name);
    if (!current || current.concurrencySafe !== safe) {
      current = { concurrencySafe: safe, calls: [] };
      batches.push(current);
    }
    current.calls.push(call);
  }
  return batches;
}
