import { readWorkspacePolicyFile } from "./workspace-policy.js";

/** High-security mode forces analysis scripts and MCP client off. */
export function isHighSecurityMode(workspaceDir: string): boolean {
  return readWorkspacePolicyFile(workspaceDir)?.highSecurityMode === true;
}

export function isAnalysisScriptsAllowed(workspaceDir: string): boolean {
  if (isHighSecurityMode(workspaceDir)) {
    return false;
  }
  return readWorkspacePolicyFile(workspaceDir)?.allowAnalysisScripts === true;
}

export function isMcpClientAllowed(workspaceDir: string): boolean {
  return !isHighSecurityMode(workspaceDir);
}

export function hiddenPolicyToolNames(workspaceDir: string): string[] {
  return isAnalysisScriptsAllowed(workspaceDir) ? [] : ["run_analysis"];
}
