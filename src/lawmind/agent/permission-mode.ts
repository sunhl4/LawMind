export type AgentPermissionMode = "standard" | "strict" | "readonly";

export function parsePermissionMode(raw: unknown): AgentPermissionMode {
  if (raw === "strict" || raw === "readonly") {
    return raw;
  }
  return "standard";
}

/** Tools allowed when compose permission mode is readonly. */
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

export function filterToolsForPermissionMode(
  toolNames: string[],
  mode: AgentPermissionMode,
): string[] {
  if (mode !== "readonly") {
    return toolNames;
  }
  return toolNames.filter((n) => READONLY_AGENT_TOOL_NAMES.has(n));
}
