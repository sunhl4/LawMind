import { test, expect } from "@playwright/test";
import {
  closeApp,
  collectLogs,
  launchLawMindElectron,
  prepareE2EUserData,
  waitForLocalServerReady,
  waitForShell,
} from "./helpers/app-driver.js";

test.describe("E2E app driver self-test", () => {
  test("helper 自身能启动 Electron 应用、连接本地服务并干净关闭", async () => {
    const config = await prepareE2EUserData();
    const electronApp = await launchLawMindElectron(config);
    try {
      const window = await electronApp.firstWindow();
      const logs = collectLogs(window);
      await waitForShell(window);
      const rendererConfig = await waitForLocalServerReady(window);
      expect(rendererConfig.apiBase).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(rendererConfig.workspaceDir).toBe(config.workspaceDir);
      // 隔离回归断言：应用数据根必须落在夹具临时目录内。
      // 若有人改回 `--user-data-dir`（或被 Playwright 前置开关挤掉），应用会
      // 静默读机器上真实的 desktop-config.json / .env.lawmind —— 这里直接失败，
      // 而不是让契约化 E2E 在后面报一个难懂的 403。
      expect(rendererConfig.lawMindRoot).toContain(config.userDataDir);
      expect(rendererConfig.configPath).toContain(config.userDataDir);
      await closeApp(electronApp, logs);
    } finally {
      await electronApp.close().catch(() => undefined);
    }
  });
});
