/**
 * Memory layer tests for case workspace bootstrap and loading.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendCaseArtifact,
  appendCaseCoreIssue,
  appendCaseProgress,
  appendCaseRiskNote,
  appendCaseTaskGoal,
  caseFilePath,
  ensureCaseWorkspace,
  loadMemoryContext,
} from "./index.js";

describe("LawMind Memory", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-memory-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Global memory", "utf8");
    await fs.writeFile(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer profile", "utf8");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("creates CASE.md template when matter workspace is missing", async () => {
    const filePath = await ensureCaseWorkspace(workspaceDir, "matter-001");
    const content = await fs.readFile(filePath, "utf8");

    expect(filePath).toBe(caseFilePath(workspaceDir, "matter-001"));
    expect(content).toContain("# 案件档案：matter-001");
    expect(content).toContain("## 4. 核心争点");
  });

  it("loads case memory when matterId is provided", async () => {
    await ensureCaseWorkspace(workspaceDir, "matter-002");
    const filePath = caseFilePath(workspaceDir, "matter-002");
    await fs.writeFile(filePath, "# 案件档案：matter-002\n\n## 事实摘要\n\n- 已有案件信息", "utf8");

    const memory = await loadMemoryContext(workspaceDir, { matterId: "matter-002" });

    expect(memory.general).toContain("Global memory");
    expect(memory.profile).toContain("Lawyer profile");
    expect(memory.caseMemory).toContain("matter-002");
    expect(memory.caseMemory).toContain("已有案件信息");
  });

  it("appends structured entries into CASE.md sections", async () => {
    const filePath = await ensureCaseWorkspace(workspaceDir, "matter-003");
    await appendCaseTaskGoal(workspaceDir, "matter-003", "任务 t1: 梳理合同争议焦点");
    await appendCaseTaskGoal(workspaceDir, "matter-003", "任务 t1: 梳理合同争议焦点");
    await appendCaseCoreIssue(workspaceDir, "matter-003", "违约责任是否成立");
    await appendCaseCoreIssue(workspaceDir, "matter-003", "违约责任是否成立");
    await appendCaseRiskNote(workspaceDir, "matter-003", "任务 t1 风险提示：证据链不足");
    await appendCaseRiskNote(workspaceDir, "matter-003", "任务 t1 风险提示：证据链不足");
    await appendCaseProgress(workspaceDir, "matter-003", "任务 t1 检索完成：来源 2 条。");
    await appendCaseArtifact(
      workspaceDir,
      "matter-003",
      "法律意见书 -> workspace/artifacts/memo.docx",
    );
    await appendCaseArtifact(
      workspaceDir,
      "matter-003",
      "法律意见书 -> workspace/artifacts/memo.docx",
    );

    const content = await fs.readFile(filePath, "utf8");
    expect(content).toContain("## 6. 当前任务目标");
    expect(content).toContain("任务 t1: 梳理合同争议焦点");
    expect(content.match(/任务 t1: 梳理合同争议焦点/g)?.length).toBe(1);
    expect(content).toContain("## 4. 核心争点");
    expect(content.match(/违约责任是否成立/g)?.length).toBe(1);
    expect(content).toContain("## 7. 风险与待确认事项");
    expect(content).toContain("证据链不足");
    expect(content.match(/证据链不足/g)?.length).toBe(1);
    expect(content).toContain("## 8. 工作进展记录");
    expect(content).toContain("来源 2 条");
    expect(content).toContain("## 9. 生成产物");
    expect(content).toContain("memo.docx");
    expect(content.match(/memo\.docx/g)?.length).toBe(1);
  });
});
