/**
 * Names that only LawMind's own registry may implement.
 * MCP / external adapters must not register these — schema would lie about execute.
 */

export const RESERVED_AGENT_TOOL_NAMES = [
  "apply_surgical_edits",
  "write_document",
  "send_email",
  "render_tracked_draft",
  "draft_document",
  "update_draft",
  "prepare_outbound_mail",
  "render_document",
  "analyze_document",
  "write_spreadsheet",
  "render_chart",
  "run_analysis",
  "calculate",
  "execute_workflow",
] as const;

export type ReservedAgentToolName = (typeof RESERVED_AGENT_TOOL_NAMES)[number];

const RESERVED = new Set<string>(RESERVED_AGENT_TOOL_NAMES);

export function isReservedAgentToolName(name: string): boolean {
  return RESERVED.has(name.trim());
}

export function assertExternalToolNameAllowed(name: string): void {
  if (isReservedAgentToolName(name)) {
    throw new Error(`RESERVED_TOOL_NAME: ${name} is implemented only by LawMind execute()`);
  }
}
