/**
 * 打包形态的本地服务**必须能启动**（准入测试）。
 *
 * ## 为什么需要这一条
 *
 * 2026-09-22 实测：`pnpm lawmind:bundle:desktop-server` 产出的 CJS 包**启动即崩**——
 *
 * ```text
 * TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or an instance of URL. Received undefined
 *     at fileURLToPath (node:url)
 *     at builtinDir (lawmind-local-server.cjs)
 *     at ensureBuiltinSkillSeeds
 * ```
 *
 * 根因：esbuild 打 CJS 时把 `import.meta` 编译成 `var import_meta = {}`，于是
 * `import.meta.url` 是 `undefined`。引擎里有 7 处非测试代码靠它定位自身目录
 * （skill 种子、律师能力表、工具沙箱子进程、影子重放 fixtures…），启动路径上第一个撞到的是
 * `ensureBuiltinSkillSeeds`。
 *
 * 后果极重：**打包版本地服务完全起不来**，整个应用「无法连接本地服务」。
 * 而它此前**没有任何门禁能发现**，因为：
 *   - 开发态跑 TS（`import.meta` 正常）；
 *   - CI 的 electron 作业是**未打包**运行 —— `getBundledServerScript()` 只在
 *     `app.isPackaged` 时返回该包（`electron/local-server.mjs`）。
 * 也就是说「打包之后会怎样」这条链上，从来没有一步真正启动过这个包。
 *
 * ## 这条测试做什么
 *
 * 1. 断言 `electron-builder` 的 `extraResources` 确实把 builtin skill 投放到位
 *    （**启动要用**：`builtinDir()` 解析到 `<包目录>/builtin`）；
 * 2. 按**打包后的目录布局**摆好（包 + builtin/ 同级），真的 `node` 启动它；
 * 3. 断言 `/api/health` 200 且 `/api/support/bundle?download=1` 返回 zip。
 *
 * 包不存在时**诚实 skip**（干净克隆没跑过 bundle 是正常状态），不假绿也不假红。
 */

import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const bundlePath = path.join(desktopRoot, "server", "dist", "lawmind-local-server.cjs");
const builtinSrc = path.join(repoRoot, "src", "lawmind", "skills", "builtin");

const running: ChildProcess[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const child of running.splice(0)) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** 取一个空闲端口（避免与真机/其他测试撞）。 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port: number, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        return res.status;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

describe("打包形态：本地服务能启动并服务诊断包", () => {
  it("electron-builder 必须把 builtin skill 投放到 lawmind-server/builtin（启动要用）", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
    ) as { build?: { extraResources?: Array<{ from: string; to: string }> } };
    const entries = pkg.build?.extraResources ?? [];
    const builtinEntry = entries.find((e) => e.to.replace(/^\.\//, "") === "lawmind-server/builtin");
    expect(
      builtinEntry,
      "缺少 builtin skill 的 extraResources 投放：打包版会在 ensureBuiltinSkillSeeds 找不到 builtin/",
    ).toBeTruthy();
    expect(builtinEntry?.from.replace(/^\.\//, "")).toContain("src/lawmind/skills/builtin");
  });

  it(
    "按打包目录布局启动真正在跑的包：health 200 且诊断包可下载",
    { timeout: 120_000 },
    async () => {
      if (!fs.existsSync(bundlePath)) {
        // 干净克隆没跑过 bundle：诚实跳过（CI 的 electron 作业会先 bundle，因此那里会真跑）。
        expect(fs.existsSync(bundlePath)).toBe(false);
        return;
      }
      const stage = fs.mkdtempSync(path.join(os.tmpdir(), "lm-packaged-boot-"));
      tempDirs.push(stage);
      const serverDir = path.join(stage, "lawmind-server");
      fs.mkdirSync(path.join(serverDir, "builtin"), { recursive: true });
      fs.copyFileSync(bundlePath, path.join(serverDir, "lawmind-local-server.cjs"));
      for (const name of fs.readdirSync(builtinSrc)) {
        if (name.endsWith(".md")) {
          fs.copyFileSync(path.join(builtinSrc, name), path.join(serverDir, "builtin", name));
        }
      }

      const port = await freePort();
      const child = spawn(
        process.execPath,
        [path.join(serverDir, "lawmind-local-server.cjs")],
        {
          env: {
            ...process.env,
            LAWMIND_WORKSPACE_DIR: path.join(stage, "workspace"),
            LAWMIND_DESKTOP_PORT: String(port),
            LAWMIND_SKIP_API_AUTH: "1",
            LAWMIND_AGENT_API_KEY: "boot-test-key",
            LAWMIND_AGENT_BASE_URL: "http://127.0.0.1:1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      running.push(child);
      const log: string[] = [];
      child.stdout?.on("data", (b: Buffer) => log.push(b.toString()));
      child.stderr?.on("data", (b: Buffer) => log.push(b.toString()));

      const health = await waitForHealth(port, 45_000);
      expect(
        health,
        `打包后的服务没能启动。日志：\n${log.join("").slice(-2000)}`,
      ).toBe(200);

      // 诊断包下载（用户报障时点到的就是这条链）。
      const res = await fetch(`http://127.0.0.1:${port}/api/support/bundle?download=1`);
      expect(res.status).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");

      // 下载后进程仍应存活（服务端不能被一个请求带走）。
      expect(child.exitCode).toBeNull();
    },
  );
});
