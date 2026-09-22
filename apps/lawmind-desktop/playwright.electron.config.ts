import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { ELECTRON_SPEC_FILES } from "./e2e/electron-specs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Electron golden path — requires `pnpm build:renderer` + bundled server beforehand. */
export default defineConfig({
  testDir: path.join(__dirname, "e2e"),
  /**
   * 清单在 `e2e/electron-specs.ts` —— 与 mock 配置的 `testIgnore` 共用一份，
   * 两边不会漂移（漂移的后果见该文件注释）。
   */
  testMatch: [...ELECTRON_SPEC_FILES],
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
});
