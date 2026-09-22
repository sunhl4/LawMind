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
  /** Local Matter Cloud data directory (hosted HTTP + File relay root). */
  cloudDataDir?: string;
  cloudToken?: string;
  /** 后台自动同步是否开启（缺省跟 enabled）。 */
  autoSync: boolean;
};

export function readMatterReplicaPolicy(policy: LawMindWorkspacePolicy | null | undefined): {
  enabled?: boolean;
  endpoint?: string;
  sharedRelayDir?: string;
  cloudDataDir?: string;
  cloudToken?: string;
  autoSync?: boolean;
} {
  const raw = policy?.matterReplica;
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return {
    enabled: raw.enabled === true ? true : raw.enabled === false ? false : undefined,
    endpoint: typeof raw.endpoint === "string" ? raw.endpoint.trim() : undefined,
    sharedRelayDir: typeof raw.sharedRelayDir === "string" ? raw.sharedRelayDir.trim() : undefined,
    cloudDataDir: typeof raw.cloudDataDir === "string" ? raw.cloudDataDir.trim() : undefined,
    cloudToken: typeof raw.cloudToken === "string" ? raw.cloudToken.trim() : undefined,
    autoSync: raw.autoSync === true ? true : raw.autoSync === false ? false : undefined,
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
    cloudDataDir: mr.cloudDataDir || undefined,
    cloudToken: mr.cloudToken || undefined,
    // 缺省：门控开启就自动同步；显式 false 可关（只想手点同步的场景）
    autoSync: mr.autoSync === false ? false : enabled,
  };
}

export function isMatterReplicaEnabled(
  workspaceDir: string,
  opts?: { policy?: LawMindWorkspacePolicy | null; env?: NodeJS.ProcessEnv },
): boolean {
  return evaluateMatterReplicaGate(workspaceDir, opts).enabled;
}
