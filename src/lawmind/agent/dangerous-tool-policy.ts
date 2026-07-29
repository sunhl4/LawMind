import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import type { ToolDefinition } from "./types.js";
import { WRITE_TOOLS } from "./tool-name-sets.js";

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
 *
 * In **strict** mode, consults the per-definition `requiresApproval` flag, the
 * `STRICT_EXTRA` set, AND the shared `WRITE_TOOLS` governance set — so that any
 * tool classified as a write tool in governance metadata requires explicit
 * approval, keeping governance classification and runtime enforcement aligned.
 *
 * In **non-strict** mode, only the per-definition `requiresApproval` flag is
 * consulted (mid-work draft tools like `write_document` / `update_draft`
 * intentionally run without `__approved` so the lawyer is not interrupted).
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
  const governanceWrite = WRITE_TOOLS.has(toolName);

  if (strictDangerousToolApproval) {
    return marked || strictExtra || governanceWrite;
  }
  return marked && !allowDangerousToolsWithoutApproval;
}
