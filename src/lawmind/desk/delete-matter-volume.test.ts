import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSession, loadSession } from "../agent/session.js";
import { persistDraft, readDraft } from "../drafts/index.js";
import { defaultCaseTemplate } from "../memory/templates.js";
import { ensureTaskRecord, readTaskRecord } from "../tasks/index.js";
import { deleteMatterVolume } from "./delete-matter-volume.js";

const temps: string[] = [];

async function tmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-del-vol-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("deleteMatterVolume", () => {
  it("removes both the case folder and the matter record, and leaves policy alone", async () => {
    const ws = await tmp();
    const id = "empty-shell";
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", id, "matter.json"), "{}\n");
    await fs.writeFile(path.join(ws, "matters", id, "queue.jsonl"), "{}\n");
    await fs.writeFile(path.join(ws, "lawmind.policy.json"), "{}\n");
    await fs.mkdir(path.join(ws, "matters", "keep"), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", "keep", "matter.json"), "{}\n");

    const result = await deleteMatterVolume(ws, id, { requireEmpty: true });
    expect(result.ok).toBe(true);
    await expect(fs.access(path.join(ws, "matters", id))).rejects.toBeDefined();
    expect(await fs.readFile(path.join(ws, "lawmind.policy.json"), "utf8")).toBe("{}\n");
    expect(await fs.readFile(path.join(ws, "matters", "keep", "matter.json"), "utf8")).toBe("{}\n");
  });

  it("refuses to delete a volume that still has materials unless asked", async () => {
    const ws = await tmp();
    const id = "kept-2";
    await fs.mkdir(path.join(ws, "cases", id, "materials"), { recursive: true });
    await fs.writeFile(path.join(ws, "cases", id, "materials", "常法合同.docx"), "x");
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", id, "matter.json"), "{}\n");

    const refused = await deleteMatterVolume(ws, id, { requireEmpty: true });
    expect(refused.ok).toBe(false);
    await expect(
      fs.access(path.join(ws, "cases", id, "materials", "常法合同.docx")),
    ).resolves.toBeUndefined();

    const removed = await deleteMatterVolume(ws, id);
    expect(removed.ok).toBe(true);
    await expect(fs.access(path.join(ws, "cases", id))).rejects.toBeDefined();
    await expect(fs.access(path.join(ws, "matters", id))).rejects.toBeDefined();
  });

  it("treats an untouched CASE template as empty, and a written dossier as content", async () => {
    const ws = await tmp();
    const id = "shell";
    await fs.mkdir(path.join(ws, "cases", id), { recursive: true });
    await fs.writeFile(path.join(ws, "cases", id, "CASE.md"), defaultCaseTemplate(id));
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", id, "matter.json"), "{}\n");

    const empty = await deleteMatterVolume(ws, id, { requireEmpty: true });
    expect(empty.ok).toBe(true);

    const written = "written";
    await fs.mkdir(path.join(ws, "cases", written), { recursive: true });
    await fs.writeFile(
      path.join(ws, "cases", written, "CASE.md"),
      `${defaultCaseTemplate(written)}\n律师补了一句事实。\n`,
    );
    await fs.mkdir(path.join(ws, "matters", written), { recursive: true });
    const refused = await deleteMatterVolume(ws, written, { requireEmpty: true });
    expect(refused.ok).toBe(false);
    await expect(fs.access(path.join(ws, "cases", written, "CASE.md"))).resolves.toBeUndefined();
  });

  it("refuses a case directory that is a symlink to another matter", async () => {
    const ws = await tmp();
    await fs.mkdir(path.join(ws, "cases", "kept", "materials"), { recursive: true });
    await fs.writeFile(path.join(ws, "cases", "kept", "materials", "合同.docx"), "x");
    await fs.mkdir(path.join(ws, "matters", "alias"), { recursive: true });
    await fs.symlink(path.join(ws, "cases", "kept"), path.join(ws, "cases", "alias"));

    const result = await deleteMatterVolume(ws, "alias");
    expect(result.ok).toBe(false);
    await expect(
      fs.access(path.join(ws, "cases", "kept", "materials", "合同.docx")),
    ).resolves.toBeUndefined();
  });

  it("removes the replica-cloud bundle of the deleted matter only", async () => {
    const ws = await tmp();
    const id = "rep-1";
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", id, "matter.json"), "{}\n");
    const bundle = path.join(ws, "lawmind", "replica-cloud", id);
    await fs.mkdir(bundle, { recursive: true });
    await fs.writeFile(
      path.join(bundle, "ops-bundle.json"),
      JSON.stringify({ version: 1, matterId: id, ops: [] }),
    );
    const other = path.join(ws, "lawmind", "replica-cloud", "rep-2");
    await fs.mkdir(other, { recursive: true });
    await fs.writeFile(
      path.join(other, "ops-bundle.json"),
      JSON.stringify({ version: 1, matterId: "rep-2", ops: [] }),
    );

    const result = await deleteMatterVolume(ws, id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.removedReplicaCloud).toBe(true);
    }
    await expect(fs.access(bundle)).rejects.toBeDefined();
    await expect(fs.access(path.join(other, "ops-bundle.json"))).resolves.toBeUndefined();
  });

  it("keeps a replica-cloud dir whose bundle belongs to a different matter (sanitized name collision)", async () => {
    const ws = await tmp();
    // 「甲案」「乙案」经 safeMatterId 都落成 __：撞名时按 ops-bundle 归属判断。
    await fs.mkdir(path.join(ws, "matters", "甲案"), { recursive: true });
    const shared = path.join(ws, "lawmind", "replica-cloud", "__");
    await fs.mkdir(shared, { recursive: true });
    await fs.writeFile(
      path.join(shared, "ops-bundle.json"),
      JSON.stringify({ version: 1, matterId: "乙案", ops: [] }),
    );

    const result = await deleteMatterVolume(ws, "甲案");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.removedReplicaCloud).toBe(false);
    }
    await expect(fs.access(path.join(shared, "ops-bundle.json"))).resolves.toBeUndefined();
  });

  it("cascades tasks, sessions and unapproved drafts when asked; keeps protected drafts", async () => {
    const ws = await tmp();
    const id = "cascade-1";
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", id, "matter.json"), "{}\n");

    ensureTaskRecord(ws, {
      taskId: "t-1",
      kind: "draft.word",
      output: "docx",
      instruction: "写",
      summary: "写",
      riskLevel: "medium",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
      matterId: id,
    });
    const session = createSession({ workspaceDir: ws, actorId: "a", matterId: id });
    const keepSession = createSession({ workspaceDir: ws, actorId: "a", matterId: id });
    persistDraft(ws, {
      taskId: "t-1",
      title: "待审",
      output: "docx",
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      matterId: id,
    });
    ensureTaskRecord(ws, {
      taskId: "t-2",
      kind: "draft.word",
      output: "docx",
      instruction: "写",
      summary: "写",
      riskLevel: "medium",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
      matterId: id,
    });
    persistDraft(ws, {
      taskId: "t-2",
      title: "已批准",
      output: "docx",
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "approved",
      createdAt: new Date().toISOString(),
      matterId: id,
    });

    const result = await deleteMatterVolume(ws, id, {
      deleteTasks: true,
      deleteSessions: true,
      deleteUnapprovedDrafts: true,
      excludeSessionId: keepSession.sessionId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // t-1 随未批准草稿一起删；t-2 已批准，任务账保留。
    expect(result.deletedTasks).toBe(1);
    expect(result.deletedSessions).toBe(1);
    expect(result.unlinkedSessions).toBe(1);
    expect(result.deletedDrafts).toBe(1);
    expect(result.keptDrafts).toBe(1);
    expect(readTaskRecord(ws, "t-1")).toBeUndefined();
    expect(readTaskRecord(ws, "t-2")).toBeDefined();
    expect(readDraft(ws, "t-1")).toBeUndefined();
    expect(readDraft(ws, "t-2")?.reviewStatus).toBe("approved");
    expect(loadSession(ws, session.sessionId)).toBeUndefined();
    const kept = loadSession(ws, keepSession.sessionId);
    expect(kept).toBeDefined();
    expect(kept?.matterId).toBeUndefined();
  });

  it("unlinks remaining sessions when deleteSessions is false", async () => {
    const ws = await tmp();
    const id = "unlink-1";
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", id, "matter.json"), "{}\n");
    const session = createSession({ workspaceDir: ws, actorId: "a", matterId: id });

    const result = await deleteMatterVolume(ws, id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deletedSessions).toBe(0);
      expect(result.unlinkedSessions).toBe(1);
    }
    const after = loadSession(ws, session.sessionId);
    expect(after).toBeDefined();
    expect(after?.matterId).toBeUndefined();
  });

  it("writes a matter.deleted audit event with the cascade scope", async () => {
    const ws = await tmp();
    const id = "audit-1";
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });
    await fs.writeFile(path.join(ws, "matters", id, "matter.json"), "{}\n");

    const result = await deleteMatterVolume(ws, id, { actorId: "lawyer-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auditEmitted).toBe(true);
    }
    const auditDir = path.join(ws, "audit");
    const files = (await fs.readdir(auditDir)).filter((name) => name.endsWith(".jsonl"));
    const lines = (
      await Promise.all(files.map((name) => fs.readFile(path.join(auditDir, name), "utf8")))
    ).join("");
    expect(lines).toContain('"matter.deleted"');
    expect(lines).toContain(`"matterId":"${id}"`);
    expect(lines).toContain('"lawyer-1"');
  });
});
