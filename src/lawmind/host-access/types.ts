/**
 * Host Access Plane — shared types (本机能力).
 * Lawyer-facing names live in UI; these identifiers stay English.
 */

export type HostAccessMode = "matter" | "mounts" | "locate" | "command";
export type HostCommandLevel = "office" | "workspace" | "session";
export type HostGrantDuration = "once" | "session" | "always";
export type HostGrantKind = "read" | "write";
export type HostRootKind = "workspace" | "mount" | "grant";

export type HostMount = {
  id: string;
  absPath: string;
  label?: string;
  matterId?: string;
  addedAt: string;
};

export type HostGrant = {
  id: string;
  absPath: string;
  kind: HostGrantKind;
  duration: HostGrantDuration;
  sessionId?: string;
  addedAt: string;
};

export type HostAccessPolicyConfig = {
  mode?: HostAccessMode;
  maxMounts?: number;
  spotlightEnabled?: boolean;
  fullDiskAccessOptIn?: boolean;
  allowHostCommands?: boolean;
  hostCommandLevel?: HostCommandLevel;
  fileTaskReadBudget?: number;
  fileTaskReadHardCap?: number;
  denyPathPatterns?: string[];
  allowCrossMatterMounts?: boolean;
  indexBodyInAppSupport?: boolean;
  /** Firm: lock assistants to matter-only roots. */
  forceMatterMode?: boolean;
  /** Firm: allow L3 session commands. Solo default true when level=session. */
  allowSessionCommands?: boolean;
};

export type ResolvedHostAccessPolicy = {
  mode: HostAccessMode;
  maxMounts: number;
  spotlightEnabled: boolean;
  fullDiskAccessOptIn: boolean;
  allowHostCommands: boolean;
  hostCommandLevel: HostCommandLevel;
  fileTaskReadBudget: number;
  fileTaskReadHardCap: number;
  denyPathPatterns: string[];
  allowCrossMatterMounts: boolean;
  indexBodyInAppSupport: boolean;
  forceMatterMode: boolean;
  allowSessionCommands: boolean;
};

export type HostAccessFileState = {
  schemaVersion: 1;
  mounts: HostMount[];
  persistentGrants: HostGrant[];
  fullDiskAccessNoted?: boolean;
};

export type HostAccessRuntime = {
  workspaceDir: string;
  sessionId: string;
  matterId?: string;
  edition?: "solo" | "firm" | "private_deploy";
  policy: ResolvedHostAccessPolicy;
  mounts: HostMount[];
  grants: HostGrant[];
  sessionCommandAllowed: boolean;
  homeDir: string;
  storePath?: string;
  logDir?: string;
  indexDir?: string;
};

export type HostPathError =
  | "empty"
  | "deny_list"
  | "escape"
  | "cross_matter_denied"
  | "ethical_wall"
  | "needs_grant"
  | "write_forbidden"
  | "not_found"
  | "mode_denied";

export type ResolvedHostPath =
  | {
      ok: true;
      abs: string;
      rel: string;
      rootKind: HostRootKind;
      rootId?: string;
      writable: boolean;
    }
  | { ok: false; error: HostPathError; message: string };

export type HostSearchHit = {
  hitId: string;
  displayName: string;
  parentName: string;
  ext: string;
  size?: number;
  mtimeMs?: number;
  /** Present only when the hit is inside an authorized root. */
  absPath?: string;
  mountId?: string;
  matterId?: string;
  needsGrant: boolean;
  snippet?: string;
  /** Engine-only absolute path for unauthorized locate hits; never sent to the model. */
  locateAbs?: string;
};

export type HostLogEvent = {
  at: string;
  action: "search" | "read" | "import" | "command" | "grant" | "deny" | "revoke" | "index";
  sessionId?: string;
  matterId?: string;
  path?: string;
  detail?: string;
  ok: boolean;
};
