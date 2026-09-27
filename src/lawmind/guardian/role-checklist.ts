/**
 * Role review lines are coaching for a human reader of the role file.
 * Do not merge them into guardian expected items: an unsupported line fails the export.
 */

import { loadAssistantProfiles, resolveLawMindRoot } from "../assistants/store.js";
import { getRoleById } from "../core/role.js";
import type { GuardianChecklistItem } from "./types.js";

export function roleReviewChecklistItems(
  roleId: string,
  lines: readonly string[],
): GuardianChecklistItem[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((look, index) => ({
      id: `role-${roleId}-${index + 1}`,
      look,
      stop: "正文未见该项且未缓办则 fail",
    }));
}

export function loadRoleReviewChecklist(
  workspaceDir: string,
  assistantId: string | undefined,
  envFile?: string,
): { roleId: string; items: GuardianChecklistItem[] } | null {
  const id = assistantId?.trim();
  if (!id) {
    return null;
  }
  const root = resolveLawMindRoot(workspaceDir, envFile);
  const profile = loadAssistantProfiles(root).find((row) => row.assistantId === id);
  const role = getRoleById(profile?.roleId ?? profile?.presetKey ?? "");
  if (!role || role.reviewChecklist.length === 0) {
    return null;
  }
  return {
    roleId: role.roleId,
    items: roleReviewChecklistItems(role.roleId, role.reviewChecklist),
  };
}
