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
  upsertMember,
  assertMemberCapability,
} from "./membership.js";

export {
  createInvite,
  listInvites,
  revokeInvite,
  acceptInviteByToken,
  exportInvitePack,
  installMatterKeyFromPack,
  publishMemberPublicKey,
  rotateAndShareMatterKey,
  shareCurrentMatterKeyWithMembers,
} from "./invites.js";

export {
  ensureMemberKeyPair,
  readMemberKeyPair,
  memberKeysPath,
  memberKeyFingerprint,
  wrapMatterKeyForMember,
  unwrapMatterKeyForMember,
  memberPublicKeysFromOps,
} from "./member-keys.js";
export type { MemberKeyPair, WrappedMatterKeyForMember } from "./member-keys.js";

export {
  listCheckoutLocks,
  acquireCheckoutLock,
  releaseCheckoutLock,
  writeCheckoutLocks,
} from "./checkout-locks.js";

export {
  listRecordOps,
  appendRecordOp,
  mergeRemoteOps,
  opsSince,
  snapshotCaseMd,
  readCaseMdExcerpt,
  detectAndParkCaseMdConflict,
} from "./record-ops.js";
export type { CaseMdReplicaConflict } from "./record-ops.js";

export { listMatterReplicaFeed } from "./feed.js";
export { listDeskReplicaFeed } from "./desk-feed.js";
export type { DeskReplicaFeedItem } from "./desk-feed.js";

export { applyRecordOpsToState, APPLIABLE_MATTER_FIELDS } from "./apply-ops.js";
export type { ApplyOpsResult } from "./apply-ops.js";

export {
  scanMatterMaterials,
  readMaterialsIndex,
  publishLocalMaterials,
  applyRemoteMaterialRemovals,
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
export {
  ensureMatterVisible,
  ingestInviteFromSharedRelay,
  isCrossMachineRelayReady,
  listFileRelayMatterIds,
} from "./shared-relay.js";

export { HttpReplicaRelay, HttpMaterialsRelay } from "./http-relay.js";
export { sealBytes, openBytes, isSealedEnvelope } from "./crypto-envelope.js";
export { ensureMatterKey, readMatterKey, rotateMatterKey, installMatterKey } from "./matter-key.js";
export { planMaterialChunks, MATERIAL_CHUNK_THRESHOLD } from "./materials-cdc.js";
export { lastWriteWinner, conflictSidecarRelPath } from "./last-write.js";

export {
  wrapMatterKeyForInvite,
  unwrapMatterKeyFromInvite,
  deriveInviteWrapKey,
} from "./invite-key-wrap.js";
export { MatterCloudStore, defaultMatterCloudDataDir } from "./matter-cloud-store.js";
export {
  handleMatterCloudRequest,
  matchMatterCloudPath,
  sendMatterCloudResult,
} from "./matter-cloud-http.js";
export { rematerializeCaseMd, mergeCaseMdLines, readCaseMdLiveState } from "./case-md-live.js";
