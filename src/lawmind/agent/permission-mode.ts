export type AgentPermissionMode = "standard" | "strict" | "readonly" | "research";

export function parsePermissionMode(raw: unknown): AgentPermissionMode {
  if (raw === "strict" || raw === "readonly" || raw === "research") {
    return raw;
  }
  return "standard";
}

/** Tools allowed when compose permission mode is readonly (plan-first). */
export const READONLY_AGENT_TOOL_NAMES = new Set<string>([
  "search_workspace",
  "read_project_file",
  "analyze_document",
  "search_matter",
  "search_statute",
  "search_case_law",
  "search_statute_web",
  "get_matter_summary",
  "list_matters",
  "read_case_file",
  "list_tasks",
  "list_drafts",
  "get_audit_trail",
  "list_templates",
  "list_delegations",
  "get_delegation_result",
  "check_conflict_of_interest",
]);

/**
 * Research mode = readonly + `research_task` (structured research), still no draft/render/workflow.
 */
export const RESEARCH_AGENT_TOOL_NAMES = new Set<string>([
  ...READONLY_AGENT_TOOL_NAMES,
  "research_task",
]);

export function filterToolsForPermissionMode(
  toolNames: string[],
  mode: AgentPermissionMode,
): string[] {
  if (mode === "readonly") {
    return toolNames.filter((n) => READONLY_AGENT_TOOL_NAMES.has(n));
  }
  if (mode === "research") {
    return toolNames.filter((n) => RESEARCH_AGENT_TOOL_NAMES.has(n));
  }
  return toolNames;
}
