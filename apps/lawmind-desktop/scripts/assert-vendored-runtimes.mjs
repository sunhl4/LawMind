#!/usr/bin/env node
/**
 * 打包前的 preflight：确认**目标架构**的 Node 运行时与 OfficeCLI 真的在
 * `resources/` 里，并且二进制架构与目标一致。
 *
 * 为什么需要它：electron-builder 的 `extraResources` 在 `from` 目录不存在时只打一行
 * `file source doesn't exist` 的 **warn**（`app-builder-lib/out/fileMatcher.js`），
 * 然后照样出包。结果就是安装包能装、能打开，但一启动本地 API 就 spawn 不到 node——
 * 这类问题在打包日志里看不出来，只有用户装上才发现。所以这里把 warn 变成硬失败。
 *
 * 用法：
 *   node scripts/assert-vendored-runtimes.mjs                     # 本机架构
 *   node scripts/assert-vendored-runtimes.mjs --arch arm64,x64    # 双架构包
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, "..");

/** Mach-O cputype → electron-builder 的 arch 名。 */
const MACHO_CPUTYPE = { 0x0100000c: "arm64", 0x01000007: "x64" };

export function parseArchList(raw) {
  const list = String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length === 0) {
    return [process.arch];
  }
  for (const arch of list) {
    if (!["arm64", "x64"].includes(arch)) {
      throw new Error(`不支持的架构：${arch}（仅支持 arm64 / x64）`);
    }
  }
  return [...new Set(list)];
}

/**
 * 只读 Mach-O 头判断真实架构；不是 Mach-O（或读不到头）时返回空串，
 * 交给「文件存在 + 体积」这一层的检查。
 */
export function readMachOArch(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(8);
    const read = fs.readSync(fd, header, 0, header.length, 0);
    if (read < 8) {
      return "";
    }
    // 0xFEEDFACF：64 位小端 Mach-O（macOS arm64/x64 都是这个）
    if (header.readUInt32LE(0) !== 0xfeedfacf) {
      return "";
    }
    return MACHO_CPUTYPE[header.readUInt32LE(4)] ?? "";
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

export function runtimePaths({ platform = process.platform, arch, desktopRoot = DESKTOP_ROOT }) {
  const key = `${platform}-${arch}`;
  const isWin = platform === "win32";
  return {
    key,
    nodeBin: path.join(desktopRoot, "resources", "node-runtime", key, isWin ? "node.exe" : "bin/node"),
    officecliBin: path.join(
      desktopRoot,
      "resources",
      "officecli",
      key,
      isWin ? "officecli.exe" : "officecli",
    ),
  };
}

/**
 * @returns {{ok: boolean, problems: string[], checked: {key: string, nodeBin: string, officecliBin: string}[]}}
 */
export function assertVendoredRuntimes({
  archList,
  platform = process.platform,
  desktopRoot = DESKTOP_ROOT,
  statFile = (file) => fs.statSync(file),
  detectArch = readMachOArch,
} = {}) {
  const problems = [];
  const checked = [];
  for (const arch of archList) {
    const paths = runtimePaths({ platform, arch, desktopRoot });
    checked.push(paths);
    for (const [label, file, fix] of [
      ["node 运行时", paths.nodeBin, `pnpm vendor:node --arch ${arch}`],
      ["officecli", paths.officecliBin, `pnpm vendor:officecli --arch ${arch}`],
    ]) {
      let stat;
      try {
        stat = statFile(file);
      } catch {
        problems.push(
          `缺 ${label}（${paths.key}）：${path.relative(desktopRoot, file)} 不存在 —— 先跑 \`${fix}\``,
        );
        continue;
      }
      if (!stat.isFile() || stat.size < 1024) {
        problems.push(`${label} 不是有效文件（${paths.key}）：${path.relative(desktopRoot, file)}`);
        continue;
      }
      const actual = detectArch(file);
      if (actual && actual !== arch) {
        problems.push(
          `${label} 架构不符（${paths.key}）：文件是 ${actual}，目标是 ${arch} —— 先跑 \`${fix}\``,
        );
      }
    }
  }
  return { ok: problems.length === 0, problems, checked };
}

function parseArgs(argv) {
  const out = { arch: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--arch") {
      out.arch = argv[++i] ?? "";
    } else if (a.startsWith("--arch=")) {
      out.arch = a.slice("--arch=".length);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const archList = parseArchList(args.arch || process.env.LAWMIND_DESKTOP_ARCH);
  const result = assertVendoredRuntimes({ archList });
  if (!result.ok) {
    process.stderr.write("✗ 打包前检查失败：内嵌运行时与目标架构不一致\n");
    for (const problem of result.problems) {
      process.stderr.write(`  - ${problem}\n`);
    }
    process.stderr.write(
      "  说明：electron-builder 在 extraResources 的 from 不存在时只 warn 不报错，\n" +
        "  这里提前失败，避免发出一个「能装能开、但本地 API 起不来」的安装包。\n",
    );
    process.exit(1);
  }
  for (const item of result.checked) {
    process.stdout.write(`✓ 内嵌运行时就绪：${item.key}\n`);
  }
}

const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
