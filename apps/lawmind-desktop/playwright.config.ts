import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockPort = process.env.LAWMIND_E2E_MOCK_PORT ?? "48888";
const viteRoot = path.resolve(__dirname, ".");
/** Dedicated port so E2E does not reuse a stray `vite dev` on 5174 without `e2e` mode. */
const e2eVitePort = process.env.LAWMIND_E2E_VITE_PORT ?? "52473";

export default defineConfig({
  testDir: path.join(__dirname, "e2e"),
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
