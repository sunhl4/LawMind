/**
 * 安全收口测试：材料完整性（X5）与密钥轮换（X8）。
 *
 * 这两个判据和功能类判据不同 —— 它们验的是「坏人做了什么，产品会不会被骗」。
 * 所以测试里刻意扮演攻击者：篡改中继上的字节、拿着已撤销的邀请码去解密钥。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sealBytes } from "./crypto-envelope.js";
import { openBytes } from "./crypto-envelope.js";
import {
  acceptInviteByToken,
  createInvite,
  ensureMembershipWithOwner,
  exportInvitePack,
  listRecordOps,
  memberPublicKeysFromOps,
  ensureMatterKey,
  installMatterKeyFromPack,
  readMatterKey,
  revokeInvite,
  rotateAndShareMatterKey,
  scanMatterMaterials,
  syncMatterRecordPipe,
  upsertLawyerIdentity,
  wrapMatterKeyForMember,
  unwrapMatterKeyForMember,
  unwrapMatterKeyFromInvite,
} from "./index.js";
import type { WrappedMatterKey } from "./invite-key-wrap.js";
import { matterKeyBytes } from "./matter-key.js";
import { readMemberKeyPair } from "./member-keys.js";

const tmpDirs: string[] = [];
const MID = "matter_sec2026";
const REL = "materials/委托合同（初稿）.docx";

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(root);
  return root;
}

type Pair = { a: string; b: string; relay: string };

function makePair(): Pair {
  const root = tmpRoot("lm-sec-");
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

function relayBlobPath(relay: string, sha256: string): string {
  return path.join(relay, MID, "blobs", sha256);
}

/** 走「邀请从 op 重建」的正式通道让 B 加入（不再依赖 inbox）。 */
async function joinB(p: Pair, role: "associate" | "paralegal" = "associate"): Promise<void> {
  const invite = createInvite(p.a, {
    matterId: MID,
    matterTitle: "王某买卖合同纠纷",
    email: "li@firm.com",
    role,
  });
  await syncMatterRecordPipe(p.a, MID);
  await syncMatterRecordPipe(p.b, MID);
  acceptInviteByToken(p.b, invite.token);
  await syncMatterRecordPipe(p.b, MID);
  await syncMatterRecordPipe(p.a, MID);
}

describe("X5 材料完整性", () => {
  it("中继上的字节被篡改时拒收，不写进律师卷宗", async () => {
    const p = makePair();
    writeMaterial(p.a, REL, "真正的委托合同内容\n");
    await syncMatterRecordPipe(p.a, MID);

    const entry = scanMatterMaterials(p.a, MID).find((f) => f.relPath === REL);
    expect(entry).toBeTruthy();
    fs.writeFileSync(relayBlobPath(p.relay, entry!.sha256), "攻击者塞进来的字节\n", "utf8");

    const onB = await syncMatterRecordPipe(p.b, MID);

    expect(fs.existsSync(abs(p.b, REL))).toBe(false);
    expect(onB.materials.rejectedIntegrity).toContain(REL);
    expect(onB.materials.integrityErrors.join(" ")).toMatch(/校验失败/);
  });

  it("未篡改时正常入库（避免变成一律拒收）", async () => {
    const p = makePair();
    writeMaterial(p.a, REL, "正常内容\n");
    await syncMatterRecordPipe(p.a, MID);
    const onB = await syncMatterRecordPipe(p.b, MID);

    expect(onB.materials.rejectedIntegrity).toHaveLength(0);
    expect(fs.readFileSync(abs(p.b, REL), "utf8")).toContain("正常内容");
  });

  it("大文件走分块路径时同样校验整体哈希", async () => {
    const p = makePair();
    const big = "A".repeat(5 * 1024 * 1024);
    writeMaterial(p.a, REL, big);
    await syncMatterRecordPipe(p.a, MID);

    // 分块信息只出现在中继清单里（本机索引只记整体哈希）
    const manifest = JSON.parse(
      fs.readFileSync(path.join(p.relay, MID, "materials-manifest.json"), "utf8"),
    ) as { files: { relPath: string; chunks?: string[] }[] };
    const entry = manifest.files.find((f) => f.relPath === REL);
    expect(entry?.chunks?.length ?? 0).toBeGreaterThan(1);

    // 篡改其中一个分块
    fs.writeFileSync(relayBlobPath(p.relay, entry!.chunks![0]), "B".repeat(1024), "utf8");

    const onB = await syncMatterRecordPipe(p.b, MID);
    expect(fs.existsSync(abs(p.b, REL))).toBe(false);
    expect(onB.materials.rejectedIntegrity).toContain(REL);
  });
});

describe("X8 密钥轮换", () => {
  it("撤销邀请后密钥必须轮换，且被撤销的邀请码解不出当前密钥", async () => {
    const p = makePair();
    const invite = createInvite(p.a, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "associate",
    });
    const keyIdBefore = readMatterKey(p.a, MID)?.keyId;

    // 攻击者手里已经拿到了这个邀请码与配套邀请包（包装后的案件密钥）
    const wrapped = listRecordOps(p.a, MID).find((op) => op.kind === "matter_key.share")?.payload
      .wrapped as WrappedMatterKey;
    const pack = exportInvitePack(p.a, invite);

    revokeInvite(p.a, MID, invite.inviteId);

    const keyIdAfter = readMatterKey(p.a, MID)?.keyId;
    expect(keyIdAfter).toBeTruthy();
    expect(keyIdAfter).not.toBe(keyIdBefore);

    // 泄露的邀请码仍解得出「旧钥匙」，但不再是当前钥匙 —— 之后的密文它读不了
    const opened = unwrapMatterKeyFromInvite(wrapped, invite.token, MID);
    expect(opened.keyId).not.toBe(keyIdAfter);
    expect(pack).toContain("LM-");
  });

  it("轮换后新封套用新密钥；旧钥匙解不开（前向安全）", async () => {
    const p = makePair();
    const invite = createInvite(p.a, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "associate",
    });
    // 案件密钥由 createInvite 首次建立，所以要在邀请之后取「轮换前」这一把
    const before = readMatterKey(p.a, MID);
    expect(before).toBeTruthy();
    revokeInvite(p.a, MID, invite.inviteId);
    const after = readMatterKey(p.a, MID);
    expect(after?.keyId).not.toBe(before?.keyId);

    const secret = Buffer.from("撤销之后才写的机密", "utf8");
    const sealedNew = sealBytes(secret, matterKeyBytes(after!));
    // 新钥匙解得开
    expect(openBytes(sealedNew, matterKeyBytes(after!)).toString("utf8")).toBe(
      "撤销之后才写的机密",
    );
    // 旧钥匙解不开 —— 这正是撤销的意义
    expect(before).toBeTruthy();
    expect(() => openBytes(sealedNew, matterKeyBytes(before!))).toThrow();
  });

  it("未上榜的成员能拿到轮换后的新钥匙（不能把同事一起锁出去）", async () => {
    const p = makePair();
    await joinB(p, "associate");
    const memberPubKeys = memberPublicKeysFromOps(listRecordOps(p.a, MID));
    expect(memberPubKeys.has("lawyer_li")).toBe(true);

    // 另请一位同事并立刻撤销他的邀请，触发轮换
    const invite2 = createInvite(p.a, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "wang@firm.com",
      role: "paralegal",
    });
    revokeInvite(p.a, MID, invite2.inviteId);

    const rotated = listRecordOps(p.a, MID)
      .filter((op) => op.kind === "matter_key.rotate")
      .at(-1);
    expect(rotated).toBeTruthy();
    const wraps = rotated!.payload.wraps as Record<string, unknown>;
    expect(wraps["lawyer_li"]).toBeTruthy();
    expect(wraps["lawyer_zhang"]).toBeTruthy();
    // 被撤销的邀请不属于在册成员，不应拿到任何一份
    expect(Object.keys(wraps)).not.toContain("lawyer_wang");

    // B 同步后应装上同一把新钥匙
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);
    expect(readMatterKey(p.b, MID)?.keyId).toBe(readMatterKey(p.a, MID)?.keyId);
  });

  it("成员被移出时同样轮换（已持钥的人才是重点）", async () => {
    const p = makePair();
    await joinB(p, "associate");
    const liBefore = readMatterKey(p.a, MID)?.keyId;
    expect(listRecordOps(p.a, MID).some((op) => op.kind === "member.key")).toBe(true);

    const { revokeMember } = await import("./membership.js");
    const { readMembership, writeMembership } = await import("./membership.js");
    const membership = readMembership(p.a, MID)!;
    writeMembership(p.a, revokeMember(membership, "lawyer_li", "lawyer_zhang"));
    const rotated = rotateAndShareMatterKey(p.a, MID);

    expect(readMatterKey(p.a, MID)?.keyId).not.toBe(liBefore);
    expect(rotated.wrappedFor).not.toContain("lawyer_li");
  });

  it("非成员自生成的钥匙会被邀请分发的钥匙取代（避免两机各持一把）", async () => {
    const p = makePair();
    // 模拟「还没入伙就先同步过一次」：本机自生成一把钥匙
    const selfMade = ensureMatterKey(p.b, MID);
    expect(selfMade.source).toBe("generated");

    // 主办建邀请并同步，B 在**已有自生成钥匙**的前提下接受邀请
    const invite = createInvite(p.a, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "associate",
    });
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);
    acceptInviteByToken(p.b, invite.token);

    const adopted = readMatterKey(p.b, MID);
    expect(adopted?.keyId).toBe(readMatterKey(p.a, MID)?.keyId);
    expect(adopted?.source).toBe("invite");
    expect(adopted?.keyId).not.toBe(selfMade.keyId);
  });

  it("轮换得到的钥匙不会被旧邀请降级覆盖", async () => {
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
    const adopted = readMatterKey(p.b, MID);
    expect(adopted?.source).toBe("invite");

    // 再走一次「安装邀请包」的路径：不应把 invite 来源降级，更不该换掉钥匙
    installMatterKeyFromPack(p.b, MID, { ...adopted!, keyId: "mk_stale_from_old_invite" });
    expect(readMatterKey(p.b, MID)?.keyId).toBe(adopted?.keyId);

    // 轮换后来源标记为 rotation，且此后再装旧包也不会覆盖
    // 轮换前必须让李四的公钥先同步到主办端：没有公钥就无法为他封装新钥匙，
    // 轮换会把他记进 skipped（可见地失效，而不是静默掉线）。
    await syncMatterRecordPipe(p.b, MID);
    await syncMatterRecordPipe(p.a, MID);

    const rotated = rotateAndShareMatterKey(p.a, MID);
    await syncMatterRecordPipe(p.a, MID);
    await syncMatterRecordPipe(p.b, MID);
    const afterRotate = readMatterKey(p.b, MID);
    expect(afterRotate?.keyId).toBe(rotated.keyId);
    expect(afterRotate?.source).toBe("rotation");
    installMatterKeyFromPack(p.b, MID, { ...adopted!, keyId: "mk_stale_again" });
    expect(readMatterKey(p.b, MID)?.keyId).toBe(rotated.keyId);
  });

  it("非密钥权威不能分发钥匙（否则对端会「最后收到的赢」，旧密文静默失效）", async () => {
    const p = makePair();
    // 让李四也进入在册名册（associate：有 invite，但**没有** manage_members）
    const { readMembership, upsertMember, writeMembership } = await import("./membership.js");
    const m = readMembership(p.a, MID)!;
    writeMembership(
      p.a,
      upsertMember(
        m,
        {
          lawyerId: "lawyer_li",
          displayName: "李四",
          role: "associate",
          status: "active",
          joinedAt: new Date().toISOString(),
        },
        "lawyer_zhang",
      ),
    );
    // 两台机器各自都持有钥匙
    ensureMatterKey(p.a, MID);
    const liKey = ensureMatterKey(p.b, MID);
    // 李四同步：他**不该**发出分发 op
    await syncMatterRecordPipe(p.b, MID);
    const liShared = listRecordOps(p.b, MID).filter(
      (op) => op.kind === "matter_key.rotate" && op.actorId === "lawyer_li",
    );
    expect(liShared).toHaveLength(0);
    expect(readMatterKey(p.b, MID)?.keyId).toBe(liKey.keyId);
  });

  it("成员密钥对：私钥不出网，公钥可用于封装", async () => {
    const p = makePair();
    await joinB(p, "associate");
    const pair = readMemberKeyPair(p.b);
    expect(pair?.lawyerId).toBe("lawyer_li");

    // 公钥在 op 里可见，私钥绝不在
    const bOps = listRecordOps(p.b, MID).filter((op) => op.kind === "member.key");
    const dump = JSON.stringify(bOps);
    expect(dump).toContain(pair!.publicKeyB64);
    expect(dump).not.toContain(pair!.privateKeyB64);

    // 用 B 的公钥封装，B 能解
    const key = readMatterKey(p.a, MID)!;
    const wrapped = wrapMatterKeyForMember({
      matterKeyBytes: matterKeyBytes(key),
      matterId: MID,
      forLawyerId: "lawyer_li",
      recipientPublicKeyB64: pair!.publicKeyB64,
    });
    const raw = unwrapMatterKeyForMember({
      wrapped,
      matterId: MID,
      myPrivateKeyB64: pair!.privateKeyB64,
    });
    expect(raw.toString("base64")).toBe(key.keyB64);
  });
});
