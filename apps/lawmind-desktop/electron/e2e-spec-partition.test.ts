/**
 * E2E 套件分区的准入测试。
 *
 * 锁的是一个**容易悄悄复发**的坑：`apps/lawmind-desktop/e2e/` 下有两套互斥的 Playwright 配置，
 * 而 `pnpm lawmind:desktop:e2e`（无参数）是 mock/浏览器配置，CI 的 `lawmind-desktop-e2e`
 * mock 作业正是无参数调用它。真机 Electron spec 混进去的下场不是「跳过」，是**整个作业变红**，
 * 且红得与 PR 改动无关 —— 排障成本全落在无关的人身上。
 *
 * 三条断言，各自对应一个必须成立的性质：
 *   1. 「谁是真机 spec」由**磁盘事实**判定（是否 import `helpers/app-driver`），
 *      清单只是它的抄本 —— 抄本漏了新 spec 就红（而不是让 CI 去发现）；
 *   2. mock 配置必须排除全部真机 spec（漏一个，`pnpm lawmind:desktop:e2e` 就是坏的）；
 *   3. electron 配置必须包含全部真机 spec、且不含别的（既不漏跑，也不误收浏览器 spec）。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELECTRON_SPEC_FILES, ELECTRON_SPEC_GLOBS } from "../e2e/electron-specs";
import mockConfig from "../playwright.config";
import electronConfig from "../playwright.electron.config";

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eDir = path.resolve(here, "../e2e");
const desktopDir = path.resolve(here, "..");

/**
 * 真机 spec 的判定依据：它必须拉起真实 Electron。三种写法都算 ——
 * `helpers/app-driver`（封装过的入口）、`_electron`（直接 `electron.launch`）、
 * `electron-fixture.mjs`（userData 夹具）。
 */
const ELECTRON_LAUNCH_MARKERS = /helpers\/app-driver|_electron|electron-fixture/;

async function listSpecFiles(): Promise<string[]> {
  const entries = await fs.readdir(e2eDir);
  return entries.filter((name) => name.endsWith(".spec.ts")).toSorted();
}

async function readsLaunchMarkers(file: string): Promise<boolean> {
  const text = await fs.readFile(path.join(e2eDir, file), "utf8");
  return ELECTRON_LAUNCH_MARKERS.test(text);
}

describe("E2E 套件分区（mock/浏览器 与 真机 Electron 互斥）", () => {
  it("清单与磁盘一致：拉起真机 Electron 的 spec 就是真机 spec，不多不少", async () => {
    const specs = await listSpecFiles();
    const actual: string[] = [];
    for (const file of specs) {
      if (await readsLaunchMarkers(file)) {
        actual.push(file);
      }
    }
    expect(actual).toEqual([...ELECTRON_SPEC_FILES].toSorted());
  });

  it("清单里的文件都真实存在（防止改名后留下幽灵条目）", async () => {
    const specs = await listSpecFiles();
    for (const file of ELECTRON_SPEC_FILES) {
      expect(specs).toContain(file);
    }
  });

  it("mock/浏览器配置排除全部真机 spec —— 否则 `pnpm lawmind:desktop:e2e` 会红", () => {
    const ignore = (mockConfig.testIgnore ?? []) as string[];
    for (const glob of ELECTRON_SPEC_GLOBS) {
      expect(ignore).toContain(glob);
    }
  });

  it("electron 配置包含全部真机 spec —— 否则真机路径无人跑", () => {
    const match = (electronConfig.testMatch ?? []) as string[];
    for (const file of ELECTRON_SPEC_FILES) {
      expect(match).toContain(file);
    }
    expect([...match].toSorted()).toEqual([...ELECTRON_SPEC_FILES].toSorted());
  });

  it("两套配置指向同一个 e2e 目录（否则排除清单的语义就变了）", () => {
    expect(mockConfig.testDir).toBe(path.join(desktopDir, "e2e"));
    expect(electronConfig.testDir).toBe(path.join(desktopDir, "e2e"));
  });

  /**
   * **分区必须穷尽且不相交**（没有 spec 会「两边都不跑」）。
   *
   * 这条是本文件最重要的一条，因为「两边都不跑」是**静默**的：
   * 没有人会注意到某个 spec 从此再也不执行 —— 它不会红，只会消失。
   * 触发方式很平常：往 mock 的 `testIgnore` 里加一个 glob（比如因为它在浏览器下不稳），
   * 但忘了把它加进 electron 的 `testMatch`。
   *
   * 断言的是一个**等价关系**（不是「包含于」）：
   *
   * ```text
   * 被 mock 排除（且不是刻意的 _debug）  ⟺  在真机清单里
   * ```
   *
   * 两侧任一方向被破坏都会红：
   *   - 加进 ignore 但没进 electron 清单 → 左边真、右边假 → 该 spec 永不执行；
   *   - 进了 electron 清单但没进 ignore → 左边假、右边真 → mock 套件会跑真机 spec 而变红。
   */
  it("分区穷尽且不相交：每个 spec 要么在 mock 套件里，要么在真机清单里（无「两边都不跑」）", async () => {
    const specs = await listSpecFiles();
    const ignore = (mockConfig.testIgnore ?? []) as string[];
    /**
     * 「刻意排除、两边都不跑」的 glob ——按**实际模式**识别（`_debug-` 前缀），
     * **不能**写成「ignore 里所有非真机项」。
     *
     * 后者是第一版的写法，变异验证抓到它是**假阴性**：往 ignore 里加一个新 glob
     * （本该被判为「覆盖空洞」）时，它会被误归为「刻意排除的 debug」，于是漏洞照样通过。
     * 守卫的判据必须来自**模式本身**，而不是「推导出来的补集」。
     */
    const debugGlobs = ignore.filter((g) => /_debug-/.test(g));
    const electronGlobs = ELECTRON_SPEC_GLOBS as readonly string[];

    // 极简 glob 匹配 —— 本配置的 ignore 只有两种形状：
    //   - 双星斜杠 + 文件名（精确文件名）
    //   - 双星斜杠 + _debug- + 通配 + .spec.ts（前缀 / 后缀）
    // 所以按这两种形状直接判，不用通用正则转义（那行转义既脆又难读，lint 也会误判）。
    //
    // 注：这里**必须**用 // 注释而不能用块注释 —— glob 里的「星 星 斜杠」组合含有
    // 块注释的结束符，会把注释提前闭合，后面的内容被当代码解析
    // （实测报错：Unterminated regular expression / Invalid Character）。
    const matches = (globs: readonly string[], file: string): boolean =>
      globs.some((g) => {
        const pattern = g.replace(/^\*\*\//, "");
        if (!pattern.includes("*")) {
          return pattern === file;
        }
        const [head = "", tail = ""] = pattern.split("*");
        return file.startsWith(head) && file.endsWith(tail);
      });

    const holes: string[] = [];
    const doubles: string[] = [];
    for (const file of specs) {
      const ignoredByMock = matches(ignore, file);
      const deliberateDebug = matches(debugGlobs, file);
      const isElectron = matches(electronGlobs, file);
      // 被排除、且不是刻意排除的 debug → 必须真的是真机 spec
      if (ignoredByMock && !deliberateDebug && !isElectron) {
        holes.push(file);
      }
      // 是真机 spec 却不被 mock 排除 → mock 套件会跑它并变红
      if (isElectron && !ignoredByMock) {
        doubles.push(file);
      }
    }
    expect(holes, "这些 spec 被 mock 排除、却不是真机 spec → 两边都不跑（静默消失）").toEqual([]);
    expect(doubles, "这些真机 spec 没被 mock 排除 → `pnpm lawmind:desktop:e2e`（CI mock 作业）会红").toEqual(
      [],
    );
  });
});
