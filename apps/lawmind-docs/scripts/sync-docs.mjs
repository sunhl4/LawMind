#!/usr/bin/env node
/**
 * Copy LawMind markdown from monorepo docs/ into this package's docs/ root.
 * Source of truth remains ../../docs — run before dev/build/preview.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const srcDocs = path.join(repoRoot, "docs");
const destDocs = path.resolve(here, "../docs");

if (!fs.existsSync(srcDocs)) {
  console.error("sync-docs: missing", srcDocs);
  process.exit(1);
}

const srcLawmindMd = new Set(
  fs.readdirSync(srcDocs).filter((f) => f.startsWith("LAWMIND-") && f.endsWith(".md")),
);
let pruned = 0;
if (fs.existsSync(destDocs)) {
  for (const f of fs.readdirSync(destDocs)) {
    if (f.startsWith("LAWMIND-") && f.endsWith(".md") && !srcLawmindMd.has(f)) {
      fs.rmSync(path.join(destDocs, f));
      pruned += 1;
    }
  }
}
let n = 0;
for (const f of srcLawmindMd) {
  fs.copyFileSync(path.join(srcDocs, f), path.join(destDocs, f));
  n += 1;
}

const lmSrc = path.join(srcDocs, "lawmind");
const lmDest = path.join(destDocs, "lawmind");
if (fs.existsSync(lmSrc)) {
  fs.rmSync(lmDest, { recursive: true, force: true });
  fs.cpSync(lmSrc, lmDest, { recursive: true });
}

/** Archived (read-only) docs stay published under /archive/ so old links keep resolving. */
const archSrc = path.join(srcDocs, "archive");
const archDest = path.join(destDocs, "archive");
if (fs.existsSync(archSrc)) {
  fs.rmSync(archDest, { recursive: true, force: true });
  fs.cpSync(archSrc, archDest, { recursive: true });
}

const assetsSrc = path.join(srcDocs, "assets");
const assetsDest = path.join(destDocs, "assets");
if (fs.existsSync(assetsSrc)) {
  fs.rmSync(assetsDest, { recursive: true, force: true });
  fs.cpSync(assetsSrc, assetsDest, { recursive: true });
}

/** Smart download page — source of truth is apps/lawmind-desktop/download/index.html */
const downloadSrc = path.join(repoRoot, "apps/lawmind-desktop/download/index.html");
const downloadDestDir = path.join(destDocs, "public/download");
if (fs.existsSync(downloadSrc)) {
  fs.mkdirSync(downloadDestDir, { recursive: true });
  fs.copyFileSync(downloadSrc, path.join(downloadDestDir, "index.html"));
}

/**
 * GitHub Pages custom domain: VitePress serves from `docs/public/`, so the CNAME
 * at the repo `docs/CNAME` must be copied into the publish root or the custom
 * domain is dropped on every deploy.
 */
const cnameSrc = path.join(srcDocs, "CNAME");
const publicDir = path.join(destDocs, "public");
if (fs.existsSync(cnameSrc)) {
  fs.mkdirSync(publicDir, { recursive: true });
  fs.copyFileSync(cnameSrc, path.join(publicDir, "CNAME"));
}

/** GitHub Pages must not run Jekyll on the VitePress output. */
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, ".nojekyll"), "");

console.log(
  `sync-docs: copied ${n} LAWMIND-*.md` +
    (pruned ? ` (pruned ${pruned} stale)` : "") +
    ` + docs/lawmind/ + docs/archive/ + docs/assets/ + download/ + CNAME → apps/lawmind-docs/docs/`,
);
