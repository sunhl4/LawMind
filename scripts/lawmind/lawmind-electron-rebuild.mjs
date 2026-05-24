#!/usr/bin/env node
/**
 * LawMind: rebuild native modules (`keytar`) for the desktop's Electron.
 *
 * Why: `keytar` ships prebuilt for Node ABI, not the Electron ABI we run inside
 * `apps/lawmind-desktop`. Without rebuilding, `require("keytar")` either fails
 * to load or silently returns `undefined`.
 *
 * Behavior:
 *   - Skips silently when `SKIP_ELECTRON_REBUILD=1` (CI / non-desktop installs).
 *   - Skips silently when `apps/lawmind-desktop` is missing (engine-only consumer).
 *   - Skips silently when `keytar` is not installed yet (e.g. first bootstrap).
 *   - Skips silently when `@electron/rebuild` is unavailable.
 *   - Logs warnings but never fails `pnpm install` (we have a plaintext fallback).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const desktopDir = path.join(repoRoot, "apps", "lawmind-desktop");

if (process.env.SKIP_ELECTRON_REBUILD === "1") {
  process.exit(0);
}
if (!existsSync(desktopDir)) {
  process.exit(0);
}
const keytarPkg = path.join(desktopDir, "node_modules", "keytar", "package.json");
if (!existsSync(keytarPkg)) {
  process.exit(0);
}

async function main() {
  let rebuildMod;
  try {
    rebuildMod = await import("@electron/rebuild");
  } catch {
    console.warn(
      "[lawmind] @electron/rebuild not installed; skipping native module rebuild (will fall back to plaintext .env.lawmind).",
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
      onlyModules: ["keytar"],
      force: false,
    });
    console.log(`[lawmind] keytar rebuilt for Electron ${electronVersion}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[lawmind] keytar rebuild failed (will fall back to plaintext): ${msg}`);
  }
}

void main();
