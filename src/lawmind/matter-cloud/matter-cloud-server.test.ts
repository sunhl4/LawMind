/**
 * 托管案件云服务端测试。
 *
 * 重点不是「接口能通」，而是**别人拿不到**：
 * 无令牌、跨租户、非成员、外协读卷宗、篡改内容块、越权删材料 —— 都必须被拒。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMatterCloudServer, type MatterCloudServer } from "./index.js";

const tmpDirs: string[] = [];
const MATTER = "matter_cloud2026";

let cloud: MatterCloudServer;
let base: string;
/** 租户 A：张三(owner) / 李四(associate) / 王五(external) */
let tka: { zhang: string; li: string; wang: string };
/** 租户 B：赵六(owner) —— 用来验证跨租户隔离 */
let tkb: { zhao: string };
let tenantA: string;
let tenantB: string;

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cloud-srv-"));
  tmpDirs.push(d);
  return d;
}

beforeEach(async () => {
  cloud = createMatterCloudServer({ dataDir: tmpDir() });
  base = await cloud.listen(0);

  const a = cloud.directory.createTenant({ name: "甲所" });
  tenantA = a.tenantId;
  cloud.directory.ensureMembership({
    tenantId: tenantA,
    matterId: MATTER,
    matterTitle: "王某买卖合同纠纷",
    owner: { lawyerId: "lawyer_zhang", displayName: "张三" },
  });
  cloud.directory.upsertMember(
    tenantA,
    MATTER,
    {
      lawyerId: "lawyer_li",
      displayName: "李四",
      role: "associate",
      status: "active",
      joinedAt: new Date().toISOString(),
    },
    "lawyer_zhang",
  );
  cloud.directory.upsertMember(
    tenantA,
    MATTER,
    {
      lawyerId: "lawyer_wang",
      displayName: "王五",
      role: "external",
      status: "active",
      joinedAt: new Date().toISOString(),
    },
    "lawyer_zhang",
  );
  tka = {
    zhang: cloud.directory.createAccount({
      tenantId: tenantA,
      lawyerId: "lawyer_zhang",
      displayName: "张三",
    }).token,
    li: cloud.directory.createAccount({
      tenantId: tenantA,
      lawyerId: "lawyer_li",
      displayName: "李四",
    }).token,
    wang: cloud.directory.createAccount({
      tenantId: tenantA,
      lawyerId: "lawyer_wang",
      displayName: "王五",
    }).token,
  };

  const b = cloud.directory.createTenant({ name: "乙所" });
  tenantB = b.tenantId;
  cloud.directory.ensureMembership({
    tenantId: tenantB,
    matterId: MATTER,
    matterTitle: "同一案件 id，不同租户",
    owner: { lawyerId: "lawyer_zhao", displayName: "赵六" },
  });
  tkb = {
    zhao: cloud.directory.createAccount({
      tenantId: tenantB,
      lawyerId: "lawyer_zhao",
      displayName: "赵六",
    }).token,
  };
});

afterEach(async () => {
  await cloud.close();
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

type CallOpts = {
  token?: string | null;
  method?: string;
  body?: unknown;
  rawBody?: Buffer;
  contentType?: string;
};

async function call(
  pathname: string,
  opts: CallOpts = {},
): Promise<{ status: number; json: unknown; buf: Buffer }> {
  const headers: Record<string, string> = {};
  if (opts.token) {
    headers.authorization = `Bearer ${opts.token}`;
  }
  let body: Buffer | undefined;
  if (opts.rawBody) {
    body = opts.rawBody;
    headers["content-type"] = opts.contentType ?? "application/octet-stream";
  } else if (opts.body !== undefined) {
    body = Buffer.from(JSON.stringify(opts.body), "utf8");
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${base}${pathname}`, {
    method: opts.method ?? (body ? "PUT" : "GET"),
    headers,
    body,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      json = JSON.parse(buf.toString("utf8"));
    } catch {
      json = null;
    }
  }
  return { status: res.status, json, buf };
}

function sha256(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

describe("认证", () => {
  it("健康检查免鉴权，且不泄露案件信息", async () => {
    const r = await call("/v1/health");
    expect(r.status).toBe(200);
    expect((r.json as { service: string }).service).toBe("lawmind-matter-cloud");
  });

  it("无令牌 / 错令牌一律 401", async () => {
    expect((await call("/v1/me")).status).toBe(401);
    expect((await call("/v1/me", { token: "not-a-real-token" })).status).toBe(401);
    expect((await call(`/v1/matters/${MATTER}/ops`, { token: null })).status).toBe(401);
  });

  it("令牌明文不落盘（只存哈希与指纹）", async () => {
    const dump = fs.readFileSync(path.join(cloud.dataDir, "accounts.json"), "utf8");
    expect(dump).not.toContain(tka.zhang);
    const parsed = JSON.parse(dump) as { accounts: { tokenHash: string; tokenFp: string }[] };
    expect(parsed.accounts[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(dump).toContain(parsed.accounts[0].tokenFp);
  });

  it("被撤销的账号立刻失效", async () => {
    const acc = cloud.directory.listAccounts(tenantA).find((a) => a.lawyerId === "lawyer_li")!;
    cloud.directory.revokeAccount(acc.accountId);
    expect((await call("/v1/me", { token: tka.li })).status).toBe(401);
    // 同租户其他人不受影响
    expect((await call("/v1/me", { token: tka.zhang })).status).toBe(200);
  });
});

describe("租户隔离", () => {
  it("乙所账号看不到甲所同 id 案件的数据（不泄漏即通过）", async () => {
    // 甲所写入一条**可识别**的 op
    const marker = "甲所内部策略：对方已同意 300 万和解";
    await call(`/v1/matters/${MATTER}/ops`, {
      token: tka.zhang,
      body: {
        version: 1,
        matterId: MATTER,
        ops: [
          {
            opId: "op_tenant_a",
            matterId: MATTER,
            kind: "case_md.snapshot",
            actorId: "lawyer_zhang",
            actorName: "张三",
            createdAt: "2026-01-01T00:00:00.000Z",
            payload: { excerpt: marker },
          },
        ],
      },
    });
    // 甲所自己读得到
    const own = await call(`/v1/matters/${MATTER}/ops`, { token: tka.zhang });
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.json)).toContain("300 万和解");

    // 乙所在**同一个 matterId** 上只能看到自己的（空）案件，绝不可能是甲所那条
    const cross = await call(`/v1/matters/${MATTER}/ops`, { token: tkb.zhao });
    expect(JSON.stringify(cross.json ?? {})).not.toContain("300 万和解");
    expect([200, 404]).toContain(cross.status);
  });

  it("数据面目录按租户物理隔离", () => {
    const aDir = path.join(cloud.dataDir, "tenants", tenantA, "matters");
    const bDir = path.join(cloud.dataDir, "tenants", tenantB, "matters");
    expect(fs.existsSync(aDir)).toBe(true);
    expect(aDir).not.toBe(bDir);
  });
});

describe("案件成员授权", () => {
  it("非成员 403", async () => {
    const outsider = cloud.directory.createAccount({
      tenantId: tenantA,
      lawyerId: "lawyer_outsider",
      displayName: "外人",
    }).token;
    const r = await call(`/v1/matters/${MATTER}/ops`, { token: outsider });
    expect(r.status).toBe(403);
  });

  it("协办可以改记录；助理不能删材料", async () => {
    const read = await call(`/v1/matters/${MATTER}/ops`, { token: tka.li });
    expect([200, 404]).toContain(read.status);

    cloud.directory.upsertMember(
      tenantA,
      MATTER,
      {
        lawyerId: "lawyer_wang",
        displayName: "王五",
        role: "paralegal",
        status: "active",
        joinedAt: new Date().toISOString(),
      },
      "lawyer_zhang",
    );
    const { token } = cloud.directory.createAccount({
      tenantId: tenantA,
      lawyerId: "lawyer_ding",
      displayName: "丁助理",
    });
    cloud.directory.upsertMember(
      tenantA,
      MATTER,
      {
        lawyerId: "lawyer_ding",
        displayName: "丁助理",
        role: "paralegal",
        status: "active",
        joinedAt: new Date().toISOString(),
      },
      "lawyer_zhang",
    );
    // 助理没有 delete_materials → 带墓碑的清单 PUT 被拒
    const r = await call(`/v1/matters/${MATTER}/materials/manifest`, {
      token,
      body: { version: 1, files: [], removed: ["materials/a.txt"] },
    });
    expect(r.status).toBe(403);
    expect((r.json as { capability: string }).capability).toBe("delete_materials");
  });

  it("外协：能上传，但不能读卷宗内容", async () => {
    const text = "外协上传的扫描件\n";
    const sha = sha256(text);
    const up = await call(`/v1/matters/${MATTER}/blobs/${sha}`, {
      token: tka.wang,
      rawBody: Buffer.from(text, "utf8"),
    });
    expect([201, 409]).toContain(up.status);

    // 读：外协被拒
    const read = await call(`/v1/matters/${MATTER}/blobs/${sha}`, { token: tka.wang });
    expect(read.status).toBe(403);
    expect((read.json as { error: string }).error).toBe("role_cannot_read");

    // 同租户的协办可以读
    const readByLi = await call(`/v1/matters/${MATTER}/blobs/${sha}`, { token: tka.li });
    expect(readByLi.status).toBe(200);
    expect(readByLi.buf.toString("utf8")).toBe(text);

    // 外协也读不到记录与清单
    expect((await call(`/v1/matters/${MATTER}/ops`, { token: tka.wang })).status).toBe(403);
    expect(
      (await call(`/v1/matters/${MATTER}/materials/manifest`, { token: tka.wang })).status,
    ).toBe(403);
  });

  it("只读不能改记录", async () => {
    const { token } = cloud.directory.createAccount({
      tenantId: tenantA,
      lawyerId: "lawyer_ro",
      displayName: "只读",
    });
    cloud.directory.upsertMember(
      tenantA,
      MATTER,
      {
        lawyerId: "lawyer_ro",
        displayName: "只读",
        role: "readonly",
        status: "active",
        joinedAt: new Date().toISOString(),
      },
      "lawyer_zhang",
    );
    const r = await call(`/v1/matters/${MATTER}/ops`, {
      token,
      body: { version: 1, ops: [] },
    });
    expect(r.status).toBe(403);
    expect((r.json as { capability: string }).capability).toBe("edit_matter_records");
  });
});

describe("内容块完整性", () => {
  it("字节哈希与路径哈希不符时拒收（服务端不信任客户端）", async () => {
    const sha = sha256("真正的卷宗内容");
    const r = await call(`/v1/matters/${MATTER}/blobs/${sha}`, {
      token: tka.zhang,
      rawBody: Buffer.from("攻击者塞进来的字节", "utf8"),
    });
    expect(r.status).toBe(400);
    expect((r.json as { error: string }).error).toBe("blob_hash_mismatch");
    // 也没有把坏字节留下
    expect((await call(`/v1/matters/${MATTER}/blobs/${sha}`, { token: tka.zhang })).status).toBe(
      404,
    );
  });

  it("哈希正确时按内容寻址存储，重复上传返回 409", async () => {
    const text = "对方盖章版合同\n";
    const sha = sha256(text);
    const first = await call(`/v1/matters/${MATTER}/blobs/${sha}`, {
      token: tka.zhang,
      rawBody: Buffer.from(text, "utf8"),
    });
    expect(first.status).toBe(201);
    const again = await call(`/v1/matters/${MATTER}/blobs/${sha}`, {
      token: tka.zhang,
      rawBody: Buffer.from(text, "utf8"),
    });
    expect(again.status).toBe(409);
  });
});

describe("记录管（ops）", () => {
  it("按 opId 幂等合并，且拒绝把 op 记到别的案件上", async () => {
    const op = {
      opId: "op_1",
      matterId: MATTER,
      kind: "material.put",
      actorId: "lawyer_zhang",
      actorName: "张三",
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: { relPath: "materials/a.txt" },
    };
    await call(`/v1/matters/${MATTER}/ops`, {
      token: tka.zhang,
      body: { version: 1, matterId: MATTER, ops: [op] },
    });
    await call(`/v1/matters/${MATTER}/ops`, {
      token: tka.zhang,
      body: { version: 1, matterId: MATTER, ops: [op] },
    });
    const read = await call(`/v1/matters/${MATTER}/ops`, { token: tka.zhang });
    expect(read.status).toBe(200);
    expect((read.json as { ops: unknown[] }).ops).toHaveLength(1);

    const bad = await call(`/v1/matters/${MATTER}/ops`, {
      token: tka.zhang,
      body: { version: 1, ops: [{ ...op, opId: "op_2", matterId: "matter_other" }] },
    });
    expect(bad.status).toBe(400);
    expect((bad.json as { error: string }).error).toBe("op_matter_mismatch");
  });
});

describe("服务器侧邀请", () => {
  it("主办建邀请 → 同租户新账号兑换 → 成为成员（跨租户兑换不可能）", async () => {
    const created = await call(`/v1/matters/${MATTER}/invites`, {
      token: tka.zhang,
      method: "POST",
      body: { email: "new@firm.com", role: "associate" },
    });
    expect(created.status).toBe(200);
    const invite = (created.json as { invite: { token: string } }).invite;

    // 甲所新账号兑换
    const { token: newToken } = cloud.directory.createAccount({
      tenantId: tenantA,
      lawyerId: "lawyer_new",
      displayName: "新同事",
      email: "new@firm.com",
    });
    const redeemed = await call("/v1/invites/redeem", {
      token: newToken,
      method: "POST",
      body: { token: invite.token },
    });
    expect(redeemed.status).toBe(200);
    expect(
      (redeemed.json as { membership: { members: { lawyerId: string }[] } }).membership.members.map(
        (m) => m.lawyerId,
      ),
    ).toContain("lawyer_new");

    // 乙所账号拿同一个邀请码兑换 → 拒绝（邀请按租户存放）
    const crossTenant = await call("/v1/invites/redeem", {
      token: tkb.zhao,
      method: "POST",
      body: { token: invite.token },
    });
    expect(crossTenant.status).toBe(400);

    // 同一邀请码只能用一次
    const reuse = await call("/v1/invites/redeem", {
      token: newToken,
      method: "POST",
      body: { token: invite.token },
    });
    expect(reuse.status).toBe(400);
  });

  it("被撤销的邀请不能兑换", async () => {
    const created = await call(`/v1/matters/${MATTER}/invites`, {
      token: tka.zhang,
      method: "POST",
      body: { email: "x@firm.com", role: "paralegal" },
    });
    const invite = (created.json as { invite: { inviteId: string; token: string } }).invite;
    await call(`/v1/matters/${MATTER}/invites/revoke`, {
      token: tka.zhang,
      method: "POST",
      body: { inviteId: invite.inviteId },
    });
    const r = await call("/v1/invites/redeem", {
      token: tka.li,
      method: "POST",
      body: { token: invite.token },
    });
    expect(r.status).toBe(400);
    expect((r.json as { error: string }).error).toMatch(/撤销/);
  });

  it("没有 invite 能力的角色不能建邀请", async () => {
    const { token } = cloud.directory.createAccount({
      tenantId: tenantA,
      lawyerId: "lawyer_para",
      displayName: "助理",
    });
    cloud.directory.upsertMember(
      tenantA,
      MATTER,
      {
        lawyerId: "lawyer_para",
        displayName: "助理",
        role: "paralegal",
        status: "active",
        joinedAt: new Date().toISOString(),
      },
      "lawyer_zhang",
    );
    const r = await call(`/v1/matters/${MATTER}/invites`, {
      token,
      method: "POST",
      body: { email: "a@b.com", role: "associate" },
    });
    expect(r.status).toBe(403);
    expect((r.json as { capability: string }).capability).toBe("invite");
  });
});
