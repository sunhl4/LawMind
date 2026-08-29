import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import { bootstrapE2ePage } from "./e2e-helpers";
import { prepareElectronE2EUserData } from "./electron-fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

test.describe("Electron 文件深链", () => {
  test("deep-link event opens workspace file in editor (pending consume)", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareElectronE2EUserData();
    // macOS 上 os.tmpdir() 位于 /var（→/private/var 符号链接）：
    // fs-bridge 的 realpath 校验会把 /var/... 解析为 /private/var/... 而判定「symlink escapes root」。
    // 因此把 desktop-config 与种子文件统一改写到 realpath 后的工作区。
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await fs.mkdir(path.join(workspaceDir, "cases", "e2e-matter-1", "notes"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspaceDir, "cases", "e2e-matter-1", "notes", "案情笔记.md"),
      "# 案情笔记\n\n深链验收标记 LM-DEEPLINK-001\n",
      "utf8",
    );

    const electronApp = await electron.launch({
      args: [path.join(desktopRoot, "electron/main.mjs"), `--user-data-dir=${userDataDir}`],
      cwd: desktopRoot,
      env: { ...process.env, LAWMIND_E2E: "1", LAWMIND_SKIP_AUTO_UPDATE: "1" },
      timeout: 120_000,
    });

    try {
      const window = await electronApp.firstWindow();
      await expect(window.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(window);
      await expect(
        window.locator(".lm-files-explorer, .lm-side-explorer-host .lm-files-explorer").first(),
      ).toBeVisible({ timeout: 60_000 });

      // 与交办结果「打开附件」同链路：派发深链事件 → FileWorkbench 消费并打开文件。
      await window.evaluate(() => {
        void window.dispatchEvent(
          new CustomEvent("lawmind:open-workspace-file", {
            detail: { relPath: "cases/e2e-matter-1/notes/案情笔记.md" },
          }),
        );
      });

      await expect(
        window.locator(".lm-file-tab", { hasText: "案情笔记" }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(window.locator(".lm-editor-pane").first()).toContainText("LM-DEEPLINK-001", {
        timeout: 30_000,
      });
    } finally {
      await electronApp.close();
    }
  });
});
