#!/usr/bin/env node
/**
 * LawMind: rebuild native modules for the desktop's Electron.
 *
 * Why: Native modules ship prebuilt for Node ABI, not the Electron ABI we run
 * inside `apps/lawmind-desktop`. Without rebuilding, they may fail to load.
 *
 * Note: As of 2026-06, keytar has been replaced with Electron's built-in
 * safeStorage API, so no native module rebuild is needed for keychain access.
 * This script remains for future native modules that may be added.
 *
 * Behavior:
 *   - Skips silently when `SKIP_ELECTRON_REBUILD=1` (CI / non-desktop installs).
 *   - Skips silently when `apps/lawmind-desktop` is missing (engine-only consumer).
 *   - Skips silently when no native modules need rebuilding.
 *   - Skips silently when `@electron/rebuild` is unavailable.
 *   - Logs warnings but never fails `pnpm install` (we have fallbacks).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const desktopDir = path.join(repoRoot, "apps", "lawmind-desktop");
const ifDesktopOnly = process.argv.includes("--if-desktop");

if (process.env.SKIP_ELECTRON_REBUILD === "1") {
  process.exit(0);
}
if (!existsSync(desktopDir)) {
  process.exit(0);
}
if (ifDesktopOnly) {
  const electronDir = path.join(desktopDir, "node_modules", "electron");
  if (!existsSync(electronDir)) {
    process.exit(0);
  }
}

async function rebuildModule(moduleName) {
  let rebuildMod;
  try {
    rebuildMod = await import("@electron/rebuild");
  } catch {
    console.warn(
      `[lawmind] @electron/rebuild not installed; skipping native module rebuild for ${moduleName}.`,
    );
    return;
  }

  const rebuild = rebuildMod.rebuild ?? rebuildMod.default?.rebuild;
  if (typeof rebuild !== "function") {
    console.warn("[lawmind] @electron/rebuild API not found; skipping.");
    return;
  }

  let electronVersion;
  try {
    const electronPkg = await import(
      path.join(desktopDir, "node_modules", "electron", "package.json"),
      { with: { type: "json" } }
    );
    electronVersion = electronPkg.default.version;
  } catch {
    console.warn("[lawmind] electron not installed in apps/lawmind-desktop; skipping rebuild.");
    return;
  }

  try {
    await rebuild({
      buildPath: desktopDir,
      electronVersion,
      onlyModules: [moduleName],
      force: false,
    });
    console.log(`[lawmind] ${moduleName} rebuilt for Electron ${electronVersion}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[lawmind] ${moduleName} rebuild failed: ${msg}`);
  }
}

// Check if there are any native modules that need rebuilding.
// Currently none, as keytar has been replaced with safeStorage.
const nativeModules = [];
for (const moduleName of nativeModules) {
  const modulePkg = path.join(desktopDir, "node_modules", moduleName, "package.json");
  if (existsSync(modulePkg)) {
    await rebuildModule(moduleName);
  }
}
