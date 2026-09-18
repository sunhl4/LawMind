/**
 * Matter Replica — multi-lawyer matter collaboration (additive Firm feature).
 *
 * Does not change Solo defaults. See docs/lawmind/LAWMIND-MATTER-REPLICA.md.
 */

export {
  MATTER_REPLICA_ROLES,
  MATTER_REPLICA_ROLE_LABELS,
  ROLE_CAPABILITIES,
  roleHasCapability,
} from "./types.js";
export type {
  MatterReplicaRole,
  MatterReplicaCapability,
  MatterReplicaMember,
  MatterReplicaInvite,
  MatterReplicaMembership,
  MatterCheckoutLock,
  MatterRecordOp,
  MatterMaterialEntry,
  MatterMaterialsIndex,
  MatterReplicaFeedItem,
  LawyerIdentity,
} from "./types.js";

export { evaluateMatterReplicaGate, isMatterReplicaEnabled } from "./feature-gate.js";
export type { MatterReplicaGate } from "./feature-gate.js";

export { readLawyerIdentity, upsertLawyerIdentity, resolveReplicaActor } from "./identity.js";

export {
  readMembership,
  writeMembership,
  ensureMembershipWithOwner,
  findActiveMember,
  listActiveMembers,
  revokeMember,
  assertMemberCapability,
} from "./membership.js";

export {
  createInvite,
  listInvites,
  revokeInvite,
  acceptInviteByToken,
  exportInvitePack,
} from "./invites.js";

export { listCheckoutLocks, acquireCheckoutLock, releaseCheckoutLock } from "./checkout-locks.js";

export {
  listRecordOps,
  appendRecordOp,
  mergeRemoteOps,
  opsSince,
  snapshotCaseMd,
  detectAndParkCaseMdConflict,
} from "./record-ops.js";
export type { CaseMdReplicaConflict } from "./record-ops.js";

export { listMatterReplicaFeed } from "./feed.js";

export {
  scanMatterMaterials,
  readMaterialsIndex,
  publishLocalMaterials,
  materialsDir,
} from "./materials-blobs.js";

export {
  createMaterialsRelay,
  syncMatterMaterialsPipe,
  FileMaterialsRelay,
  NullMaterialsRelay,
} from "./materials-relay.js";
export type { SyncMaterialsResult } from "./materials-relay.js";

export {
  createReplicaRelay,
  syncMatterRecordPipe,
  FileReplicaRelay,
  NullReplicaRelay,
} from "./relay.js";
