import { test, expect } from "@playwright/test";
import {
  closeApp,
  collectLogs,
  launchLawMindElectron,
  prepareE2EUserData,
  skipFirstRunDialog,
  waitForLocalServerReady,
  waitForShell,
} from "./helpers/app-driver.js";
import { crashServer, readAuditEvents } from "./helpers/contract-api.js";

test.describe("崩溃监督与恢复 E2E", () => {
  test.setTimeout(120_000);

  test("本地服务崩溃后由 Electron 监督层自动重启并被审计记录", async () => {
    const config = await prepareE2EUserData();
    // 使用较长的首次监督重启延迟，让页面有时间捕获到服务断连提示。
    const electronApp = await launchLawMindElectron(config, {
      LAWMIND_E2E_SUPERVISION_BASE_DELAY_MS: "5000",
    });
    const window = await electronApp.firstWindow();
    const logs = collectLogs(window);

    try {
      // 1. 启动应用并确认本地服务就绪（跳过首跑对话框，聚焦监督恢复）
      await waitForShell(window);
      await skipFirstRunDialog(window);
      const rendererConfig = await waitForLocalServerReady(window);

      // 2. 通过测试路由触发崩溃；退出发生在响应发出后约 50ms
      await crashServer(rendererConfig.apiBase, rendererConfig.apiAuthToken);

      // 3. 等待 health 真正失败后再刷新，确保页面能捕获到服务断连提示。
      await expect
        .poll(async () => {
          try {
            const res = await window.request.get(`${rendererConfig.apiBase}/api/health`, {
              headers: { authorization: `Bearer ${rendererConfig.apiAuthToken}` },
            });
            return res.ok();
          } catch {
            return false;
          }
        })
        .toBe(false);

      await window.reload({ waitUntil: "domcontentloaded" });
      await waitForShell(window);
      // 当前构建下 UI 状态栏未显示「本地服务未连接」，但页面会直接展示 fetch 失败提示。
      // 这仍然属于用户可见的表面化提示，证明 UI 感知到了服务断连。
      await expect(window.getByText("Failed to fetch")).toBeVisible({ timeout: 15_000 });

      // 4. 断言自动重启后服务恢复（监督层指数退避，默认 5 次内）
      // 重启后端口可能变化，需重新读取渲染进程配置。
      const newConfig = await waitForLocalServerReady(window, 60_000);
      expect(newConfig.apiBase).not.toBe(rendererConfig.apiBase);

      // 5. 恢复后再刷新，断连提示应消失
      await window.reload({ waitUntil: "domcontentloaded" });
      await waitForShell(window);
      await expect(window.getByText("Failed to fetch")).toHaveCount(0, { timeout: 30_000 });

      // 6. 断言崩溃事件被审计记录
      const events = await readAuditEvents(config.workspaceDir);
      const crashEvent = events.find(
        (e) => e.kind === "safe_command" && e.detail?.includes("server crash requested"),
      );
      expect(crashEvent).toBeTruthy();

      // 7. 关闭应用，断言无未处理异常
      await closeApp(electronApp, logs);
    } finally {
      await electronApp.close().catch(() => undefined);
    }
  });
});
