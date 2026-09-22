/**
 * 托管案件云（Matter Cloud）—— 租户 / 账号 / 成员 / 数据面服务端。
 *
 * 与本地回环版的区别：
 * - 本地版（`apps/lawmind-desktop/server/lawmind-server-route-matter-cloud.ts`）
 *   只绑 127.0.0.1，等价于「自己给自己当中继」，两台机器够不到；
 * - 本模块是**可远程部署**的服务端：令牌认证 + 租户隔离 + 服务器侧成员授权，
 *   桌面端只需把 `matterReplica.endpoint` 指过来。
 */

export { MatterCloudDirectory, hashToken, tokenFingerprint, safeCloudId } from "./directory.js";
export { createMatterCloudServer } from "./server.js";
export type { MatterCloudServer, MatterCloudServerOptions } from "./server.js";
export { MatterCloudClient, MatterCloudError } from "./client.js";
export type { CloudClientOptions, CloudIdentity } from "./client.js";
export {
  cloudClientForWorkspace,
  cloudConnectionInfo,
  createCloudInvite,
  revokeCloudInvite,
  acceptCloudInvite,
  fetchCloudMembership,
  projectCloudMembership,
  shareMatterKeyIfNeeded,
  syncMatterWithCloud,
} from "./desktop-bridge.js";
export type { CloudInviteResult } from "./desktop-bridge.js";
export type {
  CloudAccount,
  CloudAccountRole,
  CloudAuth,
  CloudInvite,
  CloudMember,
  CloudMembership,
  CloudRequestResult,
  CloudTenant,
} from "./types.js";
