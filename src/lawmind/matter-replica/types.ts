/**
 * Matter Replica — typed collaboration roles & capabilities.
 *
 * Product unit is a matter (案件), not a folder. Roles map to LawMind tools
 * and disk rights; they are not generic cloud-drive ACLs.
 */

export const MATTER_REPLICA_ROLES = [
  "owner",
  "lead",
  "associate",
  "paralegal",
  "readonly",
  "external",
] as const;

export type MatterReplicaRole = (typeof MATTER_REPLICA_ROLES)[number];

export const MATTER_REPLICA_ROLE_LABELS: Readonly<Record<MatterReplicaRole, string>> = {
  owner: "主办",
  lead: "主办（共同）",
  associate: "协办",
  paralegal: "助理",
  readonly: "只读",
  external: "外协",
};

export type MatterReplicaCapability =
  | "manage_members"
  | "invite"
  | "edit_matter_records"
  | "edit_case_md"
  | "upload_materials"
  | "delete_materials"
  | "checkout_docx"
  | "view_strategy"
  | "run_assistant_write"
  | "seal_matter";

/** Capability matrix — commercial defaults; do not invent mid-flight. */
export const ROLE_CAPABILITIES: Readonly<
  Record<MatterReplicaRole, readonly MatterReplicaCapability[]>
> = {
  owner: [
    "manage_members",
    "invite",
    "edit_matter_records",
    "edit_case_md",
    "upload_materials",
    "delete_materials",
    "checkout_docx",
    "view_strategy",
    "run_assistant_write",
    "seal_matter",
  ],
  lead: [
    "manage_members",
    "invite",
    "edit_matter_records",
    "edit_case_md",
    "upload_materials",
    "delete_materials",
    "checkout_docx",
    "view_strategy",
    "run_assistant_write",
    "seal_matter",
  ],
  associate: [
    "invite",
    "edit_matter_records",
    "edit_case_md",
    "upload_materials",
    "checkout_docx",
    "view_strategy",
    "run_assistant_write",
  ],
  paralegal: ["edit_matter_records", "upload_materials", "checkout_docx"],
  readonly: [],
  external: ["upload_materials"],
};

export function roleHasCapability(
  role: MatterReplicaRole,
  capability: MatterReplicaCapability,
): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export type MatterReplicaMember = {
  lawyerId: string;
  displayName: string;
  email?: string;
  role: MatterReplicaRole;
  status: "active" | "revoked";
  joinedAt: string;
  invitedBy?: string;
};

export type MatterReplicaInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type MatterReplicaInvite = {
  inviteId: string;
  matterId: string;
  matterTitle: string;
  token: string;
  email: string;
  role: MatterReplicaRole;
  invitedBy: string;
  invitedByName: string;
  status: MatterReplicaInviteStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
};

export type MatterReplicaMembership = {
  version: 1;
  matterId: string;
  matterTitle: string;
  /** Stable matter key shared across machines (defaults to matterId). */
  replicaKey: string;
  members: MatterReplicaMember[];
  updatedAt: string;
  updatedBy: string;
};

export type LawyerIdentity = {
  version: 1;
  lawyerId: string;
  displayName: string;
  email?: string;
  updatedAt: string;
};

export type MatterCheckoutLock = {
  lockId: string;
  matterId: string;
  /** Workspace-relative path under cases/<matterId>/ */
  relPath: string;
  holderLawyerId: string;
  holderDisplayName: string;
  acquiredAt: string;
  expiresAt: string;
  note?: string;
};

/** Append-only record-pipe operation (M1). */
export type MatterRecordOpKind =
  | "member.upsert"
  | "member.revoke"
  | "matter.field_set"
  | "lock.acquire"
  | "lock.release"
  | "invite.create"
  | "invite.accept"
  | "invite.revoke"
  | "case_md.snapshot"
  | "material.put"
  | "material.remove";

export type MatterRecordOp = {
  opId: string;
  matterId: string;
  kind: MatterRecordOpKind;
  actorId: string;
  actorName: string;
  createdAt: string;
  /** Opaque payload validated per kind at apply time. */
  payload: Record<string, unknown>;
};

/** Content-addressed material under cases/<id>/materials/ (M2). */
export type MatterMaterialEntry = {
  relPath: string;
  fileName: string;
  sha256: string;
  size: number;
  updatedAt: string;
};

export type MatterMaterialsIndex = {
  version: 1;
  matterId: string;
  updatedAt: string;
  files: MatterMaterialEntry[];
};

/** Recent material / narrative activity for 新材料 feed. */
export type MatterReplicaFeedItem = {
  opId: string;
  matterId: string;
  kind: MatterRecordOpKind;
  actorId: string;
  actorName: string;
  createdAt: string;
  title: string;
  relPath?: string;
  sha256?: string;
  size?: number;
};
