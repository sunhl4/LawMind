import { isEgressOffline, readWorkspacePolicyFile } from "./workspace-policy.js";

/**
 * 是否处于「完全不出站」的离线模式。
 *
 * 名称保留为历史别名；真值来自 `egressMode === "offline"`（`highSecurityMode: true` 仍兼容）。
 * 所有「离线时要关掉什么」的判断都应走这里，不要再单独读 `highSecurityMode`。
 */
export function isHighSecurityMode(workspaceDir: string): boolean {
  return isEgressOffline(workspaceDir);
}

/**
 * 分析脚本默认允许。只有策略明确写 `allowAnalysisScripts: false`，或离线模式，才关掉。
 * 不设律师开关：本机命令与当场核算同样默认可用。
 */
export function isAnalysisScriptsAllowed(workspaceDir: string): boolean {
  if (isHighSecurityMode(workspaceDir)) {
    return false;
  }
  return readWorkspacePolicyFile(workspaceDir)?.allowAnalysisScripts !== false;
}

export function isMcpClientAllowed(workspaceDir: string): boolean {
  return !isHighSecurityMode(workspaceDir);
}

export function hiddenPolicyToolNames(workspaceDir: string): string[] {
  const hidden: string[] = [];
  if (!isAnalysisScriptsAllowed(workspaceDir)) {
    hidden.push("run_analysis");
  }
  if (isHighSecurityMode(workspaceDir)) {
    hidden.push("run_compute");
  }
  return hidden;
}
