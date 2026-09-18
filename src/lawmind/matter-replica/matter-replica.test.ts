import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptInviteByToken,
  acquireCheckoutLock,
  appendRecordOp,
  createInvite,
  ensureMembershipWithOwner,
  evaluateMatterReplicaGate,
  FileReplicaRelay,
  listActiveMembers,
  listCheckoutLocks,
  listInvites,
  listMatterReplicaFeed,
  listRecordOps,
  publishLocalMaterials,
  readLawyerIdentity,
  releaseCheckoutLock,
  syncMatterRecordPipe,
  snapshotCaseMd,
  upsertLawyerIdentity,
  detectAndParkCaseMdConflict,
} from "./index.js";

const tmpDirs: string[] = [];

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-replica-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("matter-replica feature gate", () => {
  it("solo stays off by default", () => {
    const ws = tmpWorkspace();
    const gate = evaluateMatterReplicaGate(ws, {
      policy: { schemaVersion: 1, edition: "solo" },
      env: {},
    });
    expect(gate.enabled).toBe(false);
  });

  it("firm enables by default", () => {
    const ws = tmpWorkspace();
    const gate = evaluateMatterReplicaGate(ws, {
      policy: { schemaVersion: 1, edition: "firm" },
      env: {},
    });
    expect(gate.enabled).toBe(true);
  });

  it("solo can opt in via policy", () => {
    const ws = tmpWorkspace();
    const gate = evaluateMatterReplicaGate(ws, {
      policy: { schemaVersion: 1, edition: "solo", matterReplica: { enabled: true } },
      env: {},
    });
    expect(gate.enabled).toBe(true);
  });
});

describe("matter-replica invite + membership", () => {
  it("owner invites associate; accept joins membership", () => {
    const ownerWs = tmpWorkspace();
    upsertLawyerIdentity(ownerWs, {
      displayName: "张三",
      email: "zhang@example.com",
      lawyerId: "lawyer_zhang",
    });
    ensureMembershipWithOwner(ownerWs, {
      matterId: "matter_demo",
      matterTitle: "示范买卖合同",
      ownerLawyerId: "lawyer_zhang",
      ownerDisplayName: "张三",
      ownerEmail: "zhang@example.com",
    });
    const invite = createInvite(ownerWs, {
      matterId: "matter_demo",
      matterTitle: "示范买卖合同",
      email: "li@example.com",
      role: "associate",
    });
    expect(invite.token.startsWith("LM-")).toBe(true);
    expect(listInvites(ownerWs, "matter_demo")).toHaveLength(1);

    // Same workspace accept (simulates colleague on shared machine / after pack import)
    upsertLawyerIdentity(ownerWs, {
      displayName: "李四",
      email: "li@example.com",
      lawyerId: "lawyer_li",
    });
    const { membership } = acceptInviteByToken(ownerWs, invite.token);
    expect(membership).not.toBeNull();
    const active = listActiveMembers(membership!);
    expect(active.map((m) => m.lawyerId).toSorted()).toEqual(["lawyer_li", "lawyer_zhang"]);
    expect(active.find((m) => m.lawyerId === "lawyer_li")?.role).toBe("associate");
  });

  it("refuses invite without identity", () => {
    const ws = tmpWorkspace();
    expect(() =>
      createInvite(ws, {
        matterId: "m1",
        matterTitle: "x",
        email: "a@b.com",
        role: "associate",
      }),
    ).toThrow(/姓名/);
  });
});

describe("matter-replica checkout locks", () => {
  it("second lawyer cannot acquire same path", () => {
    const ws = tmpWorkspace();
    upsertLawyerIdentity(ws, {
      displayName: "张三",
      email: "zhang@example.com",
      lawyerId: "lawyer_zhang",
    });
    acquireCheckoutLock(ws, {
      matterId: "m1",
      matterTitle: "案",
      relPath: "materials/合同.docx",
    });
    expect(listCheckoutLocks(ws, "m1")).toHaveLength(1);

    upsertLawyerIdentity(ws, {
      displayName: "李四",
      email: "li@example.com",
      lawyerId: "lawyer_li",
    });
    // Li is not a member yet — ensureMembership makes Zhang owner only when Zhang acquires.
    // Re-set Zhang membership path: Li trying acquire without being member should fail capability.
    expect(() =>
      acquireCheckoutLock(ws, {
        matterId: "m1",
        matterTitle: "案",
        relPath: "materials/合同.docx",
      }),
    ).toThrow();
  });

  it("holder can release", () => {
    const ws = tmpWorkspace();
    upsertLawyerIdentity(ws, {
      displayName: "张三",
      email: "zhang@example.com",
      lawyerId: "lawyer_zhang",
    });
    acquireCheckoutLock(ws, {
      matterId: "m1",
      matterTitle: "案",
      relPath: "materials/a.docx",
    });
    releaseCheckoutLock(ws, "m1", "materials/a.docx");
    expect(listCheckoutLocks(ws, "m1")).toHaveLength(0);
  });
});

describe("matter-replica file relay", () => {
  it("syncs ops across two workspaces via shared folder", async () => {
    const relayDir = tmpWorkspace();
    const a = tmpWorkspace();
    const b = tmpWorkspace();
    fs.writeFileSync(
      path.join(a, "lawmind.policy.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "firm",
        matterReplica: { enabled: true, sharedRelayDir: relayDir },
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(b, "lawmind.policy.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "firm",
        matterReplica: { enabled: true, sharedRelayDir: relayDir },
      }),
      "utf8",
    );

    upsertLawyerIdentity(a, {
      displayName: "张三",
      email: "zhang@example.com",
      lawyerId: "lawyer_zhang",
    });
    createInvite(a, {
      matterId: "shared_matter",
      matterTitle: "共案",
      email: "li@example.com",
      role: "associate",
    });
    expect(listRecordOps(a, "shared_matter").length).toBeGreaterThan(0);

    const relay = new FileReplicaRelay(relayDir);
    await relay.publishOps("shared_matter", listRecordOps(a, "shared_matter"));
    const pulled = await syncMatterRecordPipe(b, "shared_matter");
    expect(pulled.pulled).toBeGreaterThan(0);
    expect(listRecordOps(b, "shared_matter").length).toBe(listRecordOps(a, "shared_matter").length);
  });

  it("snapshots CASE.md before publishing ops", async () => {
    const relayDir = tmpWorkspace();
    const a = tmpWorkspace();
    fs.writeFileSync(
      path.join(a, "lawmind.policy.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "firm",
        matterReplica: { enabled: true, sharedRelayDir: relayDir },
      }),
      "utf8",
    );
    fs.mkdirSync(path.join(a, "cases", "shared_matter"), { recursive: true });
    fs.writeFileSync(
      path.join(a, "cases", "shared_matter", "CASE.md"),
      "# 共案\n对方：乙公司\n",
      "utf8",
    );
    upsertLawyerIdentity(a, { displayName: "张三", lawyerId: "lawyer_zhang" });
    const synced = await syncMatterRecordPipe(a, "shared_matter");
    expect(synced.published).toBeGreaterThan(0);
    expect(
      listRecordOps(a, "shared_matter").some(
        (row) => row.kind === "case_md.snapshot" && String(row.payload.excerpt).includes("乙公司"),
      ),
    ).toBe(true);
  });
});

describe("matter-replica materials blob sync", () => {
  it("publishes and pulls a material file across two workspaces", async () => {
    const relayDir = tmpWorkspace();
    const a = tmpWorkspace();
    const b = tmpWorkspace();
    const policy = JSON.stringify({
      schemaVersion: 1,
      edition: "firm",
      matterReplica: { enabled: true, sharedRelayDir: relayDir },
    });
    fs.writeFileSync(path.join(a, "lawmind.policy.json"), policy, "utf8");
    fs.writeFileSync(path.join(b, "lawmind.policy.json"), policy, "utf8");

    const mid = "shared_matter";
    fs.mkdirSync(path.join(a, "cases", mid, "materials"), { recursive: true });
    fs.writeFileSync(
      path.join(a, "cases", mid, "materials", "证据清单.txt"),
      "对方盖章版合同扫描件待入卷\n",
      "utf8",
    );

    upsertLawyerIdentity(a, {
      displayName: "张三",
      email: "zhang@example.com",
      lawyerId: "lawyer_zhang",
    });
    ensureMembershipWithOwner(a, {
      matterId: mid,
      matterTitle: "共案",
      ownerLawyerId: "lawyer_zhang",
      ownerDisplayName: "张三",
    });

    const syncedA = await syncMatterRecordPipe(a, mid);
    expect(syncedA.materials.publishedFiles).toBe(1);
    expect(syncedA.materials.uploadedBlobs).toBe(1);
    expect(listRecordOps(a, mid).some((o) => o.kind === "material.put")).toBe(true);

    upsertLawyerIdentity(b, {
      displayName: "李四",
      email: "li@example.com",
      lawyerId: "lawyer_li",
    });
    const syncedB = await syncMatterRecordPipe(b, mid);
    expect(syncedB.materials.downloadedFiles).toBe(1);
    const dest = path.join(b, "cases", mid, "materials", "证据清单.txt");
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, "utf8")).toContain("盖章版");
  });

  it("parks the losing material as 冲突 instead of silent overwrite", async () => {
    const relayDir = tmpWorkspace();
    const a = tmpWorkspace();
    const b = tmpWorkspace();
    const policy = JSON.stringify({
      schemaVersion: 1,
      edition: "firm",
      matterReplica: { enabled: true, sharedRelayDir: relayDir },
    });
    fs.writeFileSync(path.join(a, "lawmind.policy.json"), policy, "utf8");
    fs.writeFileSync(path.join(b, "lawmind.policy.json"), policy, "utf8");
    const mid = "shared_matter";
    const relDir = path.join("cases", mid, "materials");
    fs.mkdirSync(path.join(a, relDir), { recursive: true });
    fs.mkdirSync(path.join(b, relDir), { recursive: true });
    const fileA = path.join(a, relDir, "证据清单.txt");
    const fileB = path.join(b, relDir, "证据清单.txt");
    fs.writeFileSync(fileB, "本机旧稿\n", "utf8");
    fs.writeFileSync(fileA, "对端新稿\n", "utf8");
    const old = new Date("2026-01-01T00:00:00.000Z");
    const neu = new Date("2026-09-17T00:00:00.000Z");
    fs.utimesSync(fileB, old, old);
    fs.utimesSync(fileA, neu, neu);

    upsertLawyerIdentity(a, { displayName: "张三", lawyerId: "lawyer_zhang" });
    ensureMembershipWithOwner(a, {
      matterId: mid,
      matterTitle: "共案",
      ownerLawyerId: "lawyer_zhang",
      ownerDisplayName: "张三",
    });
    upsertLawyerIdentity(b, { displayName: "李四", lawyerId: "lawyer_li" });
    ensureMembershipWithOwner(b, {
      matterId: mid,
      matterTitle: "共案",
      ownerLawyerId: "lawyer_li",
      ownerDisplayName: "李四",
    });

    await syncMatterRecordPipe(a, mid);
    const syncedB = await syncMatterRecordPipe(b, mid);
    expect(syncedB.materials.conflicts.some((row) => row.relPath === "materials/证据清单.txt")).toBe(
      true,
    );
    expect(fs.readFileSync(fileB, "utf8")).toContain("对端新稿");
    const sidecar = path.join(b, relDir, "证据清单 (冲突).txt");
    expect(fs.existsSync(sidecar)).toBe(true);
    expect(fs.readFileSync(sidecar, "utf8")).toContain("本机旧稿");
  });

  it("lists 新材料 in the feed", () => {
    const ws = tmpWorkspace();
    upsertLawyerIdentity(ws, { displayName: "张三", lawyerId: "lawyer_zhang" });
    const mid = "m_feed";
    fs.mkdirSync(path.join(ws, "cases", mid, "materials"), { recursive: true });
    fs.writeFileSync(path.join(ws, "cases", mid, "materials", "a.txt"), "hello", "utf8");
    publishLocalMaterials(ws, mid);
    const feed = listMatterReplicaFeed(ws, mid);
    expect(feed.some((f) => f.kind === "material.put" && f.title.includes("新材料"))).toBe(true);
  });
});

describe("lawyer identity", () => {
  it("round-trips", () => {
    const ws = tmpWorkspace();
    const id = upsertLawyerIdentity(ws, { displayName: "王五", email: "w@example.com" });
    expect(id.lawyerId.startsWith("lawyer_")).toBe(true);
    expect(readLawyerIdentity(ws)?.displayName).toBe("王五");
  });
});

describe("matter-replica CASE.md snapshot", () => {
  it("records an excerpt of CASE.md into the ops log", () => {
    const ws = tmpWorkspace();
    const mid = "matter_snap";
    fs.mkdirSync(path.join(ws, "cases", mid), { recursive: true });
    fs.writeFileSync(path.join(ws, "cases", mid, "CASE.md"), "# 示范案\n\n对方：甲公司\n", "utf8");
    const op = snapshotCaseMd(ws, {
      matterId: mid,
      actorId: "lawyer_zhang",
      actorName: "张三",
    });
    expect(op.kind).toBe("case_md.snapshot");
    expect(String(op.payload.sha256)).toMatch(/^[a-f0-9]{64}$/);
    expect(op.payload.relPath).toBe(`cases/${mid}/CASE.md`);
    expect(String(op.payload.excerpt)).toContain("甲公司");
    expect(op.payload.missing).toBe(false);
    expect(listRecordOps(ws, mid).some((row) => row.kind === "case_md.snapshot")).toBe(true);
  });

  it("parks a diverging remote CASE.md excerpt without overwriting local", () => {
    const ws = tmpWorkspace();
    const mid = "m_case_conflict";
    fs.mkdirSync(path.join(ws, "cases", mid), { recursive: true });
    fs.writeFileSync(path.join(ws, "cases", mid, "CASE.md"), "# 本机叙事\n甲方\n", "utf8");
    snapshotCaseMd(ws, { matterId: mid, actorId: "lawyer_local", actorName: "本机" });
    appendRecordOp(ws, {
      matterId: mid,
      kind: "case_md.snapshot",
      actorId: "lawyer_remote",
      actorName: "对端",
      payload: {
        relPath: `cases/${mid}/CASE.md`,
        charCount: 20,
        excerpt: "# 对端叙事\n乙方\n",
        sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        missing: false,
      },
    });
    const before = fs.readFileSync(path.join(ws, "cases", mid, "CASE.md"), "utf8");
    const parked = detectAndParkCaseMdConflict(ws, mid);
    expect(parked?.sidecarRel).toBe(`cases/${mid}/CASE（冲突摘录）.md`);
    expect(fs.readFileSync(path.join(ws, "cases", mid, "CASE.md"), "utf8")).toBe(before);
    expect(fs.readFileSync(path.join(ws, parked!.sidecarRel), "utf8")).toContain("对端叙事");
  });
});
