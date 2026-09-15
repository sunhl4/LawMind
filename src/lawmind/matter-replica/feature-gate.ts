/**
 * Feature gate — Solo path stays unchanged unless Firm/Private or explicit policy.
 */

import { resolveEdition } from "../policy/edition.js";
import {
  readWorkspacePolicyFile,
  type LawMindWorkspacePolicy,
} from "../policy/workspace-policy.js";

export type MatterReplicaGate = {
  enabled: boolean;
  reason: string;
  edition: string;
  cloudEndpoint?: string;
  /** Shared-folder relay for early multi-machine without SaaS. */
  sharedRelayDir?: string;
};

export function readMatterReplicaPolicy(policy: LawMindWorkspacePolicy | null | undefined): {
  enabled?: boolean;
  endpoint?: string;
  sharedRelayDir?: string;
} {
  const raw = policy?.matterReplica;
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return {
    enabled: raw.enabled === true ? true : raw.enabled === false ? false : undefined,
    endpoint: typeof raw.endpoint === "string" ? raw.endpoint.trim() : undefined,
    sharedRelayDir: typeof raw.sharedRelayDir === "string" ? raw.sharedRelayDir.trim() : undefined,
  };
}

/**
 * Whether matter-replica collab surfaces may run.
 * - Solo: off unless policy.matterReplica.enabled === true (power-user opt-in)
 * - Firm / Private: on unless policy.matterReplica.enabled === false
 * - Also requires edition feature `matterReplicaCollab` when using edition table
 */
export function evaluateMatterReplicaGate(
  workspaceDir: string,
  opts?: { policy?: LawMindWorkspacePolicy | null; env?: NodeJS.ProcessEnv },
): MatterReplicaGate {
  const policy = opts?.policy ?? readWorkspacePolicyFile(workspaceDir);
  const edition = resolveEdition({ policy, env: opts?.env });
  const mr = readMatterReplicaPolicy(policy);
  const featureOn = edition.features.matterReplicaCollab;

  let enabled = false;
  let reason = "matter_replica_disabled";

  if (mr.enabled === false) {
    enabled = false;
    reason = "matter_replica_policy_off";
  } else if (mr.enabled === true) {
    enabled = true;
    reason = "matter_replica_policy_on";
  } else if (featureOn) {
    enabled = true;
    reason = "matter_replica_edition";
  } else {
    enabled = false;
    reason = "matter_replica_requires_firm_or_opt_in";
  }

  return {
    enabled,
    reason,
    edition: edition.edition,
    cloudEndpoint: mr.endpoint || undefined,
    sharedRelayDir: mr.sharedRelayDir || undefined,
  };
}

export function isMatterReplicaEnabled(
  workspaceDir: string,
  opts?: { policy?: LawMindWorkspacePolicy | null; env?: NodeJS.ProcessEnv },
): boolean {
  return evaluateMatterReplicaGate(workspaceDir, opts).enabled;
}
