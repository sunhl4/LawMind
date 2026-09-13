export {
  resolveHostPath,
  buildHostAccessRuntime,
  allowedRootsForCommands,
} from "./access-broker.js";
export { isDeniedHostPath, denyListMessage } from "./deny-list.js";
export { resolveHostAccessPolicy, DEFAULT_HOST_ACCESS_POLICY } from "./host-policy.js";
export {
  readHostAccessFile,
  writeHostAccessFile,
  addMountToStore,
  removeMountFromStore,
  migrateProjectDirToMounts,
  addSessionGrant,
  listSessionGrants,
  consumeOnceGrant,
  rememberLocateHit,
  resolveLocateHit,
  setSessionCommandAllowed,
  isSessionCommandAllowed,
  persistAlwaysGrant,
  firstMountProjectDir,
  defaultHostAccessFilePath,
  HOST_ACCESS_FILE_ENV,
} from "./host-store.js";
export { searchHost, searchMountsByName } from "./host-search.js";
export { rebuildHostIndex, searchHostIndex } from "./host-index.js";
export {
  authorizeHostCommand,
  runHostCommand,
  hostCommandNeedsSessionAllow,
} from "./host-command.js";
export { appendHostAccessLog, readHostAccessLog } from "./host-log.js";
export { hostdList, hostdSearch, hostdRead, hostdImport, hostdRebuildIndex } from "./hostd.js";
export {
  activeMountsForSession,
  readMatterParties,
  partiesConflict,
  workspaceOtherMatterDenied,
} from "./matter-fence.js";
export type {
  HostAccessMode,
  HostAccessRuntime,
  HostGrant,
  HostMount,
  HostSearchHit,
  ResolvedHostAccessPolicy,
  HostAccessPolicyConfig,
} from "./types.js";
