import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { ELECTRON_SPEC_GLOBS } from "./e2e/electron-specs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockPort = process.env.LAWMIND_E2E_MOCK_PORT ?? "48888";
const viteRoot = path.resolve(__dirname, ".");
/** Dedicated port so E2E does not reuse a stray `vite dev` on 5174 without `e2e` mode. */
const e2eVitePort = process.env.LAWMIND_E2E_VITE_PORT ?? "52473";
/**
 * 逃生阀：用机器上已装的 Chrome 跑这套，而不是 Playwright 钉住的 chromium 版本。
 *
 * 为什么需要它：`npx playwright install chromium` 要在有网环境下载对应版本；下不到时
 * 报的是 `Executable doesn't exist at …/chromium_headless_shell-1243/…` —— 这条报错
 * **看起来像用例坏了**，实际是环境缺浏览器，很容易排错排到错误方向。
 *
 * 用法：`LAWMIND_E2E_CHANNEL=chrome pnpm --filter lawmind-desktop test:e2e`
 *
 * 默认（不设）= 走 Playwright 自带 chromium，CI 行为**不变**（CI 里有
 * `playwright install chromium --with-deps`，不需要这个阀）。
 */
const browserChannel = process.env.LAWMIND_E2E_CHANNEL?.trim();

export default defineConfig({
  testDir: path.join(__dirname, "e2e"),
  /**
   * Local debug harness — never run in CI / default suite.
   *
   * 真机 Electron spec 全部排除，理由：它们起**真实 Electron + 真实本地服务**，
   * 需要先 `lawmind:bundle:desktop-server` + `build:renderer`（见
   * `.github/workflows/lawmind-desktop-e2e.yml` 的 electron 作业），
   * 而这套是 mock API + Vite 的浏览器套件。
   *
   * 这一条不是可有可无的洁癖：`pnpm lawmind:desktop:e2e`（无参数）就是本配置，
   * 而 CI 的 `lawmind-desktop-e2e` mock 作业正是无参数调它 —— 少了这条排除，
   * 该作业会扫进真机 spec 并整体变红，且红的原因与 PR 改动无关。
   * 清单来源见 `e2e/electron-specs.ts`（与 electron 配置共用，防漂移）。
   */
  testIgnore: ["**/_debug-*.spec.ts", ...ELECTRON_SPEC_GLOBS],
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${e2eVitePort}`,
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
    ...(browserChannel ? { channel: browserChannel } : {}),
  },
  webServer: {
    command: `bash ${path.join(__dirname, "e2e/dev-with-mock.sh")}`,
    url: `http://127.0.0.1:${e2eVitePort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: viteRoot,
    env: {
      ...process.env,
      LAWMIND_E2E_MOCK_PORT: mockPort,
      LAWMIND_E2E_VITE_PORT: e2eVitePort,
    },
  },
});
