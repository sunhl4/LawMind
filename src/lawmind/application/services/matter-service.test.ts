import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLawMindEngine,
  createLegalModelAdapter,
  createWorkspaceAdapter,
  getMatterCockpitSummary,
  getMatterReadModel,
  listMatterReadModels,
} from "../../index.js";

describe("LawMind matter service", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-matter-service-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Global memory", "utf8");
    await fs.writeFile(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer profile", "utf8");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("builds a matter read model from current workspace state", async () => {
    const mockLegal = createLegalModelAdapter(async () => ({
      claims: [{ text: "违约责任具备初步成立基础。", confidence: 0.88 }],
      sources: [{ title: "合同争议规则", citation: "内部规则" }],
      riskFlags: ["通知送达证据仍待补充"],
    }));

    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockLegal],
    });

    const intent = engine.plan("审查合同争议并输出律师意见", {
      matterId: "matter-service-1",
      templateId: "word/legal-memo-default",
    });
    const bundle = await engine.research(intent);
    const draft = engine.draft(intent, bundle, { title: "案件服务层法律意见" });

    const model = await getMatterReadModel(workspaceDir, "matter-service-1");
    expect(model.matter.matterId).toBe("matter-service-1");
    expect(model.matter.status).toBe("under_review");
    expect(model.deliverables[0]?.deliverableId).toBe(draft.taskId);
    expect(model.deliverables[0]?.status).toBe("pending_review");
  });

  it("lists matter read models ordered by latest update", async () => {
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir)],
    });

    engine.plan("整理案件 A", { matterId: "matter-a" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    engine.plan("整理案件 B", { matterId: "matter-b" });

    const models = await listMatterReadModels(workspaceDir);
    expect(models.map((item) => item.matter.matterId)).toEqual(["matter-b", "matter-a"]);
  });

  it("keeps cockpit summary behavior aligned with cases layer", async () => {
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir)],
    });

    engine.plan("整理案件摘要", { matterId: "matter-summary" });
    const summary = await getMatterCockpitSummary(workspaceDir, "matter-summary");
    expect(summary.statusLine).toContain("open=1");
  });
});
