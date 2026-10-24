import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 测试收集前补齐**不入库的生成物**。
 *
 * 背景：`apps/lawmind-desktop/src/renderer/canvas/sandbox-runtime.js` 是
 * `scripts/build-canvas-sandbox.mjs` 的 esbuild 产物，按 `.gitignore` 不入库
 * （795 KB 的打包结果，真相源是 `canvas/sandbox-entry.ts`）。但
 * `CanvasFileView.tsx` 里有 `import sandboxRuntime from "./sandbox-runtime.js?raw"`，
 * 于是任何**传递**引到 CanvasFileView 的测试文件，在全新克隆 / CI 上都会以
 *
 *   Error: Failed to resolve import "./sandbox-runtime.js?raw" ... Does the file exist?
 *
 * 在**收集阶段**直接炸掉（不是断言失败，是 0 test 的 Failed Suite）。本机因为跑过
 * `pnpm lawmind:desktop` 已经有这个文件，所以一直是绿的——这类「本机能过、CI 全红」
 * 的差异最容易反复回潮，把补生成物这一步固定到测试入口比在 workflow 里单点加一步更稳。
 *
 * 只在缺失时构建：不覆盖开发者已构建的产物，也不拖慢常规测试。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const sandboxRuntime = path.join(
  repoRoot,
  "apps/lawmind-desktop/src/renderer/canvas/sandbox-runtime.js",
);
const buildScript = path.join(repoRoot, "apps/lawmind-desktop/scripts/build-canvas-sandbox.mjs");

export default function setup() {
  if (fs.existsSync(sandboxRuntime)) {
    return;
  }
  execFileSync(process.execPath, [buildScript], { cwd: repoRoot, stdio: "inherit" });
  if (!fs.existsSync(sandboxRuntime)) {
    throw new Error(
      `[lawmind-test] 画布 sandbox 运行时仍未生成：${sandboxRuntime}（脚本：${buildScript}）`,
    );
  }
}
