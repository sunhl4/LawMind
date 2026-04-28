import type { ToolDefinition } from "./types.js";

/**
 * Tools that do not set `requiresApproval` on the definition but must still
 * require explicit `__approved: true` when edition `strictDangerousToolApproval` is on.
 */
export const STRICT_EXTRA_APPROVAL_TOOL_NAMES = new Set<string>(["execute_workflow"]);

/**
 * Whether the tool call must include `__approved: true` before execution.
 */
export function toolRequiresExplicitApproval(args: {
  toolName: string;
  definition: ToolDefinition | undefined;
  allowDangerousToolsWithoutApproval: boolean;
  strictDangerousToolApproval: boolean;
}): boolean {
  const { toolName, definition, allowDangerousToolsWithoutApproval, strictDangerousToolApproval } =
    args;
  const marked = definition?.requiresApproval === true;
  const strictExtra = STRICT_EXTRA_APPROVAL_TOOL_NAMES.has(toolName);

  if (strictDangerousToolApproval) {
    return marked || strictExtra;
  }
  return marked && !allowDangerousToolsWithoutApproval;
}
