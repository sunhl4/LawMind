/**
 * Matter Replica HTTP routes — Firm-gated multi-lawyer matter collaboration.
 */

import { z } from "zod";
import { loadMatter } from "../../../src/lawmind/adapters/matter-storage/index.js";
import {
  MATTER_REPLICA_ROLE_LABELS,
  acceptInviteByToken,
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
  scanMatterMaterials,
  syncMatterRecordPipe,
  upsertLawyerIdentity,
} from "../../../src/lawmind/matter-replica/index.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
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
    sendJson(
      res,
      200,
      {
        ok: true,
        enabled: gate.enabled,
        reason: gate.reason,
        edition: gate.edition,
        cloudEndpoint: gate.cloudEndpoint ?? null,
        sharedRelayDir: gate.sharedRelayDir ?? null,
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
    try {
      const invite = createInvite(workspaceDir, {
        matterId: body.matterId,
        matterTitle: matterTitle(workspaceDir, body.matterId),
        email: body.email,
        role: body.role,
      });
      sendJson(
        res,
        200,
        {
          ok: true,
          invite,
          pack: exportInvitePack(invite),
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
    try {
      const result = acceptInviteByToken(workspaceDir, body.token);
      sendJson(res, 200, { ok: true, ...result }, c);
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
    try {
      const invite = revokeInvite(workspaceDir, body.matterId, body.inviteId);
      sendJson(res, 200, { ok: true, invite }, c);
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
      sendJson(res, 200, { ok: true, membership: next }, c);
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
      const result = await syncMatterRecordPipe(workspaceDir, matterId);
      sendJson(res, 200, { ok: true, ...result }, c);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  return false;
}
