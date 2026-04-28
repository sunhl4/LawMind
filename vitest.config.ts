import os from "node:os";
import { defineConfig } from "vitest/config";

const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const isWindows = process.platform === "win32";
const localWorkers = Math.max(2, Math.min(8, os.cpus().length));
const ciWorkers = isWindows ? 2 : 3;

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: isWindows ? 180_000 : 120_000,
    unstubEnvs: true,
    unstubGlobals: true,
    pool: "forks",
    maxWorkers: isCI ? ciWorkers : localWorkers,
    setupFiles: ["test/lawmind-setup.ts"],
    include: [
      "src/lawmind/**/*.test.ts",
      "apps/lawmind-desktop/server/**/*.test.ts",
      "apps/lawmind-desktop/src/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/release/**"],
  },
});
