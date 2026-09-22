/**
 * 跨机器「邀请 → 加入」与「删除传播」的回归测试。
 *
 * 两者根因相同：op 有**发出**、但**没有消费者**。
 * - 邀请：`invite.create` 到了对端 ops，对端却只扫自己的 invites.jsonl → 邀请码被判无效；
 * - 删除：`material.remove` 到了对端 ops，且中继清单只做并集 → 已删材料被拉回来（本机复活）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptInviteByToken,
  createInvite,
  ensureMembershipWithOwner,
  listActiveMembers,
  listRecordOps,
  publishLocalMaterials,
  readMembership,
  revokeInvite,
  scanMatterMaterials,
  syncMatterRecordPipe,
  upsertLawyerIdentity,
} from "./index.js";
import { applyRemoteMaterialRemovals } from "./materials-blobs.js";

const tmpDirs: string[] = [];
const MID = "matter_wm2026";
const REL = "materials/证据清单.txt";

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

type Pair = { a: string; b: string; relay: string };

function makePair(): Pair {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-invite-remove-"));
  tmpDirs.push(root);
  const relay = path.join(root, "relay");
  fs.mkdirSync(relay, { recursive: true });
  const policy = JSON.stringify({
    schemaVersion: 1,
    edition: "firm",
    matterReplica: { enabled: true, sharedRelayDir: relay },
  });
  const a = path.join(root, "machineA");
  const b = path.join(root, "machineB");
  for (const ws of [a, b]) {
    fs.mkdirSync(path.join(ws, "cases", MID, "materials"), { recursive: true });
    fs.writeFileSync(path.join(ws, "lawmind.policy.json"), policy, "utf8");
  }
  upsertLawyerIdentity(a, {
    displayName: "张三",
    email: "zhang@firm.com",
    lawyerId: "lawyer_zhang",
  });
  upsertLawyerIdentity(b, {
    displayName: "李四",
    email: "li@firm.com",
    lawyerId: "lawyer_li",
  });
  ensureMembershipWithOwner(a, {
    matterId: MID,
    matterTitle: "王某买卖合同纠纷",
    ownerLawyerId: "lawyer_zhang",
    ownerDisplayName: "张三",
    ownerEmail: "zhang@firm.com",
  });
  return { a, b, relay };
}

function abs(ws: string, rel: string): string {
  return path.join(ws, "cases", MID, ...rel.split("/"));
}

function writeMaterial(ws: string, rel: string, body: string): void {
  const p = abs(ws, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
}

function relayManifest(relay: string): { files: { relPath: string }[] } {
  const p = path.join(relay, MID, "materials-manifest.json");
  if (!fs.existsSync(p)) {
    return { files: [] };
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as { files: { relPath: string }[] };
}

describe("跨机器接受邀请", () => {
  it("B 只凭中继上的 op 就能用邀请码加入（无需本机 invites.jsonl / inbox）", async () => {
    const p = makePair();
    const invite = createInvite(p.a, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "associate",
    });

    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);

    // B 端既没有 invites.jsonl，也没有 inbox —— 这正是以前失败的场景
    expect(fs.existsSync(path.join(p.b, "matters", MID, "replica", "invites.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(p.b, "lawmind", "replica", "inbox"))).toBe(false);

    const { membership } = acceptInviteByToken(p.b, invite.token);
    expect(membership).not.toBeNull();
    const li = readMembership(p.b, MID)?.members.find((m) => m.lawyerId === "lawyer_li");
    expect(li?.role).toBe("associate");
    expect(li?.email).toBe("li@firm.com");
  });

  it("重建的邀请保留 matterTitle 与邀请人身份", async () => {
    const p = makePair();
    const invite = createInvite(p.a, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "paralegal",
    });
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);
    acceptInviteByToken(p.b, invite.token);

    const membership = readMembership(p.b, MID);
    expect(membership?.matterTitle).toBe("王某买卖合同纠纷");
    const owner = membership?.members.find((m) => m.role === "owner");
    expect(owner?.lawyerId).toBe("lawyer_zhang");
    expect(owner?.displayName).toBe("张三");
    // 接受者自己是 paralegal，不是 owner
    expect(membership?.members.find((m) => m.lawyerId === "lawyer_li")?.role).toBe("paralegal");
  });

  it("错误的邀请码仍然被拒", async () => {
    const p = makePair();
    createInvite(p.a, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "associate",
    });
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);

    expect(() => acceptInviteByToken(p.b, "LM-ZZZZ-ZZZZ-ZZZZ-ZZZZ")).toThrow(/无效|过期/);
  });

  it("已被撤销的邀请在对端也不能用（状态由 invite.revoke op 还原）", async () => {
    const p = makePair();
    const invite = createInvite(p.a, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "associate",
    });
    revokeInvite(p.a, MID, invite.inviteId);
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);

    expect(() => acceptInviteByToken(p.b, invite.token)).toThrow(/撤销/);
  });

  it("邀请码已用过时在对端也被拒（状态由 invite.accept op 还原）", async () => {
    const p = makePair();
    const invite = createInvite(p.a, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "associate",
    });
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);
    acceptInviteByToken(p.b, invite.token);
    await syncMatterRecordPipe(p.b, MID);

    // B 再试一次：本机 invites.jsonl 里已是 accepted
    expect(() => acceptInviteByToken(p.b, invite.token)).toThrow(/已被使用/);

    // C 端（只从 op 重建）也应判为已被使用
    const c = path.join(path.dirname(p.a), "machineC");
    fs.mkdirSync(path.join(c, "cases", MID, "materials"), { recursive: true });
    fs.writeFileSync(
      path.join(c, "lawmind.policy.json"),
      fs.readFileSync(path.join(p.a, "lawmind.policy.json"), "utf8"),
      "utf8",
    );
    upsertLawyerIdentity(c, {
      displayName: "王五",
      email: "wang@firm.com",
      lawyerId: "lawyer_wang",
    });
    await syncMatterRecordPipe(c, MID);
    expect(() => acceptInviteByToken(c, invite.token)).toThrow(/已被使用/);
  });

  it("接受后主办端名册出现新成员", async () => {
    const p = makePair();
    const invite = createInvite(p.a, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "associate",
    });
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);
    acceptInviteByToken(p.b, invite.token);
    await syncMatterRecordPipe(p.b, MID);
    await syncMatterRecordPipe(p.a, MID);

    const names = listActiveMembers(readMembership(p.a, MID)!).map((m) => m.displayName);
    expect(names).toContain("李四");
  });
});

describe("材料删除传播", () => {
  it("A 删除后不再被中继清单拉回（本机不复活）", async () => {
    const p = makePair();
    writeMaterial(p.a, REL, "证据1\n");
    await syncMatterRecordPipe(p.a, MID);
    expect(relayManifest(p.relay).files.map((f) => f.relPath)).toContain(REL);

    fs.rmSync(abs(p.a, REL));
    const after = await syncMatterRecordPipe(p.a, MID);

    expect(fs.existsSync(abs(p.a, REL))).toBe(false);
    expect(after.materials.publishedFiles).toBe(0);
    // 中继清单必须能变短
    expect(relayManifest(p.relay).files.map((f) => f.relPath)).not.toContain(REL);
  });

  it("A 删除并同步后，B 本地也不再保留", async () => {
    const p = makePair();
    writeMaterial(p.a, REL, "证据1\n");
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);
    expect(fs.existsSync(abs(p.b, REL))).toBe(true);

    fs.rmSync(abs(p.a, REL));
    await syncMatterRecordPipe(p.a, MID);
    const onB = await syncMatterRecordPipe(p.b, MID);

    expect(onB.materials.deletedLocally).toContain(REL);
    expect(fs.existsSync(abs(p.b, REL))).toBe(false);
  });

  it("B 不会为自己没收到的删除而发出多余的 tombstone op", async () => {
    const p = makePair();
    writeMaterial(p.a, REL, "证据1\n");
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);

    fs.rmSync(abs(p.a, REL));
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);

    const removesByB = listRecordOps(p.b, MID).filter(
      (op) => op.kind === "material.remove" && op.actorId === "lawyer_li",
    );
    expect(removesByB).toHaveLength(0);
  });

  it("本地内容已被改成别的时候不删（冲突交给 LWW，不在这里动手）", async () => {
    const p = makePair();
    writeMaterial(p.a, REL, "证据1\n");
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);

    // A 删除；但 B 已把同一路径改成不同内容
    fs.rmSync(abs(p.a, REL));
    await syncMatterRecordPipe(p.a, MID);
    fs.writeFileSync(abs(p.b, REL), "李四自己改过的内容\n", "utf8");

    // B 的 index 里还是旧 sha，先手动刷新成本地新内容
    publishLocalMaterials(p.b, MID);
    const applied = applyRemoteMaterialRemovals(p.b, MID);

    expect(applied.deleted).not.toContain(REL);
    expect(fs.existsSync(abs(p.b, REL))).toBe(true);
  });

  it("删除后重新上传同一路径，旧墓碑不会把它删掉", async () => {
    const p = makePair();
    writeMaterial(p.a, REL, "证据1\n");
    await syncMatterRecordPipe(p.a, MID);

    fs.rmSync(abs(p.a, REL));
    await syncMatterRecordPipe(p.a, MID);

    // 同一路径重新上传新内容（产生更晚的 material.put）
    writeMaterial(p.a, REL, "证据1（补正）\n");
    await syncMatterRecordPipe(p.a, MID);
    expect(fs.existsSync(abs(p.a, REL))).toBe(true);

    await syncMatterRecordPipe(p.b, MID);
    expect(fs.existsSync(abs(p.b, REL))).toBe(true);
    expect(fs.readFileSync(abs(p.b, REL), "utf8")).toContain("补正");
  });

  it("从未同步过的本地新文件不会被误删", async () => {
    const p = makePair();
    writeMaterial(p.a, REL, "证据1\n");
    await syncMatterRecordPipe(p.a, MID);
    fs.rmSync(abs(p.a, REL));
    await syncMatterRecordPipe(p.a, MID);

    writeMaterial(p.b, "materials/李四自己的笔记.txt", "只在本机\n");
    const applied = applyRemoteMaterialRemovals(p.b, MID);

    expect(applied.deleted).toHaveLength(0);
    expect(fs.existsSync(abs(p.b, "materials/李四自己的笔记.txt"))).toBe(true);
    expect(scanMatterMaterials(p.b, MID)).toHaveLength(1);
  });
});
