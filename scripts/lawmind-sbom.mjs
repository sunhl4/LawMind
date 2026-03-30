#!/usr/bin/env node
/**
 * Generate a simple SBOM (JSON) from the repo lockfile for LawMind / compliance packs.
 * Does not replace full CycloneDX for native deps; focuses on npm graph from pnpm-lock.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function main() {
  const lockPath = path.join(root, "pnpm-lock.yaml");
  if (!fs.existsSync(lockPath)) {
    console.error("pnpm-lock.yaml not found at repo root");
    process.exit(1);
  }
  const raw = fs.readFileSync(lockPath, "utf8");
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const out = {
    bomFormat: "LawMind-sbom-stub",
    specVersion: "1",
    generatedAt: new Date().toISOString(),
    rootPackage: {
      name: pkg.name,
      version: pkg.version,
    },
    lockfile: {
      path: "pnpm-lock.yaml",
      sha256: sha256(raw),
      byteLength: raw.length,
    },
    note: "Lockfile fingerprint for the monorepo root. CycloneDX JSON for the LawMind desktop package is written alongside when `pnpm dlx @cyclonedx/cyclonedx-npm` succeeds (see apps/lawmind-desktop).",
  };
  const outPath = path.join(root, "dist", "lawmind-sbom.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${path.relative(root, outPath)}`);

  // CycloneDX CLI does not yet handle pnpm 10 workspace `pnpm ls` the same as npm; generate from the
  // LawMind desktop package subtree (still a faithful dependency graph for the Electron app).
  const desktopRoot = path.join(root, "apps", "lawmind-desktop");
  const cdxPath = path.join(root, "dist", "lawmind-sbom-cyclonedx-lawmind-desktop.json");
  fs.mkdirSync(path.dirname(cdxPath), { recursive: true });
  const cdx = spawnSync(
    "pnpm",
    [
      "dlx",
      "@cyclonedx/cyclonedx-npm@4.2.1",
      "--ignore-npm-errors",
      "-o",
      cdxPath,
      "--spec-version",
      "1.6",
    ],
    { cwd: desktopRoot, encoding: "utf8", stdio: "inherit" },
  );
  if (cdx.status === 0 && fs.existsSync(cdxPath)) {
    console.log(`Wrote ${path.relative(root, cdxPath)} (CycloneDX, lawmind-desktop package)`);
  } else {
    console.warn(
      "[lawmind-sbom] CycloneDX generation skipped or failed (non-fatal). Run from repo root after pnpm install.",
    );
  }
}

main();
