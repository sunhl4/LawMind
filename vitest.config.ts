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
      "apps/lawmind-desktop/src/**/*.test.tsx",
      "apps/lawmind-desktop/electron/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/release/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: [
        "src/lawmind/**/*.ts",
        "apps/lawmind-desktop/server/**/*.ts",
        "apps/lawmind-desktop/src/renderer/**/*.ts",
        "apps/lawmind-desktop/src/renderer/**/*.tsx",
      ],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/index.ts", "**/types.ts"],
      // 覆盖率地板只有一处：scripts/pre-commit/coverage-baseline.json +
      // scripts/pre-commit/check-coverage-ratchet.mjs（带 tolerancePct 与 --update）。
      // 这里原先另有一个 thresholds.statements: 40，低于棘轮地板 48，永远不可能先触发，
      // 只会让人误读真实门槛——已删除，避免同一策略两个数字。
    },
  },
});
