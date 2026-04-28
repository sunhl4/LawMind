/**
 * Matter index aggregation tests.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLawMindEngine,
  createLegalModelAdapter,
  createWorkspaceAdapter,
  listMatterIds,
  listMatterOverviews,
} from "../index.js";

describe("LawMind Matter Index", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-matter-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Global memory", "utf8");
    await fs.writeFile(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer profile", "utf8");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("builds aggregated matter index from case, tasks, drafts and audit", async () => {
    const mockLegal = createLegalModelAdapter(async () => ({
      claims: [
        { text: "违约责任具备初步成立基础。", confidence: 0.88 },
        { text: "需进一步核对通知送达事实。", confidence: 0.74 },
      ],
      sources: [{ title: "合同争议规则", citation: "内部规则" }],
      riskFlags: ["通知送达证据仍待补充"],
    }));

    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockLegal],
    });

    const intent = engine.plan("审查合同争议并输出律师意见", {
      matterId: "matter-900",
      templateId: "word/legal-memo-default",
    });
    await engine.confirm(intent.taskId, { actorId: "lawyer:test" });
    const bundle = await engine.research(intent);
    const draft = engine.draft(intent, bundle, { title: "案件 900 法律意见" });
    await engine.review(draft, { actorId: "lawyer:test", status: "approved" });
    await engine.render(draft);

    const index = await engine.getMatterIndex("matter-900");

    expect(index.matterId).toBe("matter-900");
    expect(index.tasks.length).toBe(1);
    expect(index.drafts.length).toBe(1);
    expect(index.auditEvents.length).toBeGreaterThanOrEqual(4);
    expect(index.coreIssues.some((item) => item.includes("违约责任"))).toBe(true);
    expect(index.taskGoals.some((item) => item.includes(intent.taskId))).toBe(true);
    expect(index.riskNotes.some((item) => item.includes("通知送达证据"))).toBe(true);
    expect(index.artifacts.some((item) => item.includes(".docx"))).toBe(true);
    expect(index.renderedTasks.length).toBe(1);
    expect(index.openTasks.length).toBe(0);
    expect(index.latestUpdatedAt).toBeTruthy();

    const summary = await engine.getMatterSummary("matter-900");
    expect(summary.headline).toContain("违约责任");
    expect(summary.statusLine).toContain("rendered=1");
    expect(summary.keyRisks.some((item) => item.includes("通知送达"))).toBe(true);

    const searchHits = await engine.searchMatter("matter-900", "通知");
    expect(searchHits.length).toBeGreaterThan(0);
    expect(searchHits.some((hit) => hit.section === "riskNotes")).toBe(true);
  });

  it("lists matter ids from cases and tasks", async () => {
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir)],
    });

    engine.plan("整理案件摘要", { matterId: "matter-a" });
    engine.plan("整理案件摘要", { matterId: "matter-b" });

    const matterIds = await listMatterIds(workspaceDir);
    expect(matterIds).toEqual(["matter-a", "matter-b"]);
  });

  it("lists matter overviews sorted by latest update", async () => {
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir)],
    });

    engine.plan("整理案件摘要", { matterId: "matter-a" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    engine.plan("整理案件摘要", { matterId: "matter-b" });

    const overviews = await listMatterOverviews(workspaceDir);
    expect(overviews.map((item) => item.matterId)).toEqual(["matter-b", "matter-a"]);
    expect(overviews[0]?.openTaskCount).toBeGreaterThanOrEqual(0);
  });
});
