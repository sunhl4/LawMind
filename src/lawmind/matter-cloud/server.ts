/**
 * 托管案件云 HTTP 服务端。
 *
 * ## 契约
 *
 * 与桌面端已有的客户端同契约（`src/lawmind/matter-replica/http-relay.ts`），
 * 所以桌面端只要把 `matterReplica.endpoint` 指过来即可，无需改协议：
 *
 *   GET  /v1/health
 *   GET  /v1/me
 *   GET  /v1/matters/:id/ops | PUT
 *   GET  /v1/matters/:id/materials/manifest | PUT
 *   GET  /v1/matters/:id/blobs/:sha256 | PUT
 *   GET  /v1/matters/:id/membership | PUT      （云侧名册，桌面按需拉取）
 *   POST /v1/matters/:id/invites
 *   POST /v1/matters/:id/invites/revoke
 *   POST /v1/invites/redeem
 *
 * ## 鉴权与授权是两道独立门
 *
 * 1. **认证**：`Authorization: Bearer <token>` → 账号（令牌哈希落盘，明文不存）。
 * 2. **授权**：账号 → （租户 + lawyerId）→ 案件成员角色 → 能力。
 *    能力矩阵直接复用桌面端的 `ROLE_CAPABILITIES`，所以「服务端允许的」和
 *    「客户端以为允许的」不会漂移。
 *
 * 映射（刻意保守）：
 *
 * | 端点              | 需要的能力 / 身份                        |
 * | ----------------- | ---------------------------------------- |
 * | ops GET           | 在册成员（`external` 除外）              |
 * | ops PUT           | `edit_matter_records`                    |
 * | manifest GET      | 在册成员（`external` 除外）              |
 * | manifest PUT      | `upload_materials`（墓碑删除另需 `delete_materials`） |
 * | blobs GET         | 在册成员（`external` 除外）              |
 * | blobs PUT         | `upload_materials`                       |
 * | membership GET    | 在册成员                                 |
 * | membership PUT    | `manage_members`                         |
 * | invites POST      | `invite`                                 |
 *
 * ## 完整性在服务端也验一遍
 *
 * 客户端已按 manifest 的 `sha256` 校验（判据 X5），但服务端**不能**依赖客户端：
 * `PUT blobs/:sha256` 会重算哈希，不符直接 400。否则中继本身就成了污染源。
 */

import { createHash } from "node:crypto";
import http from "node:http";
import { isSealedEnvelope } from "../matter-replica/crypto-envelope.js";
import {
  handleMatterCloudRequest,
  matchMatterCloudPath,
} from "../matter-replica/matter-cloud-http.js";
import { MatterCloudStore } from "../matter-replica/matter-cloud-store.js";
import {
  roleHasCapability,
  type MatterMaterialEntry,
  type MatterRecordOp,
  type MatterReplicaCapability,
} from "../matter-replica/types.js";
import { MatterCloudDirectory, safeCloudId } from "./directory.js";
import type { CloudAuth, CloudRequestResult } from "./types.js";

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_BLOB_BYTES = 64 * 1024 * 1024;

export type MatterCloudServerOptions = {
  dataDir: string;
  logger?: (message: string) => void;
};

export type MatterCloudServer = {
  server: http.Server;
  directory: MatterCloudDirectory;
  dataDir: string;
  /** 监听并返回 base url（如 `http://127.0.0.1:53211`）。 */
  listen: (port: number, host?: string) => Promise<string>;
  close: () => Promise<void>;
};

function json(status: number, body: unknown): CloudRequestResult {
  return { status, json: body };
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function bearer(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

const MATTER_ROUTE =
  /^\/v1\/matters\/([a-zA-Z0-9_-]{1,128})\/(ops|materials\/manifest|blobs\/[a-fA-F0-9]{64}|membership|invites|invites\/revoke)$/;

export function createMatterCloudServer(opts: MatterCloudServerOptions): MatterCloudServer {
  const directory = new MatterCloudDirectory(opts.dataDir);
  const stores = new Map<string, MatterCloudStore>();
  const log = opts.logger ?? (() => undefined);

  const storeFor = (tenantId: string): MatterCloudStore => {
    const key = tenantId;
    let store = stores.get(key);
    if (!store) {
      store = new MatterCloudStore(directory.cloudMattersDir(tenantId));
      stores.set(key, store);
    }
    return store;
  };

  /**
   * 授权：在册成员 + 能力。
   *
   * 读（`member`）与写（`capability`）分开：
   * - **读**：在册成员即可，但 `external`（仅上传）排除 —— 他拿不到卷宗内容。
   * - **写**：只由能力矩阵裁决。`external` 的 `upload_materials` 必须放行，
   *   否则「外协只能上传」这条产品设计在服务端就成了「外协什么都不能做」。
   */
  const authorize = (
    auth: CloudAuth,
    matterId: string,
    need: { member: true } | { capability: MatterReplicaCapability },
  ): CloudRequestResult | null => {
    const member = directory.findMember(auth.tenantId, matterId, auth.account.lawyerId);
    if (!member || member.status !== "active") {
      return json(403, { ok: false, error: "not_a_matter_member" });
    }
    if ("member" in need) {
      if (member.role === "external") {
        return json(403, { ok: false, error: "role_cannot_read" });
      }
      return null;
    }
    if (!roleHasCapability(member.role, need.capability)) {
      return json(403, { ok: false, error: "role_lacks_capability", capability: need.capability });
    }
    return null;
  };

  const handle = async (
    req: http.IncomingMessage,
    url: URL,
  ): Promise<CloudRequestResult | null> => {
    const method = (req.method ?? "GET").toUpperCase();
    const pathname = url.pathname;

    // 健康检查免鉴权：负载均衡 / 探活需要，且不含任何数据
    if (pathname === "/v1/health" && method === "GET") {
      return json(200, {
        ok: true,
        service: "lawmind-matter-cloud",
        version: 1,
        tenants: directory.listTenants().length,
      });
    }

    // ── 认证 ──────────────────────────────────────────────────────────────
    const account = directory.authenticate(bearer(req));
    if (!account) {
      return json(401, { ok: false, error: "unauthorized" });
    }
    const auth: CloudAuth = { account, tenantId: account.tenantId };

    if (pathname === "/v1/me" && method === "GET") {
      return json(200, {
        ok: true,
        account: {
          accountId: account.accountId,
          tenantId: account.tenantId,
          lawyerId: account.lawyerId,
          displayName: account.displayName,
          email: account.email ?? null,
          role: account.role,
        },
      });
    }

    // ── 兑换邀请（不针对特定案件，故在 matter 路由之前） ──────────────────
    if (pathname === "/v1/invites/redeem" && method === "POST") {
      let payload: { token?: string };
      try {
        payload = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString("utf8")) as {
          token?: string;
        };
      } catch {
        return json(400, { ok: false, error: "invalid_json" });
      }
      try {
        const result = directory.redeemInvite({
          tenantId: auth.tenantId,
          token: payload.token ?? "",
          account: {
            lawyerId: account.lawyerId,
            displayName: account.displayName,
            email: account.email,
          },
        });
        return json(200, { ok: true, membership: result.membership, invite: result.invite });
      } catch (err) {
        return json(400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const route = MATTER_ROUTE.exec(pathname);
    if (!route) {
      return null;
    }
    const matterId = safeCloudId(route[1], "matterId");
    const kind = route[2];
    const store = storeFor(auth.tenantId);

    // ── 名册 ──────────────────────────────────────────────────────────────
    if (kind === "membership") {
      if (method === "GET") {
        const denied = authorize(auth, matterId, { member: true });
        if (denied) {
          return denied;
        }
        const membership = directory.readMembership(auth.tenantId, matterId);
        if (!membership) {
          return json(404, { ok: false, error: "no_membership" });
        }
        return json(200, { ok: true, membership });
      }
      if (method === "PUT") {
        const denied = authorize(auth, matterId, { capability: "manage_members" });
        if (denied) {
          return denied;
        }
        let incoming: { members?: unknown };
        try {
          incoming = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString("utf8")) as {
            members?: unknown;
          };
        } catch {
          return json(400, { ok: false, error: "invalid_json" });
        }
        if (!Array.isArray(incoming.members)) {
          return json(400, { ok: false, error: "members_required" });
        }
        const current = directory.readMembership(auth.tenantId, matterId);
        const next = directory.writeMembership({
          version: 1,
          tenantId: auth.tenantId,
          matterId,
          matterTitle: current?.matterTitle ?? matterId,
          // 客户端只能改成员，不能借 PUT 改租户/案件键
          members: incoming.members as never,
          updatedAt: new Date().toISOString(),
          updatedBy: account.lawyerId,
        });
        return json(200, { ok: true, membership: next });
      }
      return json(405, { ok: false, error: "method_not_allowed" });
    }

    // ── 邀请（服务器侧） ──────────────────────────────────────────────────
    if (kind === "invites" || kind === "invites/revoke") {
      if (method !== "POST") {
        return json(405, { ok: false, error: "method_not_allowed" });
      }
      const denied = authorize(auth, matterId, { capability: "invite" });
      if (denied) {
        return denied;
      }
      let payload: { email?: string; role?: string; inviteId?: string };
      try {
        payload = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString("utf8")) as {
          email?: string;
          role?: string;
          inviteId?: string;
        };
      } catch {
        return json(400, { ok: false, error: "invalid_json" });
      }
      try {
        if (kind === "invites") {
          const membership = directory.readMembership(auth.tenantId, matterId);
          const invite = directory.createInvite({
            tenantId: auth.tenantId,
            matterId,
            matterTitle: membership?.matterTitle ?? matterId,
            email: payload.email ?? "",
            role: (payload.role ?? "associate") as never,
            invitedBy: account.lawyerId,
            invitedByName: account.displayName,
          });
          return json(200, {
            ok: true,
            invite,
            shareText: `邀请你加入 LawMind 案件「${invite.matterTitle}」。在 LawMind 中粘贴云邀请码：${invite.token}`,
          });
        }
        return json(200, {
          ok: true,
          invite: directory.revokeInvite(auth.tenantId, payload.inviteId ?? ""),
        });
      } catch (err) {
        return json(400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── 数据面：ops / manifest / blobs ────────────────────────────────────
    // 读取复用既有的本地契约实现（`handleMatterCloudRequest`），
    // 但鉴权与完整性检查由本服务端接管，所以授权必须在这里先过。
    if (kind === "ops") {
      if (method === "GET") {
        const denied = authorize(auth, matterId, { member: true });
        if (denied) {
          return denied;
        }
        return (
          (await handleMatterCloudRequest(store, req, pathname)) ??
          json(404, { ok: false, error: "not_found" })
        );
      } else if (method === "PUT") {
        const denied = authorize(auth, matterId, { capability: "edit_matter_records" });
        if (denied) {
          return denied;
        }
        let payload: unknown;
        try {
          payload = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString("utf8"));
        } catch {
          return json(400, { ok: false, error: "invalid_json" });
        }
        const ops = Array.isArray((payload as { ops?: unknown })?.ops)
          ? (payload as { ops: MatterRecordOp[] }).ops
          : [];
        // 拒绝把 op 记到别的案件上（否则可用 A 案的权限污染 B 案）
        for (const op of ops) {
          if (op && typeof op === "object" && "matterId" in op && op.matterId !== matterId) {
            return json(400, { ok: false, error: "op_matter_mismatch" });
          }
        }
        const envelope = store.writeOps(matterId, ops);
        return json(200, envelope);
      } else {
        return json(405, { ok: false, error: "method_not_allowed" });
      }
    }

    if (kind === "materials/manifest") {
      if (method === "GET") {
        const denied = authorize(auth, matterId, { member: true });
        if (denied) {
          return denied;
        }
        return (
          (await handleMatterCloudRequest(store, req, pathname)) ??
          json(404, { ok: false, error: "not_found" })
        );
      } else if (method === "PUT") {
        const denied = authorize(auth, matterId, { capability: "upload_materials" });
        if (denied) {
          return denied;
        }
        let payload: { files?: unknown; removed?: unknown };
        try {
          payload = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString("utf8")) as {
            files?: unknown;
            removed?: unknown;
          };
        } catch {
          return json(400, { ok: false, error: "invalid_json" });
        }
        const removed = Array.isArray(payload.removed)
          ? (payload.removed as unknown[]).filter((s): s is string => typeof s === "string")
          : [];
        // 墓碑会真的删条目，比上传更危险：只给有 delete_materials 的角色
        // （`external` 的矩阵里没有它，所以外协无法借清单删别人材料）
        if (removed.length > 0) {
          const canDelete = authorize(auth, matterId, { capability: "delete_materials" });
          if (canDelete) {
            return canDelete;
          }
        }
        const files = Array.isArray(payload.files) ? (payload.files as MatterMaterialEntry[]) : [];
        const envelope = store.writeManifest(matterId, files, removed);
        return json(200, envelope);
      } else {
        return json(405, { ok: false, error: "method_not_allowed" });
      }
    }

    // blobs：沿用既有的 local 契约（matchMatterCloudPath 已校验 sha 格式），
    // 但鉴权与完整性由本服务端接管。
    if (kind?.startsWith("blobs/")) {
      const parsed = matchMatterCloudPath(pathname);
      if (!parsed || parsed.kind !== "blob" || !parsed.sha256) {
        return json(400, { ok: false, error: "bad_blob_path" });
      }
      const sha = parsed.sha256;
      if (method === "GET") {
        const denied = authorize(auth, matterId, { member: true });
        if (denied) {
          return denied;
        }
        const buf = store.getBlob(matterId, sha);
        if (!buf) {
          return json(404, { ok: false, error: "blob_not_found" });
        }
        return { status: 200, headers: { "content-type": "application/octet-stream" }, body: buf };
      }
      if (method === "PUT") {
        const denied = authorize(auth, matterId, { capability: "upload_materials" });
        if (denied) {
          return denied;
        }
        let bytes: Buffer;
        try {
          bytes = await readBody(req, MAX_BLOB_BYTES);
        } catch {
          return json(413, { ok: false, error: "blob_too_large" });
        }
        // 完整性检查的**边界**：客户端开启端到端加密时，上传的是密文，而路径上的哈希是
        // **明文**的哈希 —— 服务端没有密钥，重算必然不等。这是 E2EE 的固有取舍，不是 bug：
        //   · 明文部署（无 E2EE）：服务端重算哈希，不符即 400，中继无法被当作污染源；
        //   · 密文部署（E2EE）：服务端只校验格式与大小；真实性与完整性由
        //     AES-GCM 认证标签 + 客户端按 manifest 的 sha256 校验（判据 X5）共同保证。
        // 若在这里一律强制比对，E2EE 就永远无法上传 —— 所以必须按是否封套分流。
        if (isSealedEnvelope(bytes)) {
          const { created } = store.putBlob(matterId, sha, bytes);
          return json(created ? 201 : 409, { ok: true, sha256: sha, created, sealed: true });
        }
        const actual = createHash("sha256").update(bytes).digest("hex");
        if (actual !== sha) {
          log(`blob hash mismatch tenant=${auth.tenantId} matter=${matterId}`);
          return json(400, { ok: false, error: "blob_hash_mismatch", expected: sha, actual });
        }
        const { created } = store.putBlob(matterId, sha, bytes);
        return json(created ? 201 : 409, { ok: true, sha256: sha, created });
      }
      return json(405, { ok: false, error: "method_not_allowed" });
    }

    return json(404, { ok: false, error: "not_found" });
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void handle(req, url)
      .then((result) => {
        if (!result) {
          res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "not_found" }));
          return;
        }
        if (result.body) {
          res.writeHead(result.status, {
            "content-type": "application/octet-stream",
            "content-length": String(result.body.length),
            ...result.headers,
          });
          res.end(result.body);
          return;
        }
        const payload = JSON.stringify(result.json ?? {});
        res.writeHead(result.status, {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(Buffer.byteLength(payload)),
        });
        res.end(payload);
      })
      .catch((err) => {
        log(`unhandled: ${err instanceof Error ? err.message : String(err)}`);
        const payload = JSON.stringify({ ok: false, error: "internal_error" });
        res.writeHead(500, {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(Buffer.byteLength(payload)),
        });
        res.end(payload);
      });
  });

  return {
    server,
    directory,
    dataDir: opts.dataDir,
    listen: (port, host = "127.0.0.1") =>
      new Promise<string>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const addr = server.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : port;
          resolve(`http://${host}:${actualPort}`);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
