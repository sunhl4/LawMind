import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Electron golden path — requires `pnpm build:renderer` + bundled server beforehand. */
export default defineConfig({
  testDir: path.join(__dirname, "e2e"),
  testMatch: "electron-golden-path.spec.ts",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
});
