/**
 * Apply 层测试：远端 op 是否真的改变本机状态。
 *
 * 分两层：
 * - 投影语义（幂等、收敛、白名单、护栏）——用合成 op 直接喂进 ops.jsonl；
 * - 跨机器集成——两个独立工作区 + 中继，验证「同事的签出看得见」「同事入伙主办看得见」。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter, saveMatter } from "../adapters/matter-storage/index.js";
import type { MatterRecord } from "../adapters/matter-storage/index.js";
import {
  acceptInviteByToken,
  acquireCheckoutLock,
  applyRecordOpsToState,
  createInvite,
  ensureMatterKey,
  ensureMembershipWithOwner,
  exportInvitePack,
  listActiveMembers,
  listCheckoutLocks,
  readMatterKey,
  readMembership,
  syncMatterRecordPipe,
  upsertLawyerIdentity,
} from "./index.js";
import { isPathCheckedOut } from "./materials-blobs.js";
import type { MatterRecordOp, MatterRecordOpKind } from "./types.js";

const tmpDirs: string[] = [];
const MID = "matter_apply_demo";
const MATERIAL_REL = "materials/委托合同（初稿）.docx";

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-apply-"));
  tmpDirs.push(dir);
  return dir;
}

function sampleMatter(matterId = MID): MatterRecord {
  const now = new Date().toISOString();
  return {
    matterId,
    title: "王某买卖合同纠纷",
    status: "active",
    sensitivity: "normal",
    strategyStatus: "missing",
    openQuestionIds: [],
    nextActions: [],
    deadlineIds: [],
    deliverableIds: [],
    queueItemIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function seedOwner(ws: string, matterId = MID): void {
  upsertLawyerIdentity(ws, {
    displayName: "张三",
    email: "zhang@firm.com",
    lawyerId: "lawyer_zhang",
  });
  ensureMembershipWithOwner(ws, {
    matterId,
    matterTitle: "王某买卖合同纠纷",
    ownerLawyerId: "lawyer_zhang",
    ownerDisplayName: "张三",
    ownerEmail: "zhang@firm.com",
  });
}

/** 模拟「同事那台机器的 op 经中继到了本机」——直接落 ops.jsonl，可指定 createdAt。 */
function appendRawOp(ws: string, op: MatterRecordOp): void {
  const p = path.join(ws, "matters", op.matterId, "replica", "ops.jsonl");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, `${JSON.stringify(op)}\n`, "utf8");
}

function rawOp(input: {
  kind: MatterRecordOpKind;
  actorId: string;
  actorName: string;
  createdAt: string;
  payload: Record<string, unknown>;
  matterId?: string;
  opId?: string;
}): MatterRecordOp {
  return {
    opId: input.opId ?? `op_${input.kind}_${input.actorId}_${input.createdAt}`,
    matterId: input.matterId ?? MID,
    kind: input.kind,
    actorId: input.actorId,
    actorName: input.actorName,
    createdAt: input.createdAt,
    payload: input.payload,
  };
}

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

const HOUR = 60 * 60 * 1000;

function lockOp(input: {
  relPath?: string;
  lockId?: string;
  actorId: string;
  actorName: string;
  createdAt: string;
  expiresAt: string;
}): MatterRecordOp {
  return rawOp({
    kind: "lock.acquire",
    actorId: input.actorId,
    actorName: input.actorName,
    createdAt: input.createdAt,
    opId: `op_lock_${input.lockId ?? input.actorId}`,
    payload: {
      lockId: input.lockId ?? `lock_${input.actorId}`,
      relPath: input.relPath ?? MATERIAL_REL,
      expiresAt: input.expiresAt,
    },
  });
}

describe("apply-ops — 签出锁投影", () => {
  it("远端 lock.acquire 让本机看见同事正在改", () => {
    const ws = tmpWorkspace();
    seedOwner(ws);
    appendRawOp(
      ws,
      lockOp({
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-1000),
        expiresAt: isoIn(HOUR),
      }),
    );

    const result = applyRecordOpsToState(ws, MID);
    const locks = listCheckoutLocks(ws, MID);

    expect(locks).toHaveLength(1);
    expect(locks[0]?.holderDisplayName).toBe("李四");
    expect(locks[0]?.holderLawyerId).toBe("lawyer_li");
    expect(result.locks).toBe(1);
    expect(isPathCheckedOut(ws, MID, MATERIAL_REL)).toBe(true);
  });

  it("远端 lock.release 移除本机看到的签出", () => {
    const ws = tmpWorkspace();
    seedOwner(ws);
    appendRawOp(
      ws,
      lockOp({
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-2000),
        expiresAt: isoIn(HOUR),
      }),
    );
    appendRawOp(
      ws,
      rawOp({
        kind: "lock.release",
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-1000),
        opId: "op_lock_release_li",
        payload: { lockId: "lock_lawyer_li", relPath: MATERIAL_REL },
      }),
    );

    applyRecordOpsToState(ws, MID);
    expect(listCheckoutLocks(ws, MID)).toHaveLength(0);
    expect(isPathCheckedOut(ws, MID, MATERIAL_REL)).toBe(false);
  });

  it("已过期的远端签出不会被采纳", () => {
    const ws = tmpWorkspace();
    seedOwner(ws);
    appendRawOp(
      ws,
      lockOp({
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-2 * HOUR),
        expiresAt: isoIn(-HOUR),
      }),
    );

    applyRecordOpsToState(ws, MID);
    expect(listCheckoutLocks(ws, MID)).toHaveLength(0);
  });

  it("同一路径两方都签出时按先到者收敛，且与 op 顺序无关", () => {
    const earlier = lockOp({
      actorId: "lawyer_zhang",
      actorName: "张三",
      createdAt: isoIn(-5000),
      expiresAt: isoIn(HOUR),
    });
    const later = lockOp({
      actorId: "lawyer_li",
      actorName: "李四",
      createdAt: isoIn(-1000),
      expiresAt: isoIn(HOUR),
    });

    for (const order of [
      [earlier, later],
      [later, earlier],
    ]) {
      const ws = tmpWorkspace();
      seedOwner(ws);
      for (const op of order) {
        appendRawOp(ws, op);
      }
      applyRecordOpsToState(ws, MID);
      const locks = listCheckoutLocks(ws, MID);
      expect(locks).toHaveLength(1);
      expect(locks[0]?.holderLawyerId).toBe("lawyer_zhang");
    }
  });

  it("非法相对路径的签出 op 被忽略", () => {
    const ws = tmpWorkspace();
    seedOwner(ws);
    appendRawOp(
      ws,
      lockOp({
        relPath: "../../etc/passwd",
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-1000),
        expiresAt: isoIn(HOUR),
      }),
    );

    applyRecordOpsToState(ws, MID);
    expect(listCheckoutLocks(ws, MID)).toHaveLength(0);
  });
});

describe("apply-ops — 成员名册投影", () => {
  it("远端 invite.accept 把新成员写进本机名册（含邮箱与角色）", () => {
    const ws = tmpWorkspace();
    seedOwner(ws);
    appendRawOp(
      ws,
      rawOp({
        kind: "invite.accept",
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-1000),
        opId: "op_accept_li",
        payload: {
          inviteId: "inv_1",
          role: "associate",
          email: "li@firm.com",
          invitedBy: "lawyer_zhang",
        },
      }),
    );

    const result = applyRecordOpsToState(ws, MID);
    const membership = readMembership(ws, MID);
    const li = membership?.members.find((m) => m.lawyerId === "lawyer_li");

    expect(li?.role).toBe("associate");
    expect(li?.email).toBe("li@firm.com");
    expect(li?.status).toBe("active");
    expect(result.members).toBe(2);
  });

  it("role 非法时不写入成员", () => {
    const ws = tmpWorkspace();
    seedOwner(ws);
    appendRawOp(
      ws,
      rawOp({
        kind: "invite.accept",
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-1000),
        opId: "op_accept_bad_role",
        payload: { inviteId: "inv_1", role: "superadmin" },
      }),
    );

    applyRecordOpsToState(ws, MID);
    expect(listActiveMembers(readMembership(ws, MID)!)).toHaveLength(1);
  });

  it("已被移出的成员不会因重放旧 invite.accept 而复活", () => {
    const ws = tmpWorkspace();
    seedOwner(ws);
    appendRawOp(
      ws,
      rawOp({
        kind: "invite.accept",
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-3000),
        opId: "op_accept_li",
        payload: { inviteId: "inv_1", role: "associate", email: "li@firm.com" },
      }),
    );
    appendRawOp(
      ws,
      rawOp({
        kind: "member.revoke",
        actorId: "lawyer_zhang",
        actorName: "张三",
        createdAt: isoIn(-2000),
        opId: "op_revoke_li",
        payload: { lawyerId: "lawyer_li" },
      }),
    );

    applyRecordOpsToState(ws, MID);
    expect(listActiveMembers(readMembership(ws, MID)!)).toHaveLength(1);

    // 再投影一次（幂等 + 不复活）
    applyRecordOpsToState(ws, MID);
    expect(listActiveMembers(readMembership(ws, MID)!)).toHaveLength(1);
  });

  it("远端不能把唯一主办移出", () => {
    const ws = tmpWorkspace();
    seedOwner(ws);
    appendRawOp(
      ws,
      rawOp({
        kind: "member.revoke",
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-1000),
        opId: "op_revoke_owner",
        payload: { lawyerId: "lawyer_zhang" },
      }),
    );

    applyRecordOpsToState(ws, MID);
    const owner = readMembership(ws, MID)?.members.find((m) => m.lawyerId === "lawyer_zhang");
    expect(owner?.status).toBe("active");
  });
});

describe("apply-ops — 密钥权威（只有 manage_members 能改我的钥匙）", () => {
  it("来自协办的 matter_key.rotate 不被采信", () => {
    const ws = tmpWorkspace();
    seedOwner(ws);
    appendRawOp(
      ws,
      rawOp({
        kind: "member.upsert",
        actorId: "lawyer_zhang",
        actorName: "张三",
        createdAt: isoIn(-5000),
        opId: "op_add_li_assoc",
        payload: { lawyerId: "lawyer_li", displayName: "李四", role: "associate" },
      }),
    );
    const before = ensureMatterKey(ws, MID).keyId;
    appendRawOp(
      ws,
      rawOp({
        kind: "matter_key.rotate",
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-1000),
        opId: "op_rogue_key",
        payload: { keyId: "mk_rogue", wraps: { lawyer_zhang: { version: 1, sealedKeyB64: "x" } } },
      }),
    );
    applyRecordOpsToState(ws, MID);
    // 协办无权改我的钥匙
    expect(readMatterKey(ws, MID)?.keyId).toBe(before);
  });
});

describe("apply-ops — matter 字段投影", () => {
  it("白名单字段生效，非白名单与非法值被拒", () => {
    const ws = tmpWorkspace();
    seedOwner(ws);
    saveMatter(ws, sampleMatter());

    appendRawOp(
      ws,
      rawOp({
        kind: "matter.field_set",
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-4000),
        opId: "op_field_status",
        payload: { field: "status", value: "under_review" },
      }),
    );
    appendRawOp(
      ws,
      rawOp({
        kind: "matter.field_set",
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-3000),
        opId: "op_field_matter_id",
        payload: { field: "matterId", value: "hijacked" },
      }),
    );
    appendRawOp(
      ws,
      rawOp({
        kind: "matter.field_set",
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-2000),
        opId: "op_field_bad_status",
        payload: { field: "status", value: "not_a_status" },
      }),
    );

    const result = applyRecordOpsToState(ws, MID);
    const matter = loadMatter(ws, MID);

    expect(matter?.status).toBe("under_review");
    expect(matter?.matterId).toBe(MID);
    expect(result.matterFields).toBe(1);
  });
});

describe("apply-ops — 幂等", () => {
  it("重复投影结果一致", () => {
    const ws = tmpWorkspace();
    seedOwner(ws);
    appendRawOp(
      ws,
      lockOp({
        actorId: "lawyer_li",
        actorName: "李四",
        createdAt: isoIn(-1000),
        expiresAt: isoIn(HOUR),
      }),
    );
    appendRawOp(
      ws,
      rawOp({
        kind: "invite.accept",
        actorId: "lawyer_wang",
        actorName: "王五",
        createdAt: isoIn(-900),
        opId: "op_accept_wang",
        payload: { inviteId: "inv_2", role: "paralegal", email: "wang@firm.com" },
      }),
    );

    const first = applyRecordOpsToState(ws, MID);
    const second = applyRecordOpsToState(ws, MID);

    expect(second.locks).toBe(first.locks);
    expect(second.members).toBe(first.members);
    expect(listCheckoutLocks(ws, MID)).toHaveLength(1);
    expect(listActiveMembers(readMembership(ws, MID)!)).toHaveLength(2);
  });
});

describe("apply-ops — 跨机器集成（两个独立工作区 + 中继）", () => {
  type Pair = { a: string; b: string; relay: string; mid: string };

  function makePair(): Pair {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-apply-pair-"));
    tmpDirs.push(root);
    const relay = path.join(root, "relay");
    fs.mkdirSync(relay, { recursive: true });
    const policy = (): string =>
      JSON.stringify({
        schemaVersion: 1,
        edition: "firm",
        matterReplica: { enabled: true, sharedRelayDir: relay },
      });
    const a = path.join(root, "machineA");
    const b = path.join(root, "machineB");
    for (const ws of [a, b]) {
      fs.mkdirSync(path.join(ws, "cases", MID, "materials"), { recursive: true });
      fs.writeFileSync(path.join(ws, "lawmind.policy.json"), policy(), "utf8");
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
    return { a, b, relay, mid: MID };
  }

  it("A 签出后同步，B 端看得见并且不再覆盖（Word 防互踩）", async () => {
    const p = makePair();
    const abs = path.join(p.a, "cases", p.mid, "materials", "委托合同（初稿）.docx");
    fs.writeFileSync(abs, "初稿\n", "utf8");

    await syncMatterRecordPipe(p.a, p.mid);
    await syncMatterRecordPipe(p.b, p.mid);

    acquireCheckoutLock(p.a, {
      matterId: p.mid,
      matterTitle: "王某买卖合同纠纷",
      relPath: MATERIAL_REL,
    });

    await syncMatterRecordPipe(p.a, p.mid);
    const onB = await syncMatterRecordPipe(p.b, p.mid);

    const locksOnB = listCheckoutLocks(p.b, p.mid);
    expect(locksOnB).toHaveLength(1);
    expect(locksOnB[0]?.holderDisplayName).toBe("张三");
    expect(isPathCheckedOut(p.b, p.mid, MATERIAL_REL)).toBe(true);
    expect(onB.applied.locks).toBe(1);
  });

  it("同事入伙后，主办端名册同步出现该成员（不再两边不一致）", async () => {
    const p = makePair();
    const invite = createInvite(p.a, {
      matterId: p.mid,
      matterTitle: "王某买卖合同纠纷",
      email: "li@firm.com",
      role: "associate",
    });
    await syncMatterRecordPipe(p.a, p.mid);
    await syncMatterRecordPipe(p.b, p.mid);

    // 代码里唯一的加入通道：邀请包投放 inbox（UI 入口仍未接线）
    const inbox = path.join(p.b, "lawmind", "replica", "inbox");
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(
      path.join(inbox, `${invite.inviteId}.json`),
      exportInvitePack(p.a, invite),
      "utf8",
    );
    acceptInviteByToken(p.b, invite.token);

    await syncMatterRecordPipe(p.b, p.mid);
    await syncMatterRecordPipe(p.a, p.mid);

    const namesA = (readMembership(p.a, p.mid)?.members ?? []).map((m) => m.displayName);
    expect(namesA).toContain("李四");
    const li = readMembership(p.a, p.mid)?.members.find((m) => m.lawyerId === "lawyer_li");
    expect(li?.role).toBe("associate");
    expect(li?.email).toBe("li@firm.com");
  });
});
