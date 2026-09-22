/**
 * 桌面端 ↔ 托管案件云的桥接层。
 *
 * ## 权威性划分（重要）
 *
 * - **成员与邀请**：配了云之后，**云是权威**。邀请由服务端建、服务端记状态；
 *   桌面端不再自己造邀请码（否则同一件事有两个真相源，早晚漂移）。
 * - **卷宗数据**：仍是「本机磁盘 + ops 投影」那套，云只做转发与鉴权。
 * - **本地成员名册**：云侧名册是权威，本地名册是**投影**，用于签出 / apply / 权限判断。
 *   所以兑换云邀请后会同时：写本地名册 + 记 `invite.accept` op（让其他机器也能收敛），
 *   即使某台机器没连云也能靠 ops 得到正确名册。
 * - **案件密钥**：云的邀请路径没有 `matter_key.share` op，所以新成员靠
 *   「主办端下一轮同步补发」（`shareCurrentMatterKeyWithMembers`）拿到钥匙。
 */

import { emitCollaborationAudit } from "../audit/collaboration-audit.js";
import {
  acceptInviteByToken,
  appendRecordOp,
  evaluateMatterReplicaGate,
  listActiveMembers,
  listRecordOps,
  publishMemberPublicKey,
  readMembership,
  resolveReplicaActor,
  shareCurrentMatterKeyWithMembers,
  syncMatterRecordPipe,
  upsertMember,
  writeMembership,
  type MatterReplicaMember,
} from "../matter-replica/index.js";
import { MatterCloudClient } from "./client.js";
import type { CloudMembership } from "./types.js";

/** 从工作区策略构造云客户端；未配置云时返回 null。 */
export function cloudClientForWorkspace(
  workspaceDir: string,
  fetchImpl?: typeof fetch,
): MatterCloudClient | null {
  const gate = evaluateMatterReplicaGate(workspaceDir);
  if (!gate.enabled || !gate.cloudEndpoint || !gate.cloudToken) {
    return null;
  }
  return new MatterCloudClient({
    endpoint: gate.cloudEndpoint,
    token: gate.cloudToken,
    fetchImpl,
  });
}

/** 云连接状态（给面板与排障用，不回令牌本身）。 */
export function cloudConnectionInfo(workspaceDir: string): {
  configured: boolean;
  endpoint: string | null;
  hasToken: boolean;
} {
  const gate = evaluateMatterReplicaGate(workspaceDir);
  return {
    configured: Boolean(gate.enabled && gate.cloudEndpoint && gate.cloudToken),
    endpoint: gate.cloudEndpoint ?? null,
    hasToken: Boolean(gate.cloudToken),
  };
}

export type CloudInviteResult = {
  inviteId: string;
  token: string;
  email: string;
  role: string;
  expiresAt: string;
  shareText: string;
  matterId: string;
};

/** 经云建邀请（云为权威，本地不再自己造邀请码）。 */
export async function createCloudInvite(
  workspaceDir: string,
  input: { matterId: string; matterTitle: string; email: string; role: string },
  fetchImpl?: typeof fetch,
): Promise<CloudInviteResult> {
  const client = cloudClientForWorkspace(workspaceDir, fetchImpl);
  if (!client) {
    throw new Error("未配置案件云（matterReplica.endpoint + cloudToken）");
  }
  const actor = resolveReplicaActor(workspaceDir);
  if (actor.source === "ephemeral") {
    throw new Error("请先在「成员协作」中设置你的姓名与邮箱，再邀请同事");
  }
  // 云侧要有本案名册，且我在册；否则下面的 createInvite 会被服务端 403。
  await ensureCloudMembership(client, workspaceDir, input.matterId, input.matterTitle);

  const created = await client.createInvite({
    matterId: input.matterId,
    email: input.email,
    role: input.role,
  });
  const invite = created.invite;
  // 本地也记一条 op，便于不带云的机器/排障看到「谁邀请了谁」
  try {
    appendRecordOp(workspaceDir, {
      matterId: input.matterId,
      kind: "invite.create",
      actorId: actor.lawyerId,
      actorName: actor.displayName,
      payload: {
        inviteId: invite.inviteId,
        email: invite.email,
        role: invite.role,
        matterTitle: input.matterTitle,
        tokenFp: invite.token.slice(0, 8),
        via: "cloud",
        expiresAt: invite.expiresAt,
      },
    });
    publishMemberPublicKey(workspaceDir, input.matterId);
  } catch {
    /* 本地留痕是加分项，失败不影响云上邀请 */
  }
  return {
    inviteId: invite.inviteId,
    token: invite.token,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    matterId: input.matterId,
    shareText:
      created.shareText ??
      `邀请你加入 LawMind 案件「${input.matterTitle}」。在 LawMind 中粘贴云邀请码：${invite.token}`,
  };
}

export async function revokeCloudInvite(
  workspaceDir: string,
  input: { matterId: string; inviteId: string },
  fetchImpl?: typeof fetch,
): Promise<{ inviteId: string; status: string }> {
  const client = cloudClientForWorkspace(workspaceDir, fetchImpl);
  if (!client) {
    throw new Error("未配置案件云（matterReplica.endpoint + cloudToken）");
  }
  const r = await client.revokeInvite(input);
  const actor = resolveReplicaActor(workspaceDir);
  try {
    appendRecordOp(workspaceDir, {
      matterId: input.matterId,
      kind: "invite.revoke",
      actorId: actor.lawyerId,
      actorName: actor.displayName,
      payload: { inviteId: input.inviteId, via: "cloud" },
    });
  } catch {
    /* 同上 */
  }
  return { inviteId: r.invite.inviteId, status: r.invite.status };
}

/**
 * 兑换云邀请码。
 *
 * 顺序刻意如此：
 * 1. 先在云上兑换（权威写：加成员）
 * 2. 再写本地名册（投影：让签出/权限立刻可用）
 * 3. 记 `invite.accept` + 公布公钥（让其他机器与密钥补发能接上）
 * 4. 找钥匙：邀请码解 op 里的 `matter_key.share`；没有就等主办端补发
 */
export async function acceptCloudInvite(
  workspaceDir: string,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<{ matterId: string; role: string; matterTitle: string; keyInstalled: boolean }> {
  const client = cloudClientForWorkspace(workspaceDir, fetchImpl);
  if (!client) {
    throw new Error("未配置案件云（matterReplica.endpoint + cloudToken）");
  }
  const redeemed = await client.redeemInvite(token);
  const lookup = cloudMembershipView(redeemed.membership);

  // 本地投影：云侧名册 → 本地名册
  projectCloudMembership(workspaceDir, redeemed.membership, lookup.matterTitle);

  const actor = resolveReplicaActor(workspaceDir);
  const myRole = redeemed.membership.members.find((m) => m.lawyerId === actor.lawyerId)?.role;
  const target = readMembership(workspaceDir, redeemed.membership.matterId);
  if (actor.source !== "ephemeral" && myRole && target) {
    const existing = target.members.find((m) => m.lawyerId === actor.lawyerId);
    const member: MatterReplicaMember = {
      lawyerId: actor.lawyerId,
      displayName: actor.displayName,
      email: actor.email ?? existing?.email,
      role: myRole,
      status: "active",
      joinedAt: existing?.joinedAt ?? new Date().toISOString(),
      invitedBy: redeemed.invite.invitedBy,
    };
    writeMembership(workspaceDir, upsertMember(target, member, actor.lawyerId));
    try {
      appendRecordOp(workspaceDir, {
        matterId: redeemed.membership.matterId,
        kind: "invite.accept",
        actorId: actor.lawyerId,
        actorName: actor.displayName,
        payload: {
          inviteId: redeemed.invite.inviteId,
          role: myRole,
          email: actor.email ?? redeemed.invite.email,
          invitedBy: redeemed.invite.invitedBy,
          via: "cloud",
        },
      });
      publishMemberPublicKey(workspaceDir, redeemed.membership.matterId);
    } catch {
      /* 留痕失败不影响加入本身 */
    }
  }

  // 钥匙：先试本地 op 里的 matter_key.share（老路径），再等主办端补发
  let keyInstalled = false;
  try {
    acceptInviteByToken(workspaceDir, token);
    keyInstalled = true;
  } catch {
    /* 云邀请没有本地邀请记录，属预期；钥匙由 shareCurrentMatterKeyWithMembers 补 */
  }

  return {
    matterId: redeemed.membership.matterId,
    role: myRole ?? "associate",
    matterTitle: lookup.matterTitle,
    keyInstalled,
  };
}

/** 拉云侧名册（云为权威；本地名册可能滞后）。 */
export async function fetchCloudMembership(
  workspaceDir: string,
  matterId: string,
  fetchImpl?: typeof fetch,
): Promise<CloudMembership | null> {
  const client = cloudClientForWorkspace(workspaceDir, fetchImpl);
  if (!client) {
    return null;
  }
  return client.fetchMembership(matterId);
}

/**
 * 确保云侧有本案名册且我在册（首次用云时名册可能只存在于本地）。
 * 不做「用本地覆盖云」—— 只在云侧**没有**名册时以本机为主办建一个。
 */
async function ensureCloudMembership(
  client: MatterCloudClient,
  workspaceDir: string,
  matterId: string,
  matterTitle: string,
): Promise<void> {
  const actor = resolveReplicaActor(workspaceDir);
  if (actor.source === "ephemeral") {
    throw new Error("请先设置姓名与邮箱");
  }
  const cloud = await client.fetchMembership(matterId);
  const members = cloud?.members ?? [];
  const mine = members.find((m) => m.lawyerId === actor.lawyerId);
  if (mine?.status === "active") {
    return;
  }
  const local = readMembership(workspaceDir, matterId);
  const localActive = local ? listActiveMembers(local) : [];
  // 云上没有我：以本机名册为准推一次（我是主办才能推；否则服务端会 403，错误如实抛出）
  await client.pushMembership(matterId, {
    version: 1,
    tenantId: "",
    matterId,
    matterTitle: local?.matterTitle ?? matterTitle,
    members: localActive.map((m) => ({
      lawyerId: m.lawyerId,
      displayName: m.displayName,
      email: m.email,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
    })),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.lawyerId,
  });
}

/** 把云侧名册写成本地投影（只动成员，不动密钥/材料）。 */
export function projectCloudMembership(
  workspaceDir: string,
  cloud: CloudMembership,
  matterTitle?: string,
): void {
  const actor = resolveReplicaActor(workspaceDir);
  const base = readMembership(workspaceDir, cloud.matterId);
  const owner =
    cloud.members.find((m) => m.role === "owner") ??
    cloud.members.find((m) => m.status === "active");
  let membership = base;
  if (!membership) {
    if (!owner) {
      return;
    }
    membership = writeMembership(workspaceDir, {
      version: 1,
      matterId: cloud.matterId,
      matterTitle: matterTitle ?? cloud.matterTitle,
      replicaKey: cloud.matterId,
      members: [],
      updatedAt: new Date().toISOString(),
      updatedBy: owner.lawyerId,
    });
  }
  let next = membership;
  for (const m of cloud.members) {
    next = upsertMember(
      next,
      {
        lawyerId: m.lawyerId,
        displayName: m.displayName,
        email: m.email,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt,
      },
      actor.lawyerId,
    );
  }
  writeMembership(workspaceDir, next);
}

/** 新成员拿到钥匙的路径：主办端在同步时补发。返回本轮补发情况。 */
export function shareMatterKeyIfNeeded(
  workspaceDir: string,
  matterId: string,
): { sharedFor: string[]; missingPublicKey: string[] } {
  try {
    const r = shareCurrentMatterKeyWithMembers(workspaceDir, matterId);
    return { sharedFor: r.sharedFor, missingPublicKey: r.missingPublicKey };
  } catch {
    return { sharedFor: [], missingPublicKey: [] };
  }
}

/** 本地是否已记录该 inviteId（避免面板重复显示云与本地两份）。 */
export function hasLocalInviteRecord(
  workspaceDir: string,
  matterId: string,
  inviteId: string,
): boolean {
  return listRecordOps(workspaceDir, matterId).some(
    (op) => op.kind === "invite.create" && op.payload.inviteId === inviteId,
  );
}

/**
 * 云感知的同步：**云名册是权威**，所以顺序是
 *
 * 1. 拉云名册 → 投影到本地（新成员才会进入本地名册，签出/权限立刻正确）
 * 2. 常规同步（拉 op + apply + 材料；本轮会附带我刚才公布的公钥）
 * 3. 把**当前**案件密钥补发给还没拿到的成员（幂等）
 * 4. 若第 3 步有新分发，再推一次 ops，让对端本轮就能拿到钥匙
 *
 * 没配云时退化成纯 `syncMatterRecordPipe`，行为不变。
 */
export async function syncMatterWithCloud(
  workspaceDir: string,
  matterId: string,
  fetchImpl?: typeof fetch,
): Promise<{
  cloudRosterApplied: boolean;
  keySharedFor: string[];
  missingPublicKey: string[];
  sync: Awaited<ReturnType<typeof syncMatterRecordPipe>>;
}> {
  const client = cloudClientForWorkspace(workspaceDir, fetchImpl);
  let cloudRosterApplied = false;
  if (client) {
    try {
      const cloud = await client.fetchMembership(matterId);
      if (cloud) {
        const before = JSON.stringify(readMembership(workspaceDir, matterId)?.members ?? null);
        projectCloudMembership(workspaceDir, cloud);
        const after = JSON.stringify(readMembership(workspaceDir, matterId)?.members ?? null);
        cloudRosterApplied = true;
        if (before !== after) {
          const actor = resolveReplicaActor(workspaceDir);
          emitCollaborationAudit(workspaceDir, {
            matterId,
            kind: "collab.cloud_roster_applied",
            actorId: actor.lawyerId,
            actorName: actor.displayName,
            detail: `云名册更新本地名册（${cloud.members.length} 人）`,
          });
        }
      }
    } catch {
      /* 云名册拉取失败不阻断本地同步；下轮再试 */
    }
  }

  const sync = await syncMatterRecordPipe(workspaceDir, matterId);

  const shared = client
    ? shareMatterKeyIfNeeded(workspaceDir, matterId)
    : { sharedFor: [], missingPublicKey: [] };
  if (shared.sharedFor.length > 0) {
    try {
      // 补发的钥匙 op 要立刻推上去，否则对端要等下一轮
      await syncMatterRecordPipe(workspaceDir, matterId);
    } catch {
      /* 下轮同步会带上这条 op */
    }
  }
  return {
    cloudRosterApplied,
    keySharedFor: shared.sharedFor,
    missingPublicKey: shared.missingPublicKey,
    sync,
  };
}

function cloudMembershipView(m: CloudMembership): { matterTitle: string } {
  return { matterTitle: m.matterTitle };
}
