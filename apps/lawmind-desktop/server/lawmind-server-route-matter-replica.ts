/**
 * Matter Replica HTTP routes — Firm-gated multi-lawyer matter collaboration.
 */

import { z } from "zod";
import { loadMatter } from "../../../src/lawmind/adapters/matter-storage/index.js";
import {
  MATTER_REPLICA_ROLE_LABELS,
  acceptInviteByToken,
  appendRecordOp,
  acquireCheckoutLock,
  createInvite,
  ensureMembershipWithOwner,
  evaluateMatterReplicaGate,
  exportInvitePack,
  listActiveMembers,
  listCheckoutLocks,
  listInvites,
  listMatterReplicaFeed,
  listRecordOps,
  publishLocalMaterials,
  readLawyerIdentity,
  readMaterialsIndex,
  readMembership,
  releaseCheckoutLock,
  revokeInvite,
  revokeMember,
  rotateAndShareMatterKey,
  scanMatterMaterials,
  upsertLawyerIdentity,
} from "../../../src/lawmind/matter-replica/index.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { getMatterReplicaScheduler } from "./lawmind-server-matter-replica-scheduler.js";
import {
  buildFirmCollaborationAuditReport,
  emitCollaborationAudit,
  formatFirmCollaborationAuditMarkdown,
} from "../../../src/lawmind/audit/collaboration-audit.js";
import { sendJson } from "./lawmind-server-helpers.js";
import {
  acceptCloudInvite,
  cloudConnectionInfo,
  createCloudInvite,
  revokeCloudInvite,
  shareMatterKeyIfNeeded,
  syncMatterWithCloud,
} from "../../../src/lawmind/matter-cloud/index.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import {
  assertMemberCapability,
  writeMembership,
} from "../../../src/lawmind/matter-replica/membership.js";

const identityPutSchema = z.object({
  displayName: z.string().min(1).max(80),
  email: z.string().max(200).optional(),
});

const inviteCreateSchema = z.object({
  matterId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["owner", "lead", "associate", "paralegal", "readonly", "external"]),
});

const inviteAcceptSchema = z.object({
  token: z.string().min(4).max(64),
});

const inviteRevokeSchema = z.object({
  matterId: z.string().min(1),
  inviteId: z.string().min(1),
});

const memberRevokeSchema = z.object({
  matterId: z.string().min(1),
  lawyerId: z.string().min(1),
});

const lockAcquireSchema = z.object({
  matterId: z.string().min(1),
  relPath: z.string().min(1),
  note: z.string().max(200).optional(),
});

const lockReleaseSchema = z.object({
  matterId: z.string().min(1),
  relPath: z.string().min(1),
  force: z.boolean().optional(),
});

function matterTitle(workspaceDir: string, matterId: string): string {
  const rec = loadMatter(workspaceDir, matterId);
  return rec?.title?.trim() || matterId;
}

function requireEnabled(workspaceDir: string): ReturnType<typeof evaluateMatterReplicaGate> {
  return evaluateMatterReplicaGate(workspaceDir);
}

export async function handleMatterReplicaRoutes({
  ctx,
  req,
  res,
  url,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (!pathname.startsWith("/api/matter-replica")) {
    return false;
  }

  const { workspaceDir } = ctx;
  const gate = requireEnabled(workspaceDir);

  if (pathname === "/api/matter-replica/status" && req.method === "GET") {
    const connection = cloudConnectionInfo(workspaceDir);
    sendJson(
      res,
      200,
      {
        ok: true,
        enabled: gate.enabled,
        reason: gate.reason,
        edition: gate.edition,
        cloudEndpoint: gate.cloudEndpoint ?? null,
        // 云是否真的可用（endpoint + token 都在），并说明权威性归属
        cloud: {
          configured: connection.configured,
          endpoint: connection.endpoint,
          hasToken: connection.hasToken,
          // 配了云就是「云为权威」：邀请由服务端建、由服务端记状态
          inviteAuthority: connection.configured ? "cloud" : "local",
        },
        sharedRelayDir: gate.sharedRelayDir ?? null,
        cloudDataDir:
          gate.cloudDataDir ??
          (gate.enabled ? `${workspaceDir.replace(/\\/g, "/")}/lawmind/replica-cloud` : null),
        localCloudPaths: gate.enabled
          ? {
              ops: "/v1/matters/:matterId/ops",
              manifest: "/v1/matters/:matterId/materials/manifest",
              blobs: "/v1/matters/:matterId/blobs/:sha256",
            }
          : null,
        roleLabels: MATTER_REPLICA_ROLE_LABELS,
        identity: readLawyerIdentity(workspaceDir),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/matter-replica/identity" && req.method === "GET") {
    sendJson(res, 200, { ok: true, identity: readLawyerIdentity(workspaceDir) }, c);
    return true;
  }

  if (pathname === "/api/matter-replica/identity" && req.method === "PUT") {
    let body;
    try {
      body = await parseJsonBodyZod(req, identityPutSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    try {
      const identity = upsertLawyerIdentity(workspaceDir, {
        displayName: body.displayName,
        email: body.email?.trim() || undefined,
      });
      sendJson(res, 200, { ok: true, identity }, c);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  // 调度器状态与 /status 同级：只读、无卷宗内容，门控关闭时也回可解释的 enabled/reason
  if (pathname === "/api/matter-replica/audit-report" && req.method === "GET") {
    const since = url.searchParams.get("since")?.trim() || undefined;
    const until = url.searchParams.get("until")?.trim() || undefined;
    const matterIdFilter = url.searchParams.get("matterId")?.trim() || undefined;
    const format = url.searchParams.get("format")?.trim() || "json";
    try {
      const report = await buildFirmCollaborationAuditReport(workspaceDir, {
        since,
        until,
        matterId: matterIdFilter,
      });
      if (format === "markdown" || format === "text") {
        const md = formatFirmCollaborationAuditMarkdown(report);
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "content-length": String(Buffer.byteLength(md)),
          ...c,
        });
        res.end(md);
        return true;
      }
      sendJson(res, 200, { ok: true, report }, c);
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/matter-replica/scheduler" && req.method === "GET") {
    const scheduler = getMatterReplicaScheduler();
    sendJson(
      res,
      200,
      {
        ok: true,
        // 调度器缺席（daemon 模式 / 未启动）时也回一个可解释的形状，不让 UI 猜
        scheduler: scheduler?.status() ?? {
          enabled: gate.enabled,
          autoSync: gate.autoSync,
          reason: gate.reason,
          running: false,
          intervalMs: null,
          watchingRelay: false,
          relayDir: gate.sharedRelayDir ?? null,
          matters: 0,
          syncs: 0,
          skipped: 0,
          lastRunAt: null,
          lastRunMs: null,
          lastError: null,
        },
      },
      c,
    );
    return true;
  }

  // Remaining routes require feature enabled
  if (!gate.enabled) {
    sendJson(
      res,
      403,
      {
        ok: false,
        error: "案件成员协作未开启（独立律师版默认关闭；律所协作版可用）",
        reason: gate.reason,
      },
      c,
    );
    return true;
  }


  // 手动触发一轮：与面板上的「同步记录与材料」不同，这里跑的是**全部在册案件**
  if (pathname === "/api/matter-replica/scheduler/tick" && req.method === "POST") {
    const scheduler = getMatterReplicaScheduler();
    if (!scheduler) {
      sendJson(res, 409, { ok: false, error: "自动同步调度器未运行" }, c);
      return true;
    }
    try {
      const outcomes = await scheduler.tick();
      sendJson(
        res,
        200,
        {
          ok: true,
          outcomes,
          synced: outcomes.filter((o) => o.ok).length,
          failed: outcomes.filter((o) => !o.ok).length,
          status: scheduler.status(),
        },
        c,
      );
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/matter-replica/membership" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!matterId) {
      sendJson(res, 400, { ok: false, error: "missing matterId" }, c);
      return true;
    }
    let membership = readMembership(workspaceDir, matterId);
    if (!membership) {
      const identity = readLawyerIdentity(workspaceDir);
      if (identity) {
        membership = ensureMembershipWithOwner(workspaceDir, {
          matterId,
          matterTitle: matterTitle(workspaceDir, matterId),
          ownerLawyerId: identity.lawyerId,
          ownerDisplayName: identity.displayName,
          ownerEmail: identity.email,
        });
      }
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        membership,
        members: membership ? listActiveMembers(membership) : [],
        invites: membership ? listInvites(workspaceDir, matterId).filter((i) => i.status === "pending") : [],
        locks: membership ? listCheckoutLocks(workspaceDir, matterId) : [],
        materials: membership
          ? (readMaterialsIndex(workspaceDir, matterId)?.files ?? scanMatterMaterials(workspaceDir, matterId))
          : [],
        feed: membership ? listMatterReplicaFeed(workspaceDir, matterId, { limit: 30 }) : [],
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/matter-replica/invites" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, inviteCreateSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    const title = matterTitle(workspaceDir, body.matterId);
    const cloud = cloudConnectionInfo(workspaceDir);
    // 配了云就以云为权威：邀请由服务端建、由服务端记状态，本地不再自己造邀请码
    if (cloud.configured) {
      try {
        const invite = await createCloudInvite(workspaceDir, {
          matterId: body.matterId,
          matterTitle: title,
          email: body.email,
          role: body.role,
        });
        sendJson(
          res,
          200,
          {
            ok: true,
            via: "cloud",
            invite: {
              inviteId: invite.inviteId,
              matterId: invite.matterId,
              matterTitle: title,
              token: invite.token,
              email: invite.email,
              role: invite.role,
              status: "pending",
              expiresAt: invite.expiresAt,
            },
            shareText: invite.shareText,
          },
          c,
        );
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
      }
      return true;
    }
    try {
      const invite = createInvite(workspaceDir, {
        matterId: body.matterId,
        matterTitle: title,
        email: body.email,
        role: body.role,
      });
      sendJson(
        res,
        200,
        {
          ok: true,
          via: "local",
          invite,
          pack: exportInvitePack(workspaceDir, invite),
          shareText: `邀请你加入 LawMind 案件「${invite.matterTitle}」。打开 LawMind → 案件 → 成员协作，粘贴邀请码：${invite.token}`,
        },
        c,
      );
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/matter-replica/invites/accept" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, inviteAcceptSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    const cloud = cloudConnectionInfo(workspaceDir);
    // 云邀请码（LMC- 前缀）走云；其余按本地邀请码处理，兼容旧部署
    const looksCloud = body.token.trim().toUpperCase().startsWith("LMC-");
    if (cloud.configured && looksCloud) {
      try {
        const joined = await acceptCloudInvite(workspaceDir, body.token);
        // 新成员的公钥刚公布，主办端下一轮会补发钥匙；这里顺手试一次让本地尽快可用
        shareMatterKeyIfNeeded(workspaceDir, joined.matterId);
        sendJson(res, 200, { ok: true, via: "cloud", ...joined }, c);
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
      }
      return true;
    }
    try {
      const result = acceptInviteByToken(workspaceDir, body.token);
      sendJson(res, 200, { ok: true, via: "local", ...result }, c);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/matter-replica/invites/revoke" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, inviteRevokeSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    if (cloudConnectionInfo(workspaceDir).configured) {
      try {
        const r = await revokeCloudInvite(workspaceDir, {
          matterId: body.matterId,
          inviteId: body.inviteId,
        });
        sendJson(res, 200, { ok: true, via: "cloud", ...r }, c);
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
      }
      return true;
    }
    try {
      const invite = revokeInvite(workspaceDir, body.matterId, body.inviteId);
      sendJson(res, 200, { ok: true, via: "local", invite }, c);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/matter-replica/members/revoke" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, memberRevokeSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    try {
      const membership = readMembership(workspaceDir, body.matterId);
      if (!membership) {
        sendJson(res, 404, { ok: false, error: "本案尚无成员名册" }, c);
        return true;
      }
      const identity = readLawyerIdentity(workspaceDir);
      if (!identity) {
        sendJson(res, 400, { ok: false, error: "请先设置你的姓名" }, c);
        return true;
      }
      assertMemberCapability(membership, identity.lawyerId, "manage_members");
      const next = revokeMember(membership, body.lawyerId, identity.lawyerId);
      writeMembership(workspaceDir, next);
      // 移出成员也要成为 op，否则对端名册不会跟着变（apply 层按 op 投影）
      appendRecordOp(workspaceDir, {
        matterId: body.matterId,
        kind: "member.revoke",
        actorId: identity.lawyerId,
        actorName: identity.displayName,
        payload: { lawyerId: body.lawyerId },
      });
      emitCollaborationAudit(workspaceDir, {
        matterId: body.matterId,
        kind: "collab.member_removed",
        actorId: identity.lawyerId,
        actorName: identity.displayName,
        detail: `移出成员 ${body.lawyerId}`,
      });
      // 被移出的人**已经握着**案件密钥，所以必须轮换，否则他仍能读后续内容
      try {
        const rotated = rotateAndShareMatterKey(workspaceDir, body.matterId);
        sendJson(
          res,
          200,
          {
            ok: true,
            membership: next,
            keyRotated: true,
            wrappedFor: rotated.wrappedFor.length,
            // 没公布公钥的老客户端换不到新钥匙 —— 要让人看得见，而不是静默失效
            rotationSkipped: rotated.skipped,
          },
          c,
        );
      } catch (e) {
        sendJson(
          res,
          200,
          {
            ok: true,
            membership: next,
            keyRotated: false,
            warning: `成员已移除，但密钥轮换失败：${e instanceof Error ? e.message : String(e)}`,
          },
          c,
        );
      }
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/matter-replica/locks" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!matterId) {
      sendJson(res, 400, { ok: false, error: "missing matterId" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, locks: listCheckoutLocks(workspaceDir, matterId) }, c);
    return true;
  }

  if (pathname === "/api/matter-replica/locks/acquire" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, lockAcquireSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    try {
      const lock = acquireCheckoutLock(workspaceDir, {
        matterId: body.matterId,
        matterTitle: matterTitle(workspaceDir, body.matterId),
        relPath: body.relPath,
        note: body.note,
      });
      sendJson(res, 200, { ok: true, lock }, c);
    } catch (e) {
      sendJson(res, 409, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/matter-replica/locks/release" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, lockReleaseSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    try {
      releaseCheckoutLock(workspaceDir, body.matterId, body.relPath, { force: body.force });
      sendJson(res, 200, { ok: true }, c);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/matter-replica/ops" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!matterId) {
      sendJson(res, 400, { ok: false, error: "missing matterId" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, ops: listRecordOps(workspaceDir, matterId) }, c);
    return true;
  }

  if (pathname === "/api/matter-replica/feed" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!matterId) {
      sendJson(res, 400, { ok: false, error: "missing matterId" }, c);
      return true;
    }
    sendJson(
      res,
      200,
      { ok: true, feed: listMatterReplicaFeed(workspaceDir, matterId, { limit: 40 }) },
      c,
    );
    return true;
  }

  if (pathname === "/api/matter-replica/materials" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!matterId) {
      sendJson(res, 400, { ok: false, error: "missing matterId" }, c);
      return true;
    }
    const index = readMaterialsIndex(workspaceDir, matterId);
    sendJson(
      res,
      200,
      {
        ok: true,
        files: index?.files ?? scanMatterMaterials(workspaceDir, matterId),
        updatedAt: index?.updatedAt ?? null,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/matter-replica/materials/publish" && req.method === "POST") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!matterId) {
      sendJson(res, 400, { ok: false, error: "missing matterId" }, c);
      return true;
    }
    try {
      const result = publishLocalMaterials(workspaceDir, matterId);
      sendJson(
        res,
        200,
        { ok: true, changed: result.changed.length, files: result.index.files },
        c,
      );
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/matter-replica/sync" && req.method === "POST") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!matterId) {
      sendJson(res, 400, { ok: false, error: "missing matterId" }, c);
      return true;
    }
    try {
      // 云感知同步：云名册为权威 → 投影本地 → 常规同步 → 补发钥匙给新成员
      const result = await syncMatterWithCloud(workspaceDir, matterId);
      sendJson(
        res,
        200,
        {
          ok: true,
          published: result.sync.published,
          pulled: result.sync.pulled,
          applied: result.sync.applied,
          materials: result.sync.materials,
          materialsError: result.sync.materialsError,
          cloudRosterApplied: result.cloudRosterApplied,
          keySharedFor: result.keySharedFor,
          missingPublicKey: result.missingPublicKey,
        },
        c,
      );
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  return false;
}
