/**
 * Bind fleet playbook roles to workspace assistants (Wave D / T3.4).
 * Playbook roleIds (clause/risk/…) ≠ assistant roleIds (contract_review/…);
 * use workspaceRoleId override or DEFAULT_MAP.
 */

import { findAssistantsByRole } from "../agent/tools/coordination/utils.js";
import {
  getAssistantById,
  loadAssistantProfiles,
  resolveLawMindRoot,
} from "../assistants/store.js";
import type { FleetPlaybookRole, ReviewCampaignRoleId, ReviewCampaignRoleResult } from "./types.js";

/** Default playbook role → assistant Role / preset id. */
export const PLAYBOOK_ROLE_TO_WORKSPACE_ROLE: Record<ReviewCampaignRoleId, string> = {
  clause: "contract_review",
  risk: "contract_review",
  compliance: "compliance_research",
  obligation_timeline: "contract_review",
  citation_check: "general_default",
};

export function resolveWorkspaceRoleIdForPlaybookRole(role: FleetPlaybookRole): string {
  const override = role.workspaceRoleId?.trim();
  if (override) {
    return override;
  }
  return PLAYBOOK_ROLE_TO_WORKSPACE_ROLE[role.id] ?? "general_default";
}

export function bindPlaybookRolesToAssistants(
  workspaceDir: string,
  playbookRoles: FleetPlaybookRole[],
  envFile?: string,
): ReviewCampaignRoleResult[] {
  const root = resolveLawMindRoot(workspaceDir, envFile);
  const profiles = loadAssistantProfiles(root);

  return playbookRoles.map((r) => {
    const base: ReviewCampaignRoleResult = {
      roleId: r.id,
      label: r.label,
      status: "pending",
      weight: r.weight,
      findings: [],
    };

    const explicit = r.assistantId?.trim();
    if (explicit) {
      const prof =
        getAssistantById(root, explicit) ?? profiles.find((p) => p.assistantId === explicit);
      if (prof) {
        return {
          ...base,
          boundAssistantId: prof.assistantId,
          boundAssistantName: prof.displayName,
          workspaceRoleId: resolveWorkspaceRoleIdForPlaybookRole(r),
        };
      }
    }

    const workspaceRoleId = resolveWorkspaceRoleIdForPlaybookRole(r);
    const candidates = findAssistantsByRole(workspaceDir, workspaceRoleId, envFile);
    if (candidates.length === 0) {
      return { ...base, workspaceRoleId };
    }
    const pick = candidates[0];
    return {
      ...base,
      workspaceRoleId,
      boundAssistantId: pick.assistantId,
      boundAssistantName: pick.displayName,
    };
  });
}
