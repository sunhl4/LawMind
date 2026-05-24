import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import {
  assertReviewGateList,
  bootstrapE2ePage,
  openReviewWorkbench,
} from "./e2e-helpers";
import { prepareElectronE2EUserData } from "./electron-fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

test.describe("LawMind Electron golden path", () => {
  test("shell loads with readiness strip or first-run wizard", async () => {
    const { userDataDir } = await prepareElectronE2EUserData();
    const electronApp = await electron.launch({
      args: [
        path.join(desktopRoot, "electron/main.mjs"),
        `--user-data-dir=${userDataDir}`,
      ],
      cwd: desktopRoot,
      env: {
        ...process.env,
        LAWMIND_E2E: "1",
        LAWMIND_SKIP_AUTO_UPDATE: "1",
      },
      timeout: 120_000,
    });

    try {
      const window = await electronApp.firstWindow();
      await expect(window.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      const readiness = window.locator(".lm-readiness-strip");
      const wizard = window.getByRole("dialog", {
        name: /LawMind 首次配置|LawMind 新手引导|API/i,
      });
      const firstrun = window.locator(".lm-firstrun");
      const chatRegion = window.getByRole("region", { name: "对话消息" });
      await expect(readiness.or(wizard).or(firstrun).or(chatRegion).first()).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      await electronApp.close();
    }
  });

  test("review workbench region is reachable from shell", async () => {
    const { userDataDir } = await prepareElectronE2EUserData();
    const electronApp = await electron.launch({
      args: [
        path.join(desktopRoot, "electron/main.mjs"),
        `--user-data-dir=${userDataDir}`,
      ],
      cwd: desktopRoot,
      env: {
        ...process.env,
        LAWMIND_E2E: "1",
        LAWMIND_SKIP_AUTO_UPDATE: "1",
      },
      timeout: 120_000,
    });

    try {
      const window = await electronApp.firstWindow();
      await expect(window.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(window);
      await openReviewWorkbench(window);
      await expect(
        window
          .locator(".lm-review-workbench, .lm-workbench-placeholder, #lm-review-acceptance-gate")
          .first(),
      ).toBeVisible({ timeout: 60_000 });
    } finally {
      await electronApp.close();
    }
  });

  test("review draft row shows gate list from seeded workspace draft", async () => {
    const { userDataDir } = await prepareElectronE2EUserData();
    const electronApp = await electron.launch({
      args: [
        path.join(desktopRoot, "electron/main.mjs"),
        `--user-data-dir=${userDataDir}`,
      ],
      cwd: desktopRoot,
      env: {
        ...process.env,
        LAWMIND_E2E: "1",
        LAWMIND_SKIP_AUTO_UPDATE: "1",
      },
      timeout: 120_000,
    });

    try {
      const window = await electronApp.firstWindow();
      await expect(window.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(window);
      await openReviewWorkbench(window);
      await assertReviewGateList(window);
    } finally {
      await electronApp.close();
    }
  });
});
