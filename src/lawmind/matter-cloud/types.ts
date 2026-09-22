/**
 * 托管案件云（Matter Cloud）—— 类型。
 *
 * 这是「律所不用自备主机」的那台服务端所需的**租户 / 账号 / 成员**模型。
 * 数据面（ops / 清单 / 内容块）沿用 `MatterCloudStore`，本模块只负责
 * 「你是谁、你能碰哪个案件」。
 */

import type { MatterReplicaRole } from "../matter-replica/types.js";

export type CloudTenant = {
  version: 1;
  tenantId: string;
  name: string;
  createdAt: string;
};

/** 账号在**租户内**的角色（平台管理员与案件角色是两回事）。 */
export type CloudAccountRole = "admin" | "member";

export type CloudAccount = {
  version: 1;
  accountId: string;
  tenantId: string;
  /** 与桌面端 `lawyer-identity.json` 的 lawyerId 对齐，成员名册靠它匹配 */
  lawyerId: string;
  displayName: string;
  email?: string;
  role: CloudAccountRole;
  /** sha256(token) —— **明文令牌只在创建时返回一次**，服务端不存明文 */
  tokenHash: string;
  tokenFp: string;
  createdAt: string;
  revokedAt?: string;
};

export type CloudMember = {
  lawyerId: string;
  displayName: string;
  email?: string;
  role: MatterReplicaRole;
  status: "active" | "revoked";
  joinedAt: string;
};

export type CloudMembership = {
  version: 1;
  tenantId: string;
  matterId: string;
  matterTitle: string;
  members: CloudMember[];
  updatedAt: string;
  updatedBy: string;
};

export type CloudInvite = {
  inviteId: string;
  matterId: string;
  matterTitle: string;
  token: string;
  email: string;
  role: MatterReplicaRole;
  invitedBy: string;
  invitedByName: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
};

/** 已通过鉴权的请求上下文。 */
export type CloudAuth = {
  account: CloudAccount;
  tenantId: string;
};

export type CloudRequestResult = {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  body?: Buffer;
};
