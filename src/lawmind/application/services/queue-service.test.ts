import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLawMindEngine,
  createLegalModelAdapter,
  createWorkspaceAdapter,
  listApprovalRequests,
  listWorkQueueItems,
} from "../../index.js";

describe("LawMind queue service", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-queue-service-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Global memory", "utf8");
    await fs.writeFile(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer profile", "utf8");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("lists pending approval requests for high-risk planned work", async () => {
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir)],
    });

    engine.plan("写一封催款律师函", { matterId: "matter-queue-1" });
    const approvals = await listApprovalRequests(workspaceDir, {
      matterId: "matter-queue-1",
      status: "pending",
    });

    expect(approvals.some((item) => item.approvalId.endsWith(":task-confirmation"))).toBe(true);
  });

  it("lists queue items for pending review and evidence gaps", async () => {
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
      matterId: "matter-queue-2",
      templateId: "word/legal-memo-default",
    });
    await engine.confirm(intent.taskId, { actorId: "lawyer:test" });
    const bundle = await engine.research(intent);
    engine.draft(intent, bundle, { title: "待审核法律意见" });

    const queueItems = await listWorkQueueItems(workspaceDir, { matterId: "matter-queue-2" });
    expect(queueItems.some((item) => item.kind === "need_lawyer_review")).toBe(true);
    expect(queueItems.some((item) => item.kind === "need_evidence")).toBe(true);
  });
});
