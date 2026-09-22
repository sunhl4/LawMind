/**
 * Coordination tools shared utilities.
 *
 * Used by `delegate.ts`, `handoff.ts`, `meeting.ts` after splitting
 * `collaboration-tools.ts` (W8).
 */

import { loadAssistantProfiles, resolveLawMindRoot } from "../../../assistants/store.js";

export function lawMindRootFromWorkspace(workspaceDir: string, envFile?: string): string {
  return resolveLawMindRoot(workspaceDir, envFile);
}

export function listAvailableAssistantNames(workspaceDir: string, envFile?: string): string {
  const root = lawMindRootFromWorkspace(workspaceDir, envFile);
  const profiles = loadAssistantProfiles(root);
  return profiles.map((p) => `${p.assistantId} (${p.displayName})`).join(", ");
}

export function resolveAssistantId(
  workspaceDir: string,
  nameOrId: string,
  envFile?: string,
): string | undefined {
  const root = lawMindRootFromWorkspace(workspaceDir, envFile);
  const profiles = loadAssistantProfiles(root);
  const byId = profiles.find((p) => p.assistantId === nameOrId);
  if (byId) {
    return byId.assistantId;
  }
  const byName = profiles.find(
    (p) => p.displayName === nameOrId || p.displayName.includes(nameOrId),
  );
  if (byName) {
    return byName.assistantId;
  }
  // Workflow templates often pass role/preset ids (e.g. contract_review).
  const byRoleOrPreset = profiles.find((p) => p.roleId === nameOrId || p.presetKey === nameOrId);
  return byRoleOrPreset?.assistantId;
}

/**
 * W8：根据 roleId 查找候选助手。优先返回 `roleId === target` 的；找不到时
 * fallback 到 `presetKey === target`（向后兼容期）。
 */
export function findAssistantsByRole(
  workspaceDir: string,
  roleId: string,
  envFile?: string,
): Array<{ assistantId: string; displayName: string }> {
  const root = lawMindRootFromWorkspace(workspaceDir, envFile);
  const profiles = loadAssistantProfiles(root);
  const direct = profiles
    .filter((p) => p.roleId === roleId)
    .map((p) => ({ assistantId: p.assistantId, displayName: p.displayName }));
  if (direct.length > 0) {
    return direct;
  }
  return profiles
    .filter((p) => p.presetKey === roleId)
    .map((p) => ({ assistantId: p.assistantId, displayName: p.displayName }));
}
