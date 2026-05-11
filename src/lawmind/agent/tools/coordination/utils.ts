/**
 * Coordination tools shared utilities.
 *
 * Used by `delegate.ts`, `handoff.ts`, `meeting.ts` after splitting
 * `collaboration-tools.ts` (W8).
 */

import { loadAssistantProfiles } from "../../../assistants/store.js";

export function lawMindRootFromWorkspace(workspaceDir: string): string {
  return workspaceDir.replace(/[\\/]workspace$/, "") || workspaceDir;
}

export function listAvailableAssistantNames(workspaceDir: string): string {
  const root = lawMindRootFromWorkspace(workspaceDir);
  const profiles = loadAssistantProfiles(root);
  return profiles.map((p) => `${p.assistantId} (${p.displayName})`).join(", ");
}

export function resolveAssistantId(workspaceDir: string, nameOrId: string): string | undefined {
  const root = lawMindRootFromWorkspace(workspaceDir);
  const profiles = loadAssistantProfiles(root);
  const byId = profiles.find((p) => p.assistantId === nameOrId);
  if (byId) {
    return byId.assistantId;
  }
  const byName = profiles.find(
    (p) => p.displayName === nameOrId || p.displayName.includes(nameOrId),
  );
  return byName?.assistantId;
}

/**
 * W8：根据 roleId 查找候选助手。优先返回 `roleId === target` 的；找不到时
 * fallback 到 `presetKey === target`（向后兼容期）。
 */
export function findAssistantsByRole(
  workspaceDir: string,
  roleId: string,
): Array<{ assistantId: string; displayName: string }> {
  const root = lawMindRootFromWorkspace(workspaceDir);
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
