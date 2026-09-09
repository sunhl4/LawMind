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
      await closeApp(electronApp, logs);
    } finally {
      await electronApp.close().catch(() => undefined);
    }
  });
});
