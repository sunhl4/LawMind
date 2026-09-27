import { test, expect } from "@playwright/test";
import {
  assertReviewGateList,
  bootstrapE2ePage,
  openReviewWorkbench,
} from "./e2e-helpers";
import { launchLawMindElectron, prepareE2EUserData } from "./helpers/app-driver.js";

/**
 * LawMind 真机 Electron 冒烟。
 *
 * ⚠️ **必须用 `launchLawMindElectron()` 启动**，不要改回 `_electron.launch` +
 * `--user-data-dir=<夹具目录>`。那条老写法有**两层静默失效**，本文件曾因此长期是红的：
 *
 * 1. Playwright 的 `_electron.launch()` 固定把 `--inspect=0 --remote-debugging-port=0`
 *    前置到 `args`，而 Electron 只在 `--user-data-dir` 位于其它开关**之前**时才认它
 *    → 开关被忽略，应用退回**机器上真实的 userData**（`~/Library/Application Support/Electron`）。
 * 2. 于是它与**任何正在运行的 LawMind 实例共用一个数据目录**，撞上 `app.requestSingleInstanceLock()`
 *    → 新实例打印「已有实例在运行（同一数据目录），本实例退出。」后直接退出
 *    → `electron.launch` 报 `Target page, context or browser has been closed`。
 *
 * 实测（2026-09-22）：本机开着一个 dev 实例时，本文件 4 条用例全部在 `electron.launch` 阶段失败，
 * 而同套件的 `electron-file-deeplink.spec.ts`（已用 helper）4+ 条全过 —— 差别只在启动方式。
 * helper 注入的是应用自己的 `LAWMIND_USER_DATA_DIR`，隔离真正生效，锁也落在夹具目录里。
 */
test.describe("LawMind Electron golden path", () => {
  test("shell loads with readiness strip or first-run wizard", async () => {
    const config = await prepareE2EUserData();
    const electronApp = await launchLawMindElectron(config);

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

  test("看修订回到对话，不打开改稿台", async () => {
    const config = await prepareE2EUserData();
    const electronApp = await launchLawMindElectron(config);

    try {
      const window = await electronApp.firstWindow();
      await expect(window.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(window);
      await openReviewWorkbench(window);
      await expect(window.locator(".lm-review-workbench, .lm-review-workbench-root")).toHaveCount(0);
      await expect(
        window.locator("#lawmind-chat-messages-panel").or(window.getByRole("region", { name: "对话消息" })).first(),
      ).toBeVisible({ timeout: 60_000 });
    } finally {
      await electronApp.close();
    }
  });

  test("review draft row shows gate list from seeded workspace draft", async () => {
    const config = await prepareE2EUserData();
    const electronApp = await launchLawMindElectron(config);

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

  test("file explorer mounts in sidebar with preload bridge", async () => {
    const config = await prepareE2EUserData();
    const electronApp = await launchLawMindElectron(config);

    try {
      const window = await electronApp.firstWindow();
      await expect(window.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(window);
      await expect(window.locator(".lm-files-explorer, .lm-side-explorer-host .lm-files-explorer").first()).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      await electronApp.close();
    }
  });
});
