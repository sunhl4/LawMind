import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptInviteByToken,
  acquireCheckoutLock,
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
});
