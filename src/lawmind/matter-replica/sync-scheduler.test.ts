/**
 * 自动同步调度器测试（差距评审 X10）。
 *
 * 判据不是「代码里有 setInterval」，而是「不手点同步，材料也会自己到」。
 * 所以这里跑真调度器 + 真同步 + 真中继，只把间隔调小。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureMembershipWithOwner, upsertLawyerIdentity } from "./index.js";
import { syncMatterRecordPipe } from "./relay.js";
import { MatterReplicaSyncScheduler, listAutoSyncMatters } from "./sync-scheduler.js";

const tmpDirs: string[] = [];
const MID = "matter_auto2026";
const REL = "materials/证据清单.txt";
const schedulers: MatterReplicaSyncScheduler[] = [];

afterEach(() => {
  for (const s of schedulers.splice(0)) {
    s.stop();
  }
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function track(s: MatterReplicaSyncScheduler): MatterReplicaSyncScheduler {
  schedulers.push(s);
  return s;
}

type Pair = { a: string; b: string; relay: string };

function makePair(opts?: { autoSync?: boolean }): Pair {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-auto-"));
  tmpDirs.push(root);
  const relay = path.join(root, "relay");
  fs.mkdirSync(relay, { recursive: true });
  const policy = JSON.stringify({
    schemaVersion: 1,
    edition: "firm",
    matterReplica: {
      enabled: true,
      sharedRelayDir: relay,
      ...(opts?.autoSync === undefined ? {} : { autoSync: opts.autoSync }),
    },
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
  upsertLawyerIdentity(b, { displayName: "李四", email: "li@firm.com", lawyerId: "lawyer_li" });
  ensureMembershipWithOwner(a, {
    matterId: MID,
    matterTitle: "王某买卖合同纠纷",
    ownerLawyerId: "lawyer_zhang",
    ownerDisplayName: "张三",
  });
  ensureMembershipWithOwner(b, {
    matterId: MID,
    matterTitle: "王某买卖合同纠纷",
    ownerLawyerId: "lawyer_li",
    ownerDisplayName: "李四",
  });
  return { a, b, relay };
}

function abs(ws: string, rel: string): string {
  return path.join(ws, "cases", MID, ...rel.split("/"));
}

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

describe("自动同步调度器", () => {
  it("显式关掉成员协作时不启动、不碰任何案件", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-auto-solo-"));
    tmpDirs.push(root);
    fs.writeFileSync(
      path.join(root, "lawmind.policy.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "solo",
        matterReplica: { enabled: false },
      }),
      "utf8",
    );
    ensureMembershipWithOwner(root, {
      matterId: MID,
      matterTitle: "案",
      ownerLawyerId: "lawyer_zhang",
      ownerDisplayName: "张三",
    });
    const s = track(new MatterReplicaSyncScheduler({ workspaceDir: root, intervalMs: 60_000 }));
    s.start();

    expect(s.status().enabled).toBe(false);
    expect(s.status().running).toBe(false);
    expect(s.status().syncs).toBe(0);
  });

  it("autoSync: false 时不启动（只想手点同步的场景）", () => {
    const p = makePair({ autoSync: false });
    const s = track(new MatterReplicaSyncScheduler({ workspaceDir: p.b, intervalMs: 60_000 }));
    s.start();
    expect(s.status().enabled).toBe(true);
    expect(s.status().autoSync).toBe(false);
    expect(s.status().running).toBe(false);
  });

  it("不手点同步，同事的材料也会自己到达（真调度器 + 真中继）", async () => {
    const p = makePair();
    // 初始同步一次，让 B 有案件结构
    await syncMatterRecordPipe(p.b, MID);

    const s = track(
      new MatterReplicaSyncScheduler({
        workspaceDir: p.b,
        intervalMs: 100,
        minMatterIntervalMs: 0,
        debounceMs: 20,
      }),
    );
    s.start();
    expect(s.status().running).toBe(true);

    // A 放入材料并同步 —— 之后**不再**碰 B 的任何同步入口
    const absA = abs(p.a, REL);
    fs.mkdirSync(path.dirname(absA), { recursive: true });
    fs.writeFileSync(absA, "对方盖章版合同扫描件待入卷\n", "utf8");
    await syncMatterRecordPipe(p.a, MID);

    const arrived = await waitFor(() => fs.existsSync(abs(p.b, REL)));
    expect(arrived).toBe(true);
    expect(fs.readFileSync(abs(p.b, REL), "utf8")).toContain("盖章版");
    expect(s.status().syncs).toBeGreaterThan(0);
    expect(s.status().lastRunAt).not.toBeNull();
  });

  it("共享中继有动静时立刻同步（监听 + 去抖）", async () => {
    const p = makePair();
    await syncMatterRecordPipe(p.b, MID);

    // 轮询间隔设得很长，只有依赖中继监听才能在超时内到达
    const s = track(
      new MatterReplicaSyncScheduler({
        workspaceDir: p.b,
        intervalMs: 60_000,
        minMatterIntervalMs: 0,
        debounceMs: 20,
      }),
    );
    s.start();
    expect(s.status().watchingRelay).toBe(true);

    const absA = abs(p.a, REL);
    fs.mkdirSync(path.dirname(absA), { recursive: true });
    fs.writeFileSync(absA, "只靠监听也该到\n", "utf8");
    await syncMatterRecordPipe(p.a, MID);

    const arrived = await waitFor(() => fs.existsSync(abs(p.b, REL)), 4000);
    expect(arrived).toBe(true);
  });

  it("单案失败不拖累其他案件", async () => {
    const p = makePair();
    const s = track(
      new MatterReplicaSyncScheduler({
        workspaceDir: p.b,
        intervalMs: 60_000,
        minMatterIntervalMs: 0,
        sync: async (_ws, matterId) => {
          if (matterId === MID) {
            throw new Error("中继暂时不可用");
          }
          return {
            pulled: 1,
            applied: { locks: 0, members: 1 },
            materials: { downloadedFiles: 1, deletedLocally: [], rejectedIntegrity: [] },
          };
        },
      }),
    );

    // 造两个在册案件
    const other = "matter_other";
    fs.mkdirSync(path.join(p.b, "cases", other, "materials"), { recursive: true });
    ensureMembershipWithOwner(p.b, {
      matterId: other,
      matterTitle: "另一案",
      ownerLawyerId: "lawyer_li",
      ownerDisplayName: "李四",
    });

    const outcomes = await s.tick();
    expect(outcomes).toHaveLength(2);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.find((o) => !o.ok)?.error).toMatch(/中继暂时不可用/);
    expect(s.status().lastError).toMatch(/中继暂时不可用/);
  });

  it("节流：同一案件在最小间隔内不会被反复同步", async () => {
    const p = makePair();
    let calls = 0;
    const s = track(
      new MatterReplicaSyncScheduler({
        workspaceDir: p.b,
        intervalMs: 60_000,
        minMatterIntervalMs: 10_000,
        sync: async () => {
          calls += 1;
          return {
            pulled: 0,
            applied: { locks: 0, members: 1 },
            materials: { downloadedFiles: 0, deletedLocally: [], rejectedIntegrity: [] },
          };
        },
      }),
    );

    await s.tick();
    await s.tick();
    await s.tick();

    expect(calls).toBe(1);
    expect(s.status().skipped).toBeGreaterThan(0);
  });

  it("单飞：上一轮未完成时不会并发堆积", async () => {
    const p = makePair();
    let inFlight = 0;
    let maxInFlight = 0;
    const s = track(
      new MatterReplicaSyncScheduler({
        workspaceDir: p.b,
        intervalMs: 60_000,
        minMatterIntervalMs: 0,
        sync: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 40));
          inFlight -= 1;
          return {
            pulled: 0,
            applied: { locks: 0, members: 1 },
            materials: { downloadedFiles: 0, deletedLocally: [], rejectedIntegrity: [] },
          };
        },
      }),
    );

    const [r1] = await Promise.all([s.tick(), s.tick(), s.tick()]);
    expect(r1).toHaveLength(1);
    expect(maxInFlight).toBe(1);
    expect(s.status().skipped).toBeGreaterThan(0);
  });

  it("stop() 之后不再同步，且可重复调用", async () => {
    const p = makePair();
    let calls = 0;
    const s = track(
      new MatterReplicaSyncScheduler({
        workspaceDir: p.b,
        intervalMs: 50,
        minMatterIntervalMs: 0,
        sync: async () => {
          calls += 1;
          return {
            pulled: 0,
            applied: { locks: 0, members: 1 },
            materials: { downloadedFiles: 0, deletedLocally: [], rejectedIntegrity: [] },
          };
        },
      }),
    );
    s.start();
    await waitFor(() => calls > 0, 3000);
    s.stop();
    s.stop();
    const after = calls;
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(after);
    expect(s.status().running).toBe(false);
  });

  it("没有成员名册的案件不参与后台同步", () => {
    const p = makePair();
    // 只给 A 之外的第三个案件目录，但没有 membership
    fs.mkdirSync(path.join(p.b, "matters", "matter_orphan"), { recursive: true });
    const matters = listAutoSyncMatters(p.b);
    expect(matters).toContain(MID);
    expect(matters).not.toContain("matter_orphan");
  });

  it("中继目录不存在时降级为纯轮询，不抛错", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-auto-norelay-"));
    tmpDirs.push(root);
    fs.writeFileSync(
      path.join(root, "lawmind.policy.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "firm",
        matterReplica: { enabled: true, sharedRelayDir: path.join(root, "does-not-exist") },
      }),
      "utf8",
    );
    const s = track(new MatterReplicaSyncScheduler({ workspaceDir: root, intervalMs: 60_000 }));
    expect(() => s.start()).not.toThrow();
    expect(s.status().running).toBe(true);
    expect(s.status().watchingRelay).toBe(false);
    s.stop();
  });
});
