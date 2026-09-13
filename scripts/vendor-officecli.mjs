#!/usr/bin/env node
/**
 * lawmind:vendor:officecli — download the Apache-2.0 OfficeCLI binary for the
 * current OS/arch into `apps/lawmind-desktop/resources/officecli/<platform-arch>/`.
 *
 * Layout (aligned with extraResources + officecli-bin.ts / electron/officecli-runtime.mjs):
 *   unix: resources/officecli/<key>/officecli
 *   win:  resources/officecli/<key>/officecli.exe
 * LICENSE + NOTICE from third_party/officecli are copied beside the binary.
 *
 * 用法：
 *   node scripts/vendor-officecli.mjs
 *   node scripts/vendor-officecli.mjs --version 1.0.149
 *   node scripts/vendor-officecli.mjs --bin /path/to/officecli
 *   node scripts/vendor-officecli.mjs --postinstall   # CI 默认跳过；失败不挡 pnpm install
 *   node scripts/vendor-officecli.mjs --clean
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const VENDOR_ROOT = path.join(REPO_ROOT, "apps", "lawmind-desktop", "resources", "officecli");
const NOTICE_DIR = path.join(REPO_ROOT, "third_party", "officecli");
const REPO = "iOfficeAI/OfficeCLI";
const MIRROR_BASE = "https://d.officecli.ai";
const GITHUB_BASE = `https://github.com/${REPO}`;
/** Pin for reproducible desktop builds. Override with --version / LAWMIND_OFFICECLI_VERSION. */
const DEFAULT_OFFICECLI_VERSION = "1.0.149";

function parseArgs(argv) {
  const out = {
    bin: "",
    version: "",
    clean: false,
    help: false,
    postinstall: false,
    printAsset: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--bin") {
      out.bin = argv[++i] ?? "";
    } else if (a === "--version") {
      out.version = argv[++i] ?? "";
    } else if (a === "--clean") {
      out.clean = true;
    } else if (a === "--postinstall") {
      out.postinstall = true;
    } else if (a === "--print-asset") {
      out.printAsset = true;
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
  }
  return out;
}

function isMusl() {
  if (process.platform !== "linux") {
    return false;
  }
  try {
    const report = process.report?.getReport?.();
    const header = report && typeof report === "object" ? report.header : undefined;
    if (header?.glibcVersionRuntime) {
      return false;
    }
  } catch {
    /* fall through */
  }
  try {
    if (fs.existsSync("/etc/alpine-release")) {
      return true;
    }
  } catch {
    /* ignore */
  }
  try {
    const out = spawnSync("ldd", ["--version"], { encoding: "utf8" });
    const text = `${out.stdout ?? ""}${out.stderr ?? ""}`;
    if (/musl/i.test(text)) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function detectOfficeCliAsset(
  platform = process.platform,
  arch = process.arch,
  musl = isMusl(),
) {
  if (platform === "darwin") {
    if (arch === "arm64") {
      return "officecli-mac-arm64";
    }
    if (arch === "x64") {
      return "officecli-mac-x64";
    }
  } else if (platform === "linux") {
    if (arch === "x64") {
      return musl ? "officecli-linux-alpine-x64" : "officecli-linux-x64";
    }
    if (arch === "arm64") {
      return musl ? "officecli-linux-alpine-arm64" : "officecli-linux-arm64";
    }
  } else if (platform === "win32") {
    if (arch === "x64") {
      return "officecli-win-x64.exe";
    }
    if (arch === "arm64") {
      return "officecli-win-arm64.exe";
    }
  }
  throw new Error(
    `不支持的平台：${platform}-${arch}（officecli 仅 darwin/linux/win32 × x64/arm64）`,
  );
}

function binaryName(platform = process.platform) {
  return platform === "win32" ? "officecli.exe" : "officecli";
}

function runtimeKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function pinVersion(raw) {
  return String(raw || DEFAULT_OFFICECLI_VERSION)
    .trim()
    .replace(/^v/, "")
    .split("+")[0]
    .split("-")[0];
}

function httpGet(url, onResponse, onError, redirects = 0) {
  if (redirects > 10) {
    onError(new Error(`Too many redirects for ${url}`));
    return;
  }
  const req = https.get(url, { headers: { "User-Agent": "lawmind-vendor-officecli" } }, (res) => {
    const code = res.statusCode ?? 0;
    if (code >= 300 && code < 400 && res.headers.location) {
      res.resume();
      const next = new URL(res.headers.location, url).toString();
      httpGet(next, onResponse, onError, redirects + 1);
      return;
    }
    if (code !== 200) {
      res.resume();
      onError(new Error(`HTTP ${code} for ${url}`));
      return;
    }
    onResponse(res);
  });
  req.on("error", onError);
  req.setTimeout(60_000, () => req.destroy(new Error(`Timeout downloading ${url}`)));
}

function fetchToFile(url, dest) {
  return new Promise((resolve, reject) => {
    httpGet(
      url,
      (res) => {
        const tmp = `${dest}.download`;
        const out = createWriteStream(tmp);
        let lastChunk = Date.now();
        const stall = setInterval(() => {
          if (Date.now() - lastChunk > 45_000) {
            clearInterval(stall);
            out.destroy();
            res.destroy();
            reject(new Error(`Download stalled for ${url}`));
          }
        }, 5_000);
        const done = (err) => {
          clearInterval(stall);
          if (err) {
            reject(err);
          }
        };
        res.on("data", () => {
          lastChunk = Date.now();
        });
        res.pipe(out);
        out.on("error", done);
        out.on("finish", () => {
          out.close(() => {
            try {
              fs.renameSync(tmp, dest);
              clearInterval(stall);
              resolve();
            } catch (e) {
              done(e);
            }
          });
        });
      },
      reject,
    );
  });
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    httpGet(
      url,
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      },
      reject,
    );
  });
}

async function verifyChecksum(asset, file, tag) {
  const urls = [
    `${GITHUB_BASE}/releases/download/${tag}/SHA256SUMS`,
    `${MIRROR_BASE}/releases/download/${tag}/SHA256SUMS`,
  ];
  let sums = "";
  for (const url of urls) {
    try {
      sums = (await fetchBuffer(url)).toString("utf8");
      break;
    } catch {
      /* try next */
    }
  }
  if (!sums) {
    throw new Error(`无法下载 SHA256SUMS（${tag}）`);
  }
  let expected;
  for (const line of sums.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const name = parts[1].replace(/^\*/, "");
      if (name === asset) {
        expected = parts[0];
        break;
      }
    }
  }
  if (!expected) {
    throw new Error(`SHA256SUMS 未列出 ${asset}`);
  }
  const actual = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${asset} (expected ${expected}, got ${actual})`);
  }
}

function copyNotices(destDir) {
  for (const name of ["LICENSE", "NOTICE"]) {
    const src = path.join(NOTICE_DIR, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destDir, name));
    }
  }
}

function stripQuarantine(filePath) {
  if (process.platform !== "darwin") {
    return;
  }
  spawnSync("xattr", ["-d", "com.apple.quarantine", filePath], { encoding: "utf8" });
}

function officecliVersionOf(binPath) {
  stripQuarantine(binPath);
  const r = spawnSync(binPath, ["--version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    throw new Error(
      `无法执行 ${binPath} --version${r.error ? `：${r.error.message}` : r.stderr ? `：${r.stderr}` : ""}`,
    );
  }
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  const m = /(\d+\.\d+\.\d+)/.exec(text);
  return m ? m[1] : text;
}

function readPinnedVersion(destDir) {
  const p = path.join(destDir, "VERSION");
  if (!fs.existsSync(p)) {
    return "";
  }
  return fs.readFileSync(p, "utf8").trim().replace(/^v/, "");
}

function writeSidecar(destDir, version) {
  fs.writeFileSync(path.join(destDir, "VERSION"), `${version}\n`, "utf8");
  copyNotices(destDir);
}

function copyStandaloneBinary(srcBin, destBin) {
  fs.mkdirSync(path.dirname(destBin), { recursive: true });
  fs.copyFileSync(srcBin, destBin);
  if (process.platform !== "win32") {
    fs.chmodSync(destBin, 0o755);
  }
  stripQuarantine(destBin);
}

function findPathOfficeCliMatching(version) {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(whichCmd, ["officecli"], { encoding: "utf8" });
  if (r.status !== 0) {
    return "";
  }
  const bin = (r.stdout ?? "").trim().split(/\r?\n/)[0]?.trim();
  if (!bin || !fs.existsSync(bin)) {
    return "";
  }
  try {
    return officecliVersionOf(bin) === version ? bin : "";
  } catch {
    return "";
  }
}

async function vendorFromDownload(version, destBin) {
  const tag = `v${version}`;
  const asset = detectOfficeCliAsset();
  const urls = [
    `${MIRROR_BASE}/releases/download/${tag}/${asset}`,
    `${GITHUB_BASE}/releases/download/${tag}/${asset}`,
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-officecli-"));
  const tmpFile = path.join(tmp, asset);
  let lastErr;
  try {
    for (const url of urls) {
      try {
        process.stdout.write(`↓ 下载 ${url}\n`);
        await fetchToFile(url, tmpFile);
        await verifyChecksum(asset, tmpFile, tag);
        copyStandaloneBinary(tmpFile, destBin);
        return;
      } catch (e) {
        lastErr = e;
        process.stderr.write(`  失败：${e instanceof Error ? e.message : String(e)}\n`);
        try {
          fs.rmSync(tmpFile, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
    throw lastErr ?? new Error("download failed");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function skipPostinstallInCi() {
  const ci = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  const force = process.env.LAWMIND_VENDOR_OFFICECLI === "1";
  const skip = process.env.LAWMIND_SKIP_OFFICECLI_VENDOR === "1";
  return skip || (ci && !force);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "用法: node scripts/vendor-officecli.mjs [--version 1.0.149] [--bin /path/to/officecli] [--postinstall] [--clean]\n",
    );
    return;
  }
  if (args.printAsset) {
    process.stdout.write(`${detectOfficeCliAsset()}\n`);
    return;
  }

  const key = runtimeKey();
  const destDir = path.join(VENDOR_ROOT, key);
  const destBin = path.join(destDir, binaryName());

  if (args.clean && fs.existsSync(VENDOR_ROOT)) {
    fs.rmSync(VENDOR_ROOT, { recursive: true, force: true });
  }

  if (args.postinstall && skipPostinstallInCi()) {
    process.stdout.write("✓ skip officecli vendor in CI (desktop dist vendors it)\n");
    return;
  }

  const localBin = (args.bin || process.env.LAWMIND_OFFICECLI_BIN || "").trim();
  if (localBin) {
    if (!fs.existsSync(localBin)) {
      throw new Error(`找不到 officecli 二进制：${localBin}`);
    }
    copyStandaloneBinary(localBin, destBin);
    let ver = pinVersion(args.version || process.env.LAWMIND_OFFICECLI_VERSION || "");
    try {
      ver = officecliVersionOf(destBin);
    } catch {
      /* keep pin */
    }
    writeSidecar(destDir, ver || "local");
    process.stdout.write(
      `✓ vendored officecli ${ver || "local"}（本地复制）→ ${path.relative(REPO_ROOT, destBin)}\n`,
    );
    return;
  }

  const version = pinVersion(
    args.version || process.env.LAWMIND_OFFICECLI_VERSION || DEFAULT_OFFICECLI_VERSION,
  );

  if (fs.existsSync(destBin) && readPinnedVersion(destDir) === version) {
    try {
      const got = officecliVersionOf(destBin);
      if (got === version || got.startsWith(version)) {
        process.stdout.write(
          `✓ 已 vendored（版本一致，跳过）：${path.relative(REPO_ROOT, destBin)} [v${version}]\n`,
        );
        return;
      }
    } catch {
      /* 损坏则重新下载 */
    }
  }

  const pathBin = findPathOfficeCliMatching(version);
  if (pathBin && args.postinstall) {
    copyStandaloneBinary(pathBin, destBin);
    writeSidecar(destDir, version);
    process.stdout.write(
      `✓ vendored officecli v${version}（本机 PATH）→ ${path.relative(REPO_ROOT, destBin)}\n`,
    );
    return;
  }

  try {
    await vendorFromDownload(version, destBin);
    const got = officecliVersionOf(destBin);
    if (got !== version && !got.startsWith(version)) {
      throw new Error(`下载版本不一致：期望 ${version}，实际 ${got}`);
    }
    writeSidecar(destDir, version);
    process.stdout.write(
      `✓ vendored officecli v${version} → ${path.relative(REPO_ROOT, destBin)}\n  key=${key}\n`,
    );
  } catch (e) {
    if (pathBin) {
      copyStandaloneBinary(pathBin, destBin);
      writeSidecar(destDir, version);
      process.stdout.write(
        `✓ vendored officecli v${version}（下载失败，改用 PATH ${pathBin}）→ ${path.relative(REPO_ROOT, destBin)}\n`,
      );
      return;
    }
    const msg = `✗ officecli 下载/校验失败：${e instanceof Error ? e.message : String(e)}`;
    process.stderr.write(`${msg}\n`);
    process.stderr.write(
      "  提示：内网可用 --bin /path/to/officecli；或设置 LAWMIND_OFFICECLI_VERSION。\n",
    );
    if (args.postinstall) {
      process.stderr.write(
        "  postinstall 不阻断 pnpm install；改稿前请再跑 pnpm lawmind:vendor:officecli。\n",
      );
      return;
    }
    process.exit(1);
  }
}

const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  void main().catch((e) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
