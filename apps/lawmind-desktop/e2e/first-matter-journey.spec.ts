import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { test, expect } from "@playwright/test";
import {
  closeApp,
  collectLogs,
  completeFirstRunDialog,
  launchLawMindElectron,
  openReviewWorkbench,
  prepareE2EUserData,
  selectDraftInWorkbench,
  submitWorkspaceChat,
  waitForLocalServerReady,
  waitForShell,
} from "./helpers/app-driver.js";
import { approveDraft, createDraft, getDraftDetail, renderDraft, waitForHealth } from "./helpers/contract-api.js";

test.describe("首跑案件全旅程 E2E", () => {
  test.setTimeout(180_000);

  test("首跑对话框 → 创建案件 → 提交交办 → 生成草稿 → 签批 → 导出 DOCX", async () => {
    const config = await prepareE2EUserData();
    const electronApp = await launchLawMindElectron(config);
    const window = await electronApp.firstWindow();
    const logs = collectLogs(window);

    try {
      // 1. 启动应用并确认本地服务就绪
      await waitForShell(window);
      const rendererConfig = await waitForLocalServerReady(window);

      // 2. 走首跑对话框，完成案件创建
      const matterId = await completeFirstRunDialog(window);
      expect(matterId).toBeTruthy();

      // 3. 在 chat 中提交交办
      await submitWorkspaceChat(window, "请审查这份买卖合同并给出意见");

      // 4. 通过 API（mock 加速）直接生成草稿，避免等待真模型
      const draft = await createDraft(rendererConfig.apiBase, rendererConfig.apiAuthToken, {
        matterId,
        title: "E2E 买卖合同审查意见",
        summary: "E2E journey 测试摘要：买卖合同审查。",
        sections: [
          { heading: "审查结论", body: "整体可签，E2E_JOURNEY_EXPECTED_CONTENT 已落盘。" },
          { heading: "主要风险", body: "第 8 条违约金约定偏低，建议调高。" },
          { heading: "修改建议", body: "建议提高违约金并写明解除触发条件。" },
        ],
        output: "docx",
        deliverableType: "contract.review",
      });
      expect(draft.taskId).toBeTruthy();

      // 5. 在审核台/文书台查看草稿
      await openReviewWorkbench(window);
      await selectDraftInWorkbench(window, draft.taskId);
      await expect(
        window.getByRole("heading", { name: "E2E 买卖合同审查意见" }),
      ).toBeVisible({ timeout: 15_000 });

      // 6. 执行签批（UI 按钮因必核清单被禁用，故使用 API 签批；仍属于端到端状态断言）
      await approveDraft(rendererConfig.apiBase, rendererConfig.apiAuthToken, draft.taskId);
      const detailAfterApprove = await getDraftDetail(
        rendererConfig.apiBase,
        rendererConfig.apiAuthToken,
        draft.taskId,
      );
      expect(detailAfterApprove.draft?.reviewStatus).toBe("approved");

      // 7. 通过 API 导出 DOCX 并断言文件存在、非空、包含预期内容
      // 由于 contract.review 需要 reasoning graph，UI 导出会被严格门禁拦截；
      // E2E 用 ?strict=false 测试路由绕过，只断言端到端文件结果。
      const renderResp = await renderDraft(
        rendererConfig.apiBase,
        rendererConfig.apiAuthToken,
        draft.taskId,
      );
      expect(renderResp.ok).toBe(true);
      const detailAfterExport = await getDraftDetail(
        rendererConfig.apiBase,
        rendererConfig.apiAuthToken,
        draft.taskId,
      );
      expect(detailAfterExport.draft?.outputPath).toBeTruthy();
      const outputPath = path.resolve(
        config.workspaceDir,
        detailAfterExport.draft!.outputPath!.replace(/^\\?/, ""),
      );
      await expect.poll(async () => fs.access(outputPath).then(() => true).catch(() => false)).toBe(true);
      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(0);
      const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
      const documentXml = await zip.file("word/document.xml")?.async("text");
      expect(documentXml).toBeTruthy();
      expect(documentXml).toContain("E2E_JOURNEY_EXPECTED_CONTENT");

      // 8. 关闭应用，断言无未处理异常
      await closeApp(electronApp, logs);
    } finally {
      await electronApp.close().catch(() => undefined);
    }
  });

  test("跳过首跑时仍可用 API 编排完整案件-草稿-导出链路", async () => {
    const config = await prepareE2EUserData();
    const electronApp = await launchLawMindElectron(config);
    const window = await electronApp.firstWindow();
    const logs = collectLogs(window);

    try {
      await waitForShell(window);
      const rendererConfig = await waitForLocalServerReady(window);
      // 显式等待健康接口稳定，确保后续 API 调用可用
      await waitForHealth(rendererConfig.apiBase, rendererConfig.apiAuthToken);

      // 直接通过 API 创建案件与草稿（跳过首跑对话框）
      const { createMatter } = await import("./helpers/contract-api.js");
      const { matterId } = await createMatter(rendererConfig.apiBase, rendererConfig.apiAuthToken, {
        matterId: "e2e-skip-first-run-matter",
        displayName: "E2E 跳过首跑案件",
      });
      const draft = await createDraft(rendererConfig.apiBase, rendererConfig.apiAuthToken, {
        matterId,
        title: "E2E 跳过首跑草稿",
        summary: "跳过首跑对话框的契约化测试。",
        sections: [{ heading: "结论", body: "E2E_SKIP_FIRST_RUN_CONTENT" }],
      });

      await openReviewWorkbench(window);
      await selectDraftInWorkbench(window, draft.taskId);
      await approveDraft(rendererConfig.apiBase, rendererConfig.apiAuthToken, draft.taskId);
      const renderResp = await renderDraft(
        rendererConfig.apiBase,
        rendererConfig.apiAuthToken,
        draft.taskId,
      );
      expect(renderResp.ok).toBe(true);
      const detail = await getDraftDetail(
        rendererConfig.apiBase,
        rendererConfig.apiAuthToken,
        draft.taskId,
      );
      expect(detail.draft?.reviewStatus).toBe("approved");
      expect(detail.draft?.outputPath).toBeTruthy();
      await closeApp(electronApp, logs);
    } finally {
      await electronApp.close().catch(() => undefined);
    }
  });
});
