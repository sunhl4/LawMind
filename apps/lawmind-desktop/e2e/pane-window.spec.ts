import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { launchLawMindElectron, prepareE2EUserData, getRendererConfig } from "./helpers/app-driver.js";
import { bootstrapE2ePage, openDraftDesk } from "./e2e-helpers";

/**
 * 拆出 / 收回（Cursor-like pane windows）的真机契约。
 *
 * 四条用户可见性质，任一坏掉都等于「移动没生效」：
 *   1. 收回主窗口真的关掉独立窗，并把焦点交回主窗口；
 *   2. 独立窗里的内容跟着磁盘/对话改动刷新（文本 1.5s、草稿台 2.5s 轮询）；
 *   3. 文件标签拖出后，关窗时标签回到主窗口（不是被吞掉）；
 *   4. 草稿台在独立窗里也能看到别处改动的草稿（对话改稿后的场景）。
 */
async function prepareRealpathConfig(): Promise<Awaited<ReturnType<typeof prepareE2EUserData>>> {
  const config = await prepareE2EUserData();
  // macOS: os.tmpdir() 位于 /var（→/private/var），fs 桥的 realpath 围栏会把它判成越界。
  const workspaceDir = await fs.realpath(config.workspaceDir);
  await fs.writeFile(
    path.join(config.userDataDir, "LawMind", "desktop-config.json"),
    JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
    "utf8",
  );
  return { ...config, workspaceDir };
}

async function prepareWorkspaceWithLiveFile(): Promise<{
  config: Awaited<ReturnType<typeof prepareE2EUserData>>;
  workspaceDir: string;
  liveFile: string;
}> {
  const config = await prepareRealpathConfig();
  const liveFile = path.join(config.workspaceDir, "notes", "live.md");
  await fs.mkdir(path.dirname(liveFile), { recursive: true });
  await fs.writeFile(liveFile, "# 实时\n\n初始内容 LM-LIVE-001\n", "utf8");
  return { config, workspaceDir: config.workspaceDir, liveFile };
}

async function openWorkspaceFile(page: Page, relPath: string): Promise<void> {
  await page.evaluate((file) => {
    window.dispatchEvent(
      new CustomEvent("lawmind:open-workspace-file", { detail: { relPath: file } }),
    );
  }, relPath);
  await expect(page.locator(".lm-file-tab", { hasText: "live" }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".lm-editor-pane").first()).toContainText("LM-LIVE-001", {
    timeout: 30_000,
  });
}

test.describe("独立 pane 窗：拆出、实时刷新、收回", () => {
  test("middle pane docks back to the main window and follows disk changes while detached", async () => {
    const { config, liveFile } = await prepareWorkspaceWithLiveFile();
    const electronApp = await launchLawMindElectron(config);

    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);

      await page.getByTestId("lm-tab-workspace").click();
      await expect(page.getByTestId("lm-chat-drop-zone")).toBeVisible({ timeout: 30_000 });
      await openWorkspaceFile(page, "notes/live.md");

      // 拆出中栏：抓手要真的存在，点完要开一个独立 BrowserWindow。
      const grip = page.locator('[data-testid="lm-pane-detach-grip-middle"]');
      await expect(grip).toBeVisible({ timeout: 30_000 });
      const auxPagePromise = electronApp.waitForEvent("window", { timeout: 60_000 });
      await grip.click();
      const aux = await auxPagePromise;
      await expect(aux.locator('[data-testid="lm-pane-window-bar"]')).toBeVisible({
        timeout: 60_000,
      });
      await expect(aux.locator(".lm-editor-pane").first()).toContainText("LM-LIVE-001", {
        timeout: 60_000,
      });

      // 独立窗打开期间改盘（对话里的工具就是这样写文件的）：等 1.5s 轮询接管。
      await fs.writeFile(liveFile, "# 实时\n\n对话改动 LM-LIVE-002\n", "utf8");
      await expect(aux.locator(".lm-editor-pane").first()).toContainText("LM-LIVE-002", {
        timeout: 20_000,
      });

      // 收回主窗口：独立窗关闭，中栏回到主窗口。
      await aux.getByRole("button", { name: "收回主窗口" }).click();
      await expect
        .poll(() => aux.isClosed(), { timeout: 20_000, message: "收回主窗口应关闭独立窗" })
        .toBe(true);
      await expect(page.locator('[data-testid="lm-pane-detach-grip-middle"]')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator(".lm-editor-pane").first()).toContainText("LM-LIVE-002");

      // 对话列同样能拆出并收回。
      const chatGrip = page.locator('[data-testid="lm-pane-detach-grip-chat"]');
      await expect(chatGrip).toBeVisible({ timeout: 20_000 });
      const chatAuxPromise = electronApp.waitForEvent("window", { timeout: 60_000 });
      await chatGrip.click();
      const chatAux = await chatAuxPromise;
      await expect(chatAux.locator('[data-testid="lm-pane-window-bar"]')).toBeVisible({
        timeout: 60_000,
      });
      await chatAux.getByRole("button", { name: "收回主窗口" }).click();
      await expect
        .poll(() => chatAux.isClosed(), { timeout: 20_000, message: "对话窗也应能收回" })
        .toBe(true);
      await expect(page.getByTestId("lm-chat-drop-zone")).toBeVisible({ timeout: 20_000 });
    } finally {
      await electronApp.close();
    }
  });

  test("a file tab dragged out comes back when the aux window closes", async () => {
    const { config } = await prepareWorkspaceWithLiveFile();
    const electronApp = await launchLawMindElectron(config);

    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);

      await page.getByTestId("lm-tab-workspace").click();
      await expect(page.getByTestId("lm-chat-drop-zone")).toBeVisible({ timeout: 30_000 });
      await openWorkspaceFile(page, "notes/live.md");

      const tab = page.locator(".lm-file-tab", { hasText: "live" }).first();
      const box = await tab.boundingBox();
      expect(box).not.toBeNull();
      if (!box) {
        return;
      }
      const auxPagePromise = electronApp.waitForEvent("window", { timeout: 60_000 });
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 4 });
      await page.mouse.up();

      const aux = await auxPagePromise;
      await expect(aux.locator('[data-testid="lm-pane-window-bar"]')).toBeVisible({
        timeout: 60_000,
      });
      await expect(aux.locator(".lm-editor-pane").first()).toContainText("LM-LIVE-001", {
        timeout: 60_000,
      });
      // 标签被移到独立窗，主窗口不再留着同一份。
      await expect(page.locator(".lm-file-tab", { hasText: "live" })).toHaveCount(0, {
        timeout: 20_000,
      });

      await aux.getByRole("button", { name: "收回主窗口" }).click();
      await expect
        .poll(() => aux.isClosed(), { timeout: 20_000, message: "独立窗应关闭" })
        .toBe(true);
      // 关窗后标签回到主窗口，文件内容仍在。
      await expect(page.locator(".lm-file-tab", { hasText: "live" }).first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator(".lm-editor-pane").first()).toContainText("LM-LIVE-001", {
        timeout: 20_000,
      });
    } finally {
      await electronApp.close();
    }
  });

  test("a detached draft desk follows a draft changed in another window", async () => {
    const config = await prepareRealpathConfig();
    const electronApp = await launchLawMindElectron(config);

    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);

      await page.getByTestId("lm-tab-workspace").click();
      await expect(page.getByTestId("lm-chat-drop-zone")).toBeVisible({ timeout: 30_000 });
      await openDraftDesk(page, "e2e-draft-1");
      await expect(page.getByTestId("lm-middle-draft-desk")).toContainText(
        "E2E Electron draft",
        { timeout: 30_000 },
      );

      const grip = page.locator('[data-testid="lm-pane-detach-grip-middle"]');
      await expect(grip).toBeVisible({ timeout: 30_000 });
      const auxPagePromise = electronApp.waitForEvent("window", { timeout: 60_000 });
      await grip.click();
      const aux = await auxPagePromise;
      await expect(aux.getByTestId("lm-middle-draft-desk")).toBeVisible({ timeout: 60_000 });
      await expect(aux.getByTestId("lm-middle-draft-desk")).toContainText(
        "E2E Electron draft",
        { timeout: 60_000 },
      );

      // 从「另一个窗口」改草稿（对话修订落盘的等价物）：独立窗应自己醒过来。
      const renderer = await getRendererConfig(page);
      const patched = await page.request.patch(
        `${renderer.apiBase}/api/drafts/e2e-draft-1/content`,
        {
          headers: { authorization: `Bearer ${renderer.apiAuthToken}` },
          data: { title: "E2E draft 外部改动 LM-DRAFT-002" },
        },
      );
      expect(patched.ok()).toBeTruthy();

      await expect(aux.getByTestId("lm-middle-draft-desk")).toContainText("LM-DRAFT-002", {
        timeout: 20_000,
      });
    } finally {
      await electronApp.close();
    }
  });
});
