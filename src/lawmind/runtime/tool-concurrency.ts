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
  const readOnly = new Set([
    "search_workspace",
    "read_project_file",
    "analyze_document",
    "search_matter",
    "list_matters",
    "get_matter_summary",
    "list_tasks",
    "list_drafts",
    "get_audit_trail",
    "list_templates",
    "list_delegations",
    "get_delegation_result",
    "check_conflict_of_interest",
    "search_statute",
    "search_case_law",
  ]);
  return readOnly.has(toolName);
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
