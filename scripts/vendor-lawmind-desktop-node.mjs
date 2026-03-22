#!/usr/bin/env node
/**
 * Download official Node.js binary for the *current* build machine platform/arch
 * into apps/lawmind-desktop/resources/node-runtime/<platform-arch>/
 *
 * Used before electron pack so the app can spawn local API without system Node on PATH.
 *
 * Env:
 *   LAWMIND_DESKTOP_NODE_VERSION — default 22.14.0
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = process.env.LAWMIND_DESKTOP_NODE_VERSION?.trim() || "22.14.0";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destRoot = path.join(root, "apps", "lawmind-desktop", "resources", "node-runtime");

/**
 * @returns {{ key: string, folder: string, ext: string, tarFlag: string | null }}
 */
function getTarget() {
  const p = process.platform;
  const a = process.arch;
  if (p === "darwin" && a === "arm64") {
    return { key: "darwin-arm64", folder: "darwin-arm64", ext: "tar.gz", tarFlag: "z" };
  }
  if (p === "darwin" && a === "x64") {
    return { key: "darwin-x64", folder: "darwin-x64", ext: "tar.gz", tarFlag: "z" };
  }
  if (p === "win32" && a === "x64") {
    return { key: "win32-x64", folder: "win-x64", ext: "zip", tarFlag: null };
  }
  if (p === "linux" && a === "x64") {
    return { key: "linux-x64", folder: "linux-x64", ext: "tar.xz", tarFlag: "J" };
  }
  throw new Error(
    `[vendor-lawmind-desktop-node] Unsupported platform: ${p} ${a}. Build LawMind desktop on macOS/win/linux x64 or darwin arm64.`,
  );
}

async function download(url, destFile) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed ${res.status}: ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destFile, buf);
}

function extract(archivePath, tmpDir, target) {
  if (target.ext === "zip") {
    const r = spawnSync("tar", ["-xf", archivePath, "-C", tmpDir], { stdio: "inherit" });
    if (r.status !== 0) {
      throw new Error("tar -xf zip failed");
    }
    return;
  }
  const flag = target.tarFlag === "z" ? ["-xzf"] : ["-xJf"];
  const r = spawnSync("tar", [...flag, archivePath, "-C", tmpDir], { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`tar extract failed for ${target.ext}`);
  }
}

const target = getTarget();
const baseName = `node-v${VERSION}-${target.folder}`;
const fileName = `${baseName}.${target.ext}`;
const url = `https://nodejs.org/dist/v${VERSION}/${fileName}`;

const tmpBase = fs.mkdtempSync(path.join(root, ".lawmind-node-vendor-"));
const archivePath = path.join(tmpBase, fileName);

try {
  console.error(`[vendor-lawmind-desktop-node] ${url}`);
  await download(url, archivePath);

  const extractDir = path.join(tmpBase, "out");
  fs.mkdirSync(extractDir, { recursive: true });
  extract(archivePath, extractDir, target);

  const inner = path.join(extractDir, baseName);
  if (!fs.existsSync(inner)) {
    throw new Error(`Expected extracted folder missing: ${inner}`);
  }

  const outDir = path.join(destRoot, target.key);
  fs.mkdirSync(destRoot, { recursive: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(inner, outDir, { recursive: true });

  if (process.platform !== "win32") {
    const nodeBin = path.join(outDir, "bin", "node");
    if (fs.existsSync(nodeBin)) {
      fs.chmodSync(nodeBin, 0o755);
    }
  }

  console.error(`[vendor-lawmind-desktop-node] ok -> ${outDir}`);
} finally {
  fs.rmSync(tmpBase, { recursive: true, force: true });
}
