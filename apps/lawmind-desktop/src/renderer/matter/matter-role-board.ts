/**
 * Pure mapper: matter team roster + assistants + roles → RoleAssignmentRow[].
 */

export type RoleAssignmentRow = {
  assistantId: string;
  displayName: string;
  roleId?: string;
  roleDisplayName?: string;
  riskCeiling?: "low" | "medium" | "high";
  pendingApprovalCount?: number;
};

export type RoleBoardRoster = {
  participantAssistantIds: string[];
  synthesizerAssistantId?: string;
};

export type RoleBoardAssistant = {
  assistantId: string;
  displayName?: string;
  roleId?: string;
  presetKey?: string;
  customRoleTitle?: string;
};

export type RoleBoardRole = {
  roleId: string;
  displayName: string;
  riskCeiling?: "low" | "medium" | "high";
};

export type RoleBoardPendingApproval = {
  status: string;
  requestedBy?: string;
  targetRole?: string;
};

function resolveRoleId(
  assistant: RoleBoardAssistant | undefined,
  rolesById: Map<string, RoleBoardRole>,
): string | undefined {
  const direct = assistant?.roleId?.trim();
  if (direct && rolesById.has(direct)) {
    return direct;
  }
  if (direct) {
    return direct;
  }
  const fromPreset = assistant?.presetKey?.trim();
  if (fromPreset && rolesById.has(fromPreset)) {
    return fromPreset;
  }
  return fromPreset || undefined;
}

function countPendingForAssistant(
  assistantId: string,
  roleId: string | undefined,
  approvals: RoleBoardPendingApproval[],
): number {
  let n = 0;
  for (const a of approvals) {
    if (a.status !== "pending") {
      continue;
    }
    const by = a.requestedBy?.trim();
    if (by && by === assistantId) {
      n += 1;
      continue;
    }
    const target = a.targetRole?.trim();
    if (target && roleId && target === roleId) {
      n += 1;
    }
  }
  return n;
}

/**
 * Build role-board rows from remembered roster participants.
 * Empty roster → empty rows (UI empty state: remember roster in meeting).
 */
export function buildRoleAssignmentRows(input: {
  roster: RoleBoardRoster | null | undefined;
  assistants: RoleBoardAssistant[];
  roles?: RoleBoardRole[];
  pendingApprovals?: RoleBoardPendingApproval[];
}): RoleAssignmentRow[] {
  const ids = input.roster?.participantAssistantIds ?? [];
  if (ids.length === 0) {
    return [];
  }

  const assistantsById = new Map<string, RoleBoardAssistant>();
  for (const a of input.assistants) {
    const id = a.assistantId?.trim();
    if (id) {
      assistantsById.set(id, a);
    }
  }

  const rolesById = new Map<string, RoleBoardRole>();
  for (const r of input.roles ?? []) {
    const id = r.roleId?.trim();
    if (id) {
      rolesById.set(id, r);
    }
  }

  const approvals = input.pendingApprovals ?? [];
  const seen = new Set<string>();
  const rows: RoleAssignmentRow[] = [];

  for (const rawId of ids) {
    const assistantId = rawId.trim();
    if (!assistantId || seen.has(assistantId)) {
      continue;
    }
    seen.add(assistantId);

    const assistant = assistantsById.get(assistantId);
    const roleId = resolveRoleId(assistant, rolesById);
    const role = roleId ? rolesById.get(roleId) : undefined;
    const customTitle = assistant?.customRoleTitle?.trim();
    const roleDisplayName = customTitle || role?.displayName || roleId;

    rows.push({
      assistantId,
      displayName: assistant?.displayName?.trim() || assistantId,
      roleId,
      roleDisplayName,
      riskCeiling: role?.riskCeiling,
      pendingApprovalCount: countPendingForAssistant(assistantId, roleId, approvals),
    });
  }

  return rows;
}
