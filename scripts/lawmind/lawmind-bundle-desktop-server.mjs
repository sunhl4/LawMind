#!/usr/bin/env node
/**
 * Bundle LawMind desktop local server with workspace-local esbuild (pnpm devDependency).
 * Uses the JS API — do not spawn `bin/esbuild` via `node` (that path is a native binary).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outfile = path.join(repoRoot, "apps/lawmind-desktop/server/dist/lawmind-local-server.cjs");
const entry = path.join(repoRoot, "apps/lawmind-desktop/server/lawmind-local-server.ts");
const childOutfile = path.join(
  repoRoot,
  "apps/lawmind-desktop/server/dist/analysis-sandbox-child.cjs",
);
const childEntry = path.join(repoRoot, "src/lawmind/agent/tools/legal/analysis-sandbox-child.ts");

/**
 * ⚠️ **CJS 里 `import.meta` 是空对象**，必须显式定义 `import.meta.url`。
 *
 * esbuild 打 CJS 时会把 `import.meta` 编译成 `var import_meta = {}`，于是
 * `import_meta.url` 是 `undefined`；而引擎里有 7 处非测试代码靠它定位自己：
 *   - `skills/ensure-builtin-skill-seeds.ts` → `<自身目录>/builtin`（**服务启动必经**）
 *   - `skills/lawyer-capabilities.ts` → `<自身目录>/builtin/<id>.md`
 *   - `runtime/tool-sandbox.ts` / `agent/tools/legal/analysis-runner.ts` → 沙箱子进程
 *   - `evaluation/shadow-replay.ts` → `fixtures/shadow`
 *   - `evaluation/{true-manuscript-gate,human-baseline}.ts` → 仓库根（CLI 用）
 *
 * 实测后果：**打包版本地服务在启动时即崩**（`fileURLToPath(undefined)` →
 * `ERR_INVALID_ARG_TYPE`），于是整个应用「无法连接本地服务」——而这在开发态与 CI 里
 * **完全看不见**，因为开发态走 TS（`import.meta` 正常），CI 的 electron 作业也是
 * **未打包**运行（`getBundledServerScript()` 只在 `app.isPackaged` 时返回该包）。
 *
 * 定义成基于 `__filename` 的真实 file URL 后，上述 7 处一律解析到**包文件所在目录**，
 * 与开发态的语义一致（「我旁边有什么」）。配套：`electron-builder` 的 extraResources
 * 必须把 `src/lawmind/skills/builtin` 投放到 `lawmind-server/builtin`，否则目录对了、文件不在。
 */
/**
 * esbuild 的 `define` 只接受 JS 字面量或标识符，不能是表达式；
 * 所以用 banner 先声明一个常量，再把 `import.meta.url` 指向它。
 */
const MODULE_URL_ID = "__lawmindModuleUrl";
const cjsImportMetaUrlShim = {
  define: { "import.meta.url": MODULE_URL_ID },
  banner: { js: `const ${MODULE_URL_ID} = require("node:url").pathToFileURL(__filename).href;` },
};

fs.mkdirSync(path.dirname(outfile), { recursive: true });

try {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile,
    ...cjsImportMetaUrlShim,
  });
  await esbuild.build({
    entryPoints: [childEntry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: childOutfile,
    ...cjsImportMetaUrlShim,
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
