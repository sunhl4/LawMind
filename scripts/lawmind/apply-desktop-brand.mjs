#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
/**
 * Apply LawMind desktop brand in one pass:
 * - sync SVG copies listed in branding/manifest.json
 * - rebuild icns/ico/window png from build/icon.png when tools exist
 * - stamp the vendored Electron.app (dev Dock / Cmd-Tab / hidden tile)
 *
 * Does not change CFBundleIdentifier (keeps userData under Application Support/Electron).
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDesktopBrand } from "../../apps/lawmind-desktop/electron/brand.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const desktopRoot = path.join(repoRoot, "apps", "lawmind-desktop");
const STAMP_NAME = ".lawmind-brand-stamp.json";

export function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function replacePlistString(xml, key, value) {
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`);
  if (!re.test(xml)) {
    throw new Error(`Info.plist missing ${key}`);
  }
  return xml.replace(re, `$1${value}$3`);
}

export function resolveElectronAppPath(root = desktopRoot) {
  const require = createRequire(import.meta.url);
  let electronPkg;
  try {
    electronPkg = path.dirname(require.resolve("electron/package.json", { paths: [root] }));
  } catch {
    return null;
  }
  const appPath = path.join(electronPkg, "dist", "Electron.app");
  return fs.existsSync(appPath) ? appPath : null;
}

export function computeStamp(brand, pngPath) {
  return {
    productName: brand.productName,
    pngSha256: fs.existsSync(pngPath) ? fileSha256(pngPath) : "",
  };
}

function writePlistKey(plistPath, key, value) {
  const xml = fs.readFileSync(plistPath, "utf8");
  fs.writeFileSync(plistPath, replacePlistString(xml, key, value));
}

export function syncSvgCopies(brand, root = desktopRoot) {
  const src = path.join(root, brand.icons.svg);
  if (!fs.existsSync(src)) {
    return [];
  }
  const copied = [];
  for (const rel of brand.svgCopies ?? []) {
    const dest = path.resolve(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied.push(dest);
  }
  return copied;
}

function which(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function rebuildDerivedIcons(brand, root = desktopRoot) {
  const png = path.join(root, brand.icons.png);
  if (!fs.existsSync(png) || process.platform !== "darwin") {
    return { rebuilt: false };
  }
  const icns = path.join(root, brand.icons.icns);
  const ico = path.join(root, brand.icons.ico);
  const windowPng = path.join(root, brand.icons.pngWindow);
  fs.mkdirSync(path.dirname(icns), { recursive: true });
  fs.mkdirSync(path.dirname(windowPng), { recursive: true });

  if (which("sips")) {
    execFileSync("sips", ["-z", "512", "512", png, "--out", windowPng], { stdio: "ignore" });
  } else {
    fs.copyFileSync(png, windowPng);
  }

  if (which("iconutil")) {
    const iconset = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-iconset-"));
    const setDir = path.join(iconset, "LawMind.iconset");
    fs.mkdirSync(setDir);
    const sizes = {
      "icon_16x16.png": 16,
      "icon_16x16@2x.png": 32,
      "icon_32x32.png": 32,
      "icon_32x32@2x.png": 64,
      "icon_128x128.png": 128,
      "icon_128x128@2x.png": 256,
      "icon_256x256.png": 256,
      "icon_256x256@2x.png": 512,
      "icon_512x512.png": 512,
      "icon_512x512@2x.png": 1024,
    };
    for (const [name, size] of Object.entries(sizes)) {
      execFileSync(
        "sips",
        ["-z", String(size), String(size), png, "--out", path.join(setDir, name)],
        {
          stdio: "ignore",
        },
      );
    }
    execFileSync("iconutil", ["-c", "icns", setDir, "-o", icns], { stdio: "ignore" });
    fs.rmSync(iconset, { recursive: true, force: true });
  }

  if (which("magick")) {
    execFileSync("magick", [png, "-define", "icon:auto-resize=256,128,64,48,32,16", ico], {
      stdio: "ignore",
    });
  }

  return { rebuilt: true, icns, ico, windowPng };
}

export function applyMacElectronAppBrand({ appPath, icnsPath, productName, stamp }) {
  const plist = path.join(appPath, "Contents", "Info.plist");
  const destIcns = path.join(appPath, "Contents", "Resources", "electron.icns");
  if (!fs.existsSync(plist)) {
    throw new Error(`Electron Info.plist missing: ${plist}`);
  }
  writePlistKey(plist, "CFBundleDisplayName", productName);
  writePlistKey(plist, "CFBundleName", productName);
  if (fs.existsSync(icnsPath)) {
    fs.copyFileSync(icnsPath, destIcns);
  }

  const frameworks = path.join(appPath, "Contents", "Frameworks");
  if (fs.existsSync(frameworks)) {
    for (const name of fs.readdirSync(frameworks)) {
      if (!name.endsWith(".app")) {
        continue;
      }
      const helperPlist = path.join(frameworks, name, "Contents", "Info.plist");
      if (!fs.existsSync(helperPlist)) {
        continue;
      }
      const suffix = name.replace(/^Electron Helper/, "").replace(/\.app$/, "");
      const helperLabel = `${productName} Helper${suffix}`;
      try {
        writePlistKey(helperPlist, "CFBundleDisplayName", helperLabel);
        writePlistKey(helperPlist, "CFBundleName", helperLabel);
      } catch {
        /* helper plists vary by Electron version */
      }
    }
  }

  const stampPath = path.join(appPath, "Contents", "Resources", STAMP_NAME);
  fs.writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);

  if (process.platform === "darwin") {
    try {
      execFileSync("codesign", ["--force", "--sign", "-", appPath], { stdio: "ignore" });
    } catch {
      /* unsigned Electron still launches in dev */
    }
    const lsregister =
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
    if (fs.existsSync(lsregister)) {
      try {
        execFileSync(lsregister, ["-f", appPath], { stdio: "ignore" });
      } catch {
        /* cache refresh is best-effort */
      }
    }
  }

  return { plist, destIcns, stampPath };
}

export function isStampCurrent(appPath, stamp) {
  const stampPath = path.join(appPath, "Contents", "Resources", STAMP_NAME);
  if (!fs.existsSync(stampPath)) {
    return false;
  }
  try {
    const prev = JSON.parse(fs.readFileSync(stampPath, "utf8"));
    return prev.productName === stamp.productName && prev.pngSha256 === stamp.pngSha256;
  } catch {
    return false;
  }
}

export function applyDesktopBrand({ root = desktopRoot, force = false } = {}) {
  const brand = loadDesktopBrand(root);
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const builderName = pkg.build?.productName;
    if (builderName && builderName !== brand.productName) {
      throw new Error(
        `package.json build.productName (${builderName}) != branding/manifest.json productName (${brand.productName})`,
      );
    }
  }
  const pngPath = path.join(root, brand.icons.png);
  const copied = syncSvgCopies(brand, root);
  const derived = rebuildDerivedIcons(brand, root);
  const appPath = resolveElectronAppPath(root);
  const stamp = computeStamp(brand, pngPath);
  let electron = null;
  if (appPath) {
    if (!force && isStampCurrent(appPath, stamp)) {
      electron = { appPath, skipped: true };
    } else {
      electron = {
        appPath,
        skipped: false,
        ...applyMacElectronAppBrand({
          appPath,
          icnsPath: path.join(root, brand.icons.icns),
          productName: brand.productName,
          stamp,
        }),
      };
    }
  }
  return { brand, copied, derived, electron, stamp };
}

function isMain(url) {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entry === fileURLToPath(url);
}

if (isMain(import.meta.url)) {
  const ifElectron = process.argv.includes("--if-electron");
  const force = process.argv.includes("--force");
  try {
    const result = applyDesktopBrand({ force });
    if (ifElectron && !result.electron) {
      process.exit(0);
    }
    const state = result.electron?.skipped
      ? "already branded"
      : result.electron
        ? "patched Electron.app"
        : "no Electron.app (skip bundle)";
    console.log(
      `[lawmind-brand] ${result.brand.productName}: svg×${result.copied.length} ${state}`,
    );
  } catch (err) {
    console.warn(`[lawmind-brand] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(ifElectron ? 0 : 1);
  }
}
