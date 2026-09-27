/**
 * 桌面端 ↔ 案件云 桥接测试。
 *
 * 验的是「云当权威」这件事真的成立：邀请由服务端建、由服务端记状态；
 * 本地名册是投影；新成员的钥匙由主办端补发。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureMatterKey,
  listCheckoutLocks,
  listRecordOps,
  readMatterKey,
  readMembership,
  syncMatterRecordPipe,
  upsertLawyerIdentity,
} from "../matter-replica/index.js";
import { writeCloudLink } from "./cloud-link.js";
import {
  acceptCloudInvite,
  cloudConnectionInfo,
  createCloudInvite,
  fetchCloudMembership,
  revokeCloudInvite,
  shareMatterKeyIfNeeded,
  syncMatterWithCloud,
} from "./desktop-bridge.js";
import { createMatterCloudServer, type MatterCloudServer } from "./index.js";

const tmpDirs: string[] = [];
const MID = "matter_bridge2026";

let cloud: MatterCloudServer;
let base: string;

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-bridge-"));
  tmpDirs.push(d);
  return d;
}

/** 建一个「指向云」的工作区（无 sharedRelayDir）。 */
function cloudWorkspace(root: string, name: string, token: string): string {
  const ws = path.join(root, name);
  fs.mkdirSync(path.join(ws, "cases", MID, "materials"), { recursive: true });
  // 云地址与令牌不进策略文件（commercial-policy 拒绝这两项）；
  // 存活面是本机的 lawmind/cloud-link.json（0600）。
  fs.writeFileSync(
    path.join(ws, "lawmind.policy.json"),
    JSON.stringify({
      schemaVersion: 1,
      edition: "firm",
      matterReplica: { enabled: true },
    }),
    "utf8",
  );
  writeCloudLink(ws, { endpoint: base, token });
  return ws;
}

beforeEach(async () => {
  cloud = createMatterCloudServer({ dataDir: tmpDir() });
  base = await cloud.listen(0);
});

afterEach(async () => {
  await cloud.close();
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

/** 服务端开户 + 建案名册；返回两个令牌。 */
function provision(opts?: { withLi?: boolean }): { zhang: string; li: string; tenantId: string } {
  const tenant = cloud.directory.createTenant({ name: "示范律所" });
  cloud.directory.ensureMembership({
    tenantId: tenant.tenantId,
    matterId: MID,
    matterTitle: "王某买卖合同纠纷",
    owner: { lawyerId: "lawyer_zhang", displayName: "张三" },
  });
  const zhang = cloud.directory.createAccount({
    tenantId: tenant.tenantId,
    lawyerId: "lawyer_zhang",
    displayName: "张三",
  }).token;
  const li = cloud.directory.createAccount({
    tenantId: tenant.tenantId,
    lawyerId: "lawyer_li",
    displayName: "李四",
  }).token;
  if (opts?.withLi) {
    cloud.directory.upsertMember(
      tenant.tenantId,
      MID,
      {
        lawyerId: "lawyer_li",
        displayName: "李四",
        role: "associate",
        status: "active",
        joinedAt: new Date().toISOString(),
      },
      "lawyer_zhang",
    );
  }
  return { zhang, li, tenantId: tenant.tenantId };
}

describe("云连接识别", () => {
  it("未配云时 configured=false（走本地邀请）", () => {
    const ws = tmpDir();
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, edition: "firm" }),
      "utf8",
    );
    const info = cloudConnectionInfo(ws);
    expect(info.configured).toBe(false);
  });

  it("配了 endpoint + token 时 configured=true 且指向云为权威", () => {
    const { zhang } = provision();
    const ws = cloudWorkspace(tmpDir(), "desk", zhang);
    const info = cloudConnectionInfo(ws);
    expect(info.configured).toBe(true);
    expect(info.endpoint).toBe(base);
    expect(info.hasToken).toBe(true);
  });

  it("只有 endpoint 没 token 时不算配好（避免半配状态静默失败）", () => {
    const ws = tmpDir();
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "firm",
        matterReplica: { enabled: true },
      }),
      "utf8",
    );
    // cloud-link.json 缺 token：readCloudLink 视为未配（两项缺一即 null）。
    fs.mkdirSync(path.join(ws, "lawmind"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "lawmind", "cloud-link.json"),
      JSON.stringify({ endpoint: base }),
      "utf8",
    );
    expect(cloudConnectionInfo(ws).configured).toBe(false);
  });
});

describe("经云建/撤销邀请", () => {
  it("邀请落在服务端，并以云为权威（本地不再自造邀请码）", async () => {
    const { zhang, tenantId } = provision();
    const ws = cloudWorkspace(tmpDir(), "desk", zhang);
    upsertLawyerIdentity(ws, {
      displayName: "张三",
      email: "zhang@firm.com",
      lawyerId: "lawyer_zhang",
    });

    const invite = await createCloudInvite(ws, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "associate",
    });
    expect(invite.token.startsWith("LMC-")).toBe(true);
    expect(invite.shareText).toContain(invite.token);

    // 服务端确实记下了
    const onServer = cloud.directory.listInvites(tenantId, MID);
    expect(onServer.map((i) => i.inviteId)).toContain(invite.inviteId);

    // 本地只留一条可追溯的 op，不留可兑换的明文邀请码
    const localOps = listRecordOps(ws, MID).filter((op) => op.kind === "invite.create");
    const dump = JSON.stringify(localOps);
    expect(dump).toContain("cloud");
    expect(dump).not.toContain(invite.token);
  });

  it("撤销后服务端状态变为 revoked，且不能兑换", async () => {
    const { zhang, li, tenantId } = provision();
    const ws = cloudWorkspace(tmpDir(), "desk", zhang);
    upsertLawyerIdentity(ws, { displayName: "张三", lawyerId: "lawyer_zhang", email: "z@f.com" });
    const invite = await createCloudInvite(ws, {
      matterId: MID,
      matterTitle: "案",
      email: "li@firm.com",
      role: "associate",
    });
    await revokeCloudInvite(ws, { matterId: MID, inviteId: invite.inviteId });
    expect(cloud.directory.listInvites(tenantId, MID)[0]?.status).toBe("revoked");

    const liWs = cloudWorkspace(tmpDir(), "desk-li", li);
    upsertLawyerIdentity(liWs, { displayName: "李四", lawyerId: "lawyer_li", email: "l@f.com" });
    await expect(acceptCloudInvite(liWs, invite.token)).rejects.toThrow(/撤销/);
  });
});

describe("经云兑换邀请", () => {
  it("同事用云邀请码加入：云侧加成员 + 本地名册投影 + 其他机器收敛", async () => {
    const { zhang, li, tenantId } = provision();
    const zhangWs = cloudWorkspace(tmpDir(), "zhang", zhang);
    const liWs = cloudWorkspace(tmpDir(), "li", li);
    upsertLawyerIdentity(zhangWs, {
      displayName: "张三",
      email: "z@firm.com",
      lawyerId: "lawyer_zhang",
    });
    upsertLawyerIdentity(liWs, { displayName: "李四", email: "l@firm.com", lawyerId: "lawyer_li" });

    // 主办端要有本机成员名册（云邀请要求邀请人是本案成员）
    const { ensureMembershipWithOwner } = await import("../matter-replica/index.js");
    ensureMembershipWithOwner(zhangWs, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      ownerLawyerId: "lawyer_zhang",
      ownerDisplayName: "张三",
    });

    const invite = await createCloudInvite(zhangWs, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "associate",
    });

    // 李四兑换
    const joined = await acceptCloudInvite(liWs, invite.token);
    expect(joined.matterId).toBe(MID);
    expect(joined.role).toBe("associate");

    // 云侧权威名册
    expect(cloud.directory.readMembership(tenantId, MID)?.members.map((m) => m.lawyerId)).toContain(
      "lawyer_li",
    );
    // 本地投影
    expect(readMembership(liWs, MID)?.members.map((m) => m.lawyerId)).toContain("lawyer_li");
    // ops 留痕，让不带云的机器也能收敛
    expect(listRecordOps(liWs, MID).some((op) => op.kind === "invite.accept")).toBe(true);
  });

  it("同一个云邀请码只能用一次", async () => {
    const { zhang, li } = provision();
    const zhangWs = cloudWorkspace(tmpDir(), "zhang", zhang);
    const liWs = cloudWorkspace(tmpDir(), "li", li);
    upsertLawyerIdentity(zhangWs, { displayName: "张三", lawyerId: "lawyer_zhang" });
    upsertLawyerIdentity(liWs, { displayName: "李四", lawyerId: "lawyer_li" });
    const invite = await createCloudInvite(zhangWs, {
      matterId: MID,
      matterTitle: "案",
      email: "li@firm.com",
      role: "associate",
    });
    await acceptCloudInvite(liWs, invite.token);
    await expect(acceptCloudInvite(liWs, invite.token)).rejects.toThrow(/已被使用/);
  });

  it("云不可达时给出可读错误，而不是静默失败", async () => {
    const ws = tmpDir();
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "firm",
        matterReplica: { enabled: true },
      }),
      "utf8",
    );
    writeCloudLink(ws, { endpoint: "http://127.0.0.1:1", token: "x" });
    // 先设身份：否则会在「请先设置姓名」处提前失败，测不到网络错误
    upsertLawyerIdentity(ws, { displayName: "张三", lawyerId: "lawyer_zhang" });
    await expect(
      createCloudInvite(ws, {
        matterId: MID,
        matterTitle: "案",
        email: "a@b.com",
        role: "associate",
      }),
    ).rejects.toThrow(/无法连接案件云/);
  });
});

describe("密钥补发（云邀请没有 matter_key.share op）", () => {
  it("主办端补发后，新成员拿到与主办一致的案件密钥", async () => {
    const { zhang, li } = provision({ withLi: true });
    const zhangWs = cloudWorkspace(tmpDir(), "zhang", zhang);
    const liWs = cloudWorkspace(tmpDir(), "li", li);
    upsertLawyerIdentity(zhangWs, {
      displayName: "张三",
      email: "z@firm.com",
      lawyerId: "lawyer_zhang",
    });
    upsertLawyerIdentity(liWs, { displayName: "李四", email: "l@firm.com", lawyerId: "lawyer_li" });

    const { ensureMembershipWithOwner } = await import("../matter-replica/index.js");
    ensureMembershipWithOwner(zhangWs, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      ownerLawyerId: "lawyer_zhang",
      ownerDisplayName: "张三",
    });
    // 李四已在云侧名册，本地也建名册（真实场景由加入流程写入）
    ensureMembershipWithOwner(liWs, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      ownerLawyerId: "lawyer_zhang",
      ownerDisplayName: "张三",
    });

    // 主办端先有钥匙并公布自己公钥
    const hostKey = ensureMatterKey(zhangWs, MID);
    await syncMatterWithCloud(zhangWs, MID);

    // 李四公布公钥并推到云（同步时会自动公布，无需手动调用）
    ensureMatterKey(liWs, MID);
    await syncMatterWithCloud(liWs, MID);

    // 主办端：拉云名册（此刻含李四）→ 拉到李四公钥 → 补发钥匙
    const hostSync = await syncMatterWithCloud(zhangWs, MID);
    expect(hostSync.cloudRosterApplied).toBe(true);
    expect(hostSync.keySharedFor).toContain("lawyer_li");

    // 李四再同步一次才会拉到那条分发 op（真实场景由自动同步完成）
    await syncMatterWithCloud(liWs, MID);

    expect(readMatterKey(liWs, MID)?.keyId).toBe(hostKey.keyId);
  });

  it("补发是幂等的：已覆盖后不再产生新 op", async () => {
    const { zhang, li } = provision({ withLi: true });
    const zhangWs = cloudWorkspace(tmpDir(), "zhang", zhang);
    const liWs = cloudWorkspace(tmpDir(), "li", li);
    upsertLawyerIdentity(zhangWs, { displayName: "张三", lawyerId: "lawyer_zhang" });
    upsertLawyerIdentity(liWs, { displayName: "李四", lawyerId: "lawyer_li" });
    const { ensureMembershipWithOwner } = await import("../matter-replica/index.js");
    for (const ws of [zhangWs, liWs]) {
      ensureMembershipWithOwner(ws, {
        matterId: MID,
        matterTitle: "案",
        ownerLawyerId: "lawyer_zhang",
        ownerDisplayName: "张三",
      });
    }
    ensureMatterKey(zhangWs, MID);
    await syncMatterRecordPipe(zhangWs, MID);
    ensureMatterKey(liWs, MID);
    await syncMatterRecordPipe(liWs, MID);
    await syncMatterRecordPipe(zhangWs, MID);

    shareMatterKeyIfNeeded(zhangWs, MID);
    const countAfterFirst = listRecordOps(zhangWs, MID).filter(
      (op) => op.kind === "matter_key.rotate",
    ).length;
    shareMatterKeyIfNeeded(zhangWs, MID);
    shareMatterKeyIfNeeded(zhangWs, MID);
    const countAfterRepeat = listRecordOps(zhangWs, MID).filter(
      (op) => op.kind === "matter_key.rotate",
    ).length;
    expect(countAfterRepeat).toBe(countAfterFirst);
  });
});

describe("云侧名册读取", () => {
  it("能拉到云名册；未配云时返回 null", async () => {
    const { zhang } = provision({ withLi: true });
    const ws = cloudWorkspace(tmpDir(), "desk", zhang);
    const membership = await fetchCloudMembership(ws, MID);
    expect(membership?.members.map((m) => m.lawyerId).toSorted()).toEqual([
      "lawyer_li",
      "lawyer_zhang",
    ]);

    const offline = tmpDir();
    fs.writeFileSync(
      path.join(offline, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, edition: "firm" }),
      "utf8",
    );
    expect(await fetchCloudMembership(offline, MID)).toBeNull();
  });

  it("签约出与本地名册不冲突（云只影响名册，不动锁）", async () => {
    const { zhang } = provision({ withLi: true });
    const ws = cloudWorkspace(tmpDir(), "desk", zhang);
    const membership = await fetchCloudMembership(ws, MID);
    expect(membership).toBeTruthy();
    // 云名册投影不应凭空造出签出锁
    expect(listCheckoutLocks(ws, MID)).toHaveLength(0);
  });
});
