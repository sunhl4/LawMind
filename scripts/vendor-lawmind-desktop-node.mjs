#!/usr/bin/env node
/**
 * lawmind:vendor:desktop-node — 把一个可独立运行的 Node.js 二进制 vendoring 到
 * `apps/lawmind-desktop/resources/node-runtime/<platform-arch>/`，供打包后的 Electron
 * 应用 spawn 出来跑本地服务器（Electron 自带 node 不能直接当 `node` 子进程用）。
 *
 * 产物布局（与 electron/local-server.mjs 的 resolveNodeExecutable 对齐）：
 *   unix:  resources/node-runtime/<key>/bin/node
 *   win:   resources/node-runtime/<key>/node.exe
 * 其中 <key> = `${process.platform}-${process.arch}`（如 darwin-arm64 / win32-x64）。
 *
 * 默认从官方 nodejs.org/dist 下载与当前构建机相同版本的官方独立构建（自带 libnode，
 * 不依赖 Homebrew 等带共享 dylib 的安装）。也可用 `--node /path/to/node` 直接复制一个
 * 本地独立二进制（离线/内网构建用）。
 *
 * 用法：
 *   node scripts/vendor-lawmind-desktop-node.mjs                 # 下载当前版本官方构建
 *   node scripts/vendor-lawmind-desktop-node.mjs --node-version 22.11.0
 *   node scripts/vendor-lawmind-desktop-node.mjs --node /path/to/standalone-node
 *   node scripts/vendor-lawmind-desktop-node.mjs --clean
 *
 * 幂等：目标已存在且 `--version` 与期望一致则跳过。输出目录已被 .gitignore 排除。
 */
import { spawnSync } from "node:child_process";
import { createGunzip } from "node:zlib";
import { createWriteStream, readFileSync } from "node:fs";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const RUNTIME_ROOT = path.join(REPO_ROOT, "apps", "lawmind-desktop", "resources", "node-runtime");

function parseArgs(argv) {
  const out = { nodeBin: "", nodeVersion: "", clean: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--node") out.nodeBin = argv[++i] ?? "";
    else if (a === "--node-version") out.nodeVersion = argv[++i] ?? "";
    else if (a === "--clean") out.clean = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function nodeVersionOf(binPath) {
  const r = spawnSync(binPath, ["--version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    throw new Error(
      `无法执行 ${binPath} --version${r.error ? `：${r.error.message}` : r.stderr ? `：${r.stderr}` : ""}`,
    );
  }
  return r.stdout.trim();
}

function mapDistArch(arch) {
  if (arch === "x64" || arch === "arm64" || arch === "armv7l") return arch;
  if (arch === "ia32") return "x86";
  throw new Error(`不支持的架构：${arch}（仅支持 x64 / arm64 / armv7l）`);
}

function distPlatformName(platform) {
  if (platform === "darwin") return "darwin";
  if (platform === "linux") return "linux";
  if (platform === "win32") return "win";
  throw new Error(`不支持的平台：${platform}`);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "lawmind-vendor" } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        res.resume();
        downloadFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下载失败 HTTP ${res.statusCode}：${url}`));
        return;
      }
      const stream = createWriteStream(dest);
      res.pipe(stream);
      stream.on("finish", () => stream.close(resolve));
      stream.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(120_000, () => req.destroy(new Error("下载超时")));
  });
}

/** 用系统 tar 解压（macOS/Linux/Win10+ 均自带 bsdtar/gnu tar）。 */
function extractArchive(archivePath, destDir, isZip) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = spawnSync("tar", ["-xf", archivePath, "-C", destDir], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    throw new Error(
      `解压失败${r.error ? `：${r.error.message}` : r.stderr ? `：${r.stderr}` : ""}（isZip=${isZip}）`,
    );
  }
}

function copyStandaloneBinary(srcBin, destBin) {
  fs.mkdirSync(path.dirname(destBin), { recursive: true });
  fs.copyFileSync(srcBin, destBin);
  if (process.platform !== "win32") fs.chmodSync(destBin, 0o755);
}

async function vendorFromDownload(version, key, destBin) {
  const platform = distPlatformName(process.platform);
  const arch = mapDistArch(process.arch);
  const isWin = process.platform === "win32";
  const ext = isWin ? "zip" : "tar.gz";
  const distName = `node-v${version}-${platform}-${arch}`;
  const url = `https://nodejs.org/dist/v${version}/${distName}.${ext}`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-vendor-"));
  try {
    const archive = path.join(tmp, `node.${ext}`);
    process.stdout.write(`↓ 下载 ${url}\n`);
    await downloadFile(url, archive);
    const extracted = path.join(tmp, "extracted");
    extractArchive(archive, extracted, isWin);
    // 官方构建布局：unix 为 <distName>/bin/node；win 为 <distName>/node.exe
    const srcBin = isWin
      ? path.join(extracted, distName, "node.exe")
      : path.join(extracted, distName, "bin", "node");
    if (!fs.existsSync(srcBin)) {
      throw new Error(`解压后未找到 node 二进制：${srcBin}`);
    }
    copyStandaloneBinary(srcBin, destBin);
    const got = nodeVersionOf(destBin);
    if (got !== `v${version}`) {
      throw new Error(`下载版本不一致：期望 v${version}，实际 ${got}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "用法: node scripts/vendor-lawmind-desktop-node.mjs [--node /path/to/node] [--node-version 22.x] [--clean]\n",
    );
    return;
  }

  const key = `${process.platform}-${process.arch}`;
  const destDir = path.join(RUNTIME_ROOT, key);
  const destBin =
    process.platform === "win32" ? path.join(destDir, "node.exe") : path.join(destDir, "bin", "node");

  if (args.clean && fs.existsSync(RUNTIME_ROOT)) {
    fs.rmSync(RUNTIME_ROOT, { recursive: true, force: true });
  }

  // 模式 A：直接复制本地独立二进制（--node 或 LAWMIND_NODE_BIN）。
  const localBin = (args.nodeBin || process.env.LAWMIND_NODE_BIN || "").trim();
  if (localBin) {
    if (!fs.existsSync(localBin)) {
      process.stderr.write(`✗ 找不到 Node 二进制：${localBin}\n`);
      process.exit(1);
    }
    const srcVersion = nodeVersionOf(localBin);
    if (fs.existsSync(destBin)) {
      try {
        if (nodeVersionOf(destBin) === srcVersion) {
          process.stdout.write(`✓ 已 vendored（版本一致，跳过）：${path.relative(REPO_ROOT, destBin)} [${srcVersion}]\n`);
          return;
        }
      } catch { /* 损坏则覆盖 */ }
    }
    copyStandaloneBinary(localBin, destBin);
    const got = nodeVersionOf(destBin);
    if (got !== srcVersion) {
      process.stderr.write(`✗ vendored 二进制版本不一致：源 ${srcVersion} / 目标 ${got}\n`);
      process.exit(1);
    }
    process.stdout.write(`✓ vendored Node ${srcVersion}（本地复制）→ ${path.relative(REPO_ROOT, destBin)}\n  key=${key} src=${localBin}\n`);
    return;
  }

  // 模式 B：下载官方独立构建。默认与当前构建机版本一致。
  const version = (args.nodeVersion || process.versions.node).replace(/^v/, "");
  const wantTag = `v${version}`;

  if (fs.existsSync(destBin)) {
    try {
      if (nodeVersionOf(destBin) === wantTag) {
        process.stdout.write(`✓ 已 vendored（版本一致，跳过）：${path.relative(REPO_ROOT, destBin)} [${wantTag}]\n`);
        return;
      }
    } catch { /* 损坏则重新下载 */ }
  }

  try {
    await vendorFromDownload(version, key, destBin);
    process.stdout.write(`✓ vendored Node ${wantTag} → ${path.relative(REPO_ROOT, destBin)}\n  key=${key}\n`);
  } catch (e) {
    process.stderr.write(`✗ 下载/解压失败：${e instanceof Error ? e.message : String(e)}\n`);
    process.stderr.write(`  提示：内网/离线构建可用 --node /path/to/standalone-node 复制本地独立二进制。\n`);
    process.exit(1);
  }
}

main();
