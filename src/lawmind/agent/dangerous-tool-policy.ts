import { toolRequiresLawyerPause } from "../platform/lawyer-outbound-decision.js";
import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import type { ToolDefinition } from "./types.js";

/*
 * 说明：这里刻意没有「strict 模式下额外加审批」的工具清单。
 *
 * 曾经存在一个 STRICT_EXTRA_APPROVAL_TOOL_NAMES = {"execute_workflow"}，但它从未被
 * 任何调用点消费；而 toolRequiresExplicitApproval 对非 send_email 一律早退
 * （见下方 toolRequiresLawyerPause），所以它连「接线即可生效」都做不到。
 *
 * 运行期审批的设计边界是「只拦从律师这边发出去的动作」——写合同、审合同、本地导出
 * 直接出结果，execute_workflow 属于后者。若将来真要让内部管线也拍板，需要同时改
 * toolRequiresExplicitApproval 的早退结构，并按 AGENTS.md 补一条 turn cassette。
 */

/** High-risk tools isolated in a child process when tool sandbox is enabled (P2 POC). */
export const SUBPROCESS_SANDBOX_TOOL_NAMES = new Set<string>([
  "render_document",
  "render_tracked_draft",
  "execute_workflow",
  "draft_document",
  "add_case_note",
  "run_analysis",
  "run_compute",
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
 * 待拍板只拦「从律师这边发出去」：写合同 / 审合同 / 本地导出直接出结果。
 * `prepare_outbound_mail` 只写入待发信，拍板在 inbox；真正发信才打断回合。
 */
export function toolRequiresExplicitApproval(args: {
  toolName: string;
  definition: ToolDefinition | undefined;
  allowDangerousToolsWithoutApproval: boolean;
  strictDangerousToolApproval: boolean;
}): boolean {
  const { toolName, allowDangerousToolsWithoutApproval, strictDangerousToolApproval } = args;
  if (!toolRequiresLawyerPause(toolName)) {
    return false;
  }
  if (strictDangerousToolApproval) {
    return true;
  }
  return !allowDangerousToolsWithoutApproval;
}
