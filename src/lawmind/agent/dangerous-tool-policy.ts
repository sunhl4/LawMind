import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import type { ToolDefinition } from "./types.js";

/**
 * Tools that do not set `requiresApproval` on the definition but must still
 * require explicit `__approved: true` when edition `strictDangerousToolApproval` is on.
 */
export const STRICT_EXTRA_APPROVAL_TOOL_NAMES = new Set<string>(["execute_workflow"]);

/** High-risk tools isolated in a child process when tool sandbox is enabled (P2 POC). */
export const SUBPROCESS_SANDBOX_TOOL_NAMES = new Set<string>([
  "render_document",
  "execute_workflow",
  "draft_document",
  "add_case_note",
  // read_project_file / analyze_document stay in-process (C8): readonly, latency-sensitive
]);

export function toolRequiresSubprocessSandbox(toolName: string): boolean {
  return SUBPROCESS_SANDBOX_TOOL_NAMES.has(toolName);
}

export type ToolSandboxStatus = {
  enabled: boolean;
  source: "env" | "policy" | "off";
};

/** `lawmind.policy.json` `toolSandbox: true` or `LAWMIND_TOOL_SANDBOX=1`. */
export function describeToolSandboxStatus(workspaceDir: string): ToolSandboxStatus {
  if (process.env.LAWMIND_TOOL_SANDBOX?.trim() === "1") {
    return { enabled: true, source: "env" };
  }
  const policy = readWorkspacePolicyFile(workspaceDir);
  if (policy?.toolSandbox === true) {
    return { enabled: true, source: "policy" };
  }
  return { enabled: false, source: "off" };
}

export function resolveToolSandboxEnabled(workspaceDir: string): boolean {
  return describeToolSandboxStatus(workspaceDir).enabled;
}

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
