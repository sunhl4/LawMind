import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveMatter } from "../adapters/matter-storage/index.js";
import { createSession } from "../agent/session.js";
import { persistDraft } from "../drafts/index.js";
import { defaultCaseTemplate } from "../memory/templates.js";
import { ensureTaskRecord } from "../tasks/index.js";
import { buildMatterDeletePlan, replicaCloudMatterDir } from "./delete-matter-plan.js";

const temps: string[] = [];

async function tmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-del-plan-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function writeMatterRecord(
  ws: string,
  matterId: string,
  status: "intake" | "active" | "closed",
): void {
  saveMatter(ws, {
    matterId,
    title: `${matterId} 标题`,
    status,
    sensitivity: "normal",
    strategyStatus: "draft",
    openQuestionIds: [],
    nextActions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function writeDeadline(ws: string, matterId: string, status: "open" | "completed") {
  const dir = path.join(ws, "matters", matterId);
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(
    path.join(dir, "deadlines.jsonl"),
    `${JSON.stringify({
      deadlineId: `d-${status}`,
      matterId,
      title: "开庭",
      dueAt: "2026-10-01T09:00:00",
      severity: "hard",
      source: "manual",
      status,
    })}\n`,
    "utf8",
  );
}

describe("buildMatterDeletePlan", () => {
  it("classifies an untouched volume as empty_shell and suggests full cleanup", async () => {
    const ws = await tmp();
    const id = "shell-1";
    await fs.mkdir(path.join(ws, "cases", id), { recursive: true });
    await fs.writeFile(path.join(ws, "cases", id, "CASE.md"), defaultCaseTemplate(id));
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });

    const plan = await buildMatterDeletePlan(ws, id);
    expect(plan.scenario).toBe("empty_shell");
    expect(plan.suggested).toEqual({
      deleteMaterials: true,
      deleteTasks: true,
      deleteSessions: true,
      deleteUnapprovedDrafts: true,
    });
    expect(plan.warnings).toEqual([]);
  });

  it("classifies a volume with only open deadlines as active, not empty_shell", async () => {
    const ws = await tmp();
    const id = "deadline-only";
    writeMatterRecord(ws, id, "active");
    await writeDeadline(ws, id, "open");

    const plan = await buildMatterDeletePlan(ws, id);
    expect(plan.scenario).toBe("active");
    expect(plan.openDeadlines).toBe(1);
    expect(plan.suggested.deleteMaterials).toBe(false);
  });

  it("classifies a volume with materials and open deadline as active and stays conservative", async () => {
    const ws = await tmp();
    const id = "active-1";
    await fs.mkdir(path.join(ws, "cases", id, "materials"), { recursive: true });
    await fs.writeFile(path.join(ws, "cases", id, "materials", "合同.docx"), "x");
    writeMatterRecord(ws, id, "active");
    await writeDeadline(ws, id, "open");

    const plan = await buildMatterDeletePlan(ws, id);
    expect(plan.scenario).toBe("active");
    expect(plan.volume.userFileCount).toBe(1);
    expect(plan.openDeadlines).toBe(1);
    expect(plan.suggested).toEqual({
      deleteMaterials: false,
      deleteTasks: false,
      deleteSessions: false,
      deleteUnapprovedDrafts: false,
    });
    expect(plan.warnings.join("\n")).toContain("仍在办理中");
    expect(plan.warnings.join("\n")).toContain("1 条未完成期限");
  });

  it("closed matters default to cleaning tasks and unapproved drafts while keeping sessions", async () => {
    const ws = await tmp();
    const id = "closed-1";
    await fs.mkdir(path.join(ws, "cases", id, "materials"), { recursive: true });
    await fs.writeFile(path.join(ws, "cases", id, "materials", "判决书.pdf"), "x");
    writeMatterRecord(ws, id, "closed");
    ensureTaskRecord(ws, {
      taskId: "t-c1",
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
      taskId: "t-c1",
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
    createSession({ workspaceDir: ws, actorId: "a", matterId: id, title: "结案讨论" });

    const plan = await buildMatterDeletePlan(ws, id);
    expect(plan.scenario).toBe("closed");
    expect(plan.tasks).toBe(1);
    expect(plan.sessions.count).toBe(1);
    expect(plan.sessions.sampleTitles).toContain("结案讨论");
    expect(plan.drafts).toEqual({ total: 1, protectedCount: 0, unprotectedCount: 1 });
    expect(plan.suggested).toEqual({
      deleteMaterials: false,
      deleteTasks: true,
      deleteSessions: false,
      deleteUnapprovedDrafts: true,
    });
    expect(plan.warnings.join("\n")).toContain("默认保留");
  });

  it("reports missing without walking the workspace when matter id is invalid", async () => {
    const ws = await tmp();
    const plan = await buildMatterDeletePlan(ws, "../../etc");
    expect(plan.scenario).toBe("missing");
    expect(plan.volume.userFileCount).toBe(0);
    expect(plan.warnings.join("")).toContain("不合法");
  });

  it("reports missing when neither volume dir exists", async () => {
    const ws = await tmp();
    const plan = await buildMatterDeletePlan(ws, "ghost");
    expect(plan.scenario).toBe("missing");
    expect(plan.volume.caseDir).toBe(false);
    expect(plan.volume.matterDir).toBe(false);
  });

  it("detects replica-cloud bundles only when they belong to the matter", async () => {
    const ws = await tmp();
    const id = "rep-plan";
    await fs.mkdir(path.join(ws, "matters", id), { recursive: true });
    const dir = replicaCloudMatterDir(ws, id);
    await fs.mkdir(dir, { recursive: true });

    // 目录在但 ops-bundle 归属不明 → 不算本案的同步包。
    expect((await buildMatterDeletePlan(ws, id)).replicaCloud).toBe(false);

    await fs.writeFile(
      path.join(dir, "ops-bundle.json"),
      JSON.stringify({ version: 1, matterId: id, ops: [] }),
    );
    expect((await buildMatterDeletePlan(ws, id)).replicaCloud).toBe(true);
  });
});
