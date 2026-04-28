#!/usr/bin/env node
/**
 * Copy LawMind markdown from monorepo docs/ into this package's docs/ root.
 * Source of truth remains ../../docs — run before dev/build/preview.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const srcDocs = path.join(repoRoot, "docs");
const destDocs = path.resolve(__dirname, "../docs");

if (!fs.existsSync(srcDocs)) {
  console.error("sync-docs: missing", srcDocs);
  process.exit(1);
}

let n = 0;
for (const f of fs.readdirSync(srcDocs)) {
  if (f.startsWith("LAWMIND-") && f.endsWith(".md")) {
    fs.copyFileSync(path.join(srcDocs, f), path.join(destDocs, f));
    n += 1;
  }
}

const lmSrc = path.join(srcDocs, "lawmind");
const lmDest = path.join(destDocs, "lawmind");
if (fs.existsSync(lmSrc)) {
  fs.rmSync(lmDest, { recursive: true, force: true });
  fs.cpSync(lmSrc, lmDest, { recursive: true });
}

console.log(`sync-docs: copied ${n} LAWMIND-*.md + docs/lawmind/ → apps/lawmind-docs/docs/`);
