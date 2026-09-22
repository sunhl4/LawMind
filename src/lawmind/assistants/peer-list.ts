import { listDelegations } from "../agent/collaboration/delegation-registry.js";
import { buildRoleDirectiveFromProfile, loadAssistantProfiles } from "./store.js";
import type { AssistantProfile } from "./types.js";

export type PeerAssistantPromptRow = {
  id: string;
  displayName: string;
  roleTitle: string;
  /** 正作为委派目标执行 pending/running 任务 */
  busy?: boolean;
};

export type PeerAssistantsForPrompt = {
  available: PeerAssistantPromptRow[];
  busy: PeerAssistantPromptRow[];
};

function toRow(profile: AssistantProfile, busy: boolean): PeerAssistantPromptRow {
  const role = buildRoleDirectiveFromProfile(profile);
  return {
    id: profile.assistantId,
    displayName: profile.displayName,
    roleTitle: role.roleTitle,
    busy,
  };
}

/** Assistants that are busy as delegation targets (inbound pending/running). */
export function assistantIdsWithInboundBusyDelegations(_workspaceDir: string): Set<string> {
  const busy = new Set<string>();
  for (const rec of listDelegations()) {
    if (rec.status !== "pending" && rec.status !== "running") {
      continue;
    }
    if (rec.toAssistantId?.trim()) {
      busy.add(rec.toAssistantId.trim());
    }
  }
  return busy;
}

/**
 * Peers for collaboration system prompt: all assistants except the current one.
 * Busy = inbound delegation still running (excluded from `available`, listed under `busy`).
 */
export function buildPeerAssistantsForPrompt(params: {
  lawMindRoot: string;
  workspaceDir: string;
  currentAssistantId: string | undefined;
}): PeerAssistantsForPrompt {
  const current = params.currentAssistantId?.trim();
  const all = loadAssistantProfiles(params.lawMindRoot);
  const others = all.filter((p) => p.assistantId !== current);
  const busyIds = assistantIdsWithInboundBusyDelegations(params.workspaceDir);

  const available: PeerAssistantPromptRow[] = [];
  const busy: PeerAssistantPromptRow[] = [];
  for (const p of others) {
    const row = toRow(p, busyIds.has(p.assistantId));
    if (row.busy) {
      busy.push(row);
    } else {
      available.push(row);
    }
  }
  return { available, busy };
}
