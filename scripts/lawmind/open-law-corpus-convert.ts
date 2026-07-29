#!/usr/bin/env node
/**
 * Convert open Chinese-law dumps → LawMind OpenLaw JSONL.
 *
 * Usage:
 *   pnpm lawmind:open-law:convert -- --in ./laws.json --out ./laws.jsonl
 *   pnpm lawmind:open-law:convert -- --in ./articles.txt --format article_line --out ./out.jsonl
 *   pnpm lawmind:open-law:convert -- --in ./laws.json --limit 50 --demo --out ./demo.jsonl
 *
 * Does not download megabyte corpora. For large packs, download yourself, then convert.
 * Unclear-license GitHub/HF dumps: verify rights before use (manual-only).
 */

import fs from "node:fs";
import path from "node:path";
import {
  detectAndConvertOpenLawDump,
  openLawRecordsToJsonl,
} from "../../src/lawmind/retrieval/providers/open-law/dump-convert.js";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) {
    return undefined;
  }
  return argv[i + 1];
}

function usage(): never {
  console.error(`Usage: open-law-corpus-convert --in <path> --out <path.jsonl> [options]

Options:
  --format auto|flk_json|article_line   (default: auto)
  --limit N                             max records
  --demo                                mark all records demo:true
`);
  process.exit(2);
}

function main(): void {
  const argv = process.argv.slice(2);
  const inPath = argValue(argv, "--in");
  const outPath = argValue(argv, "--out");
  if (!inPath || !outPath) {
    usage();
  }
  const formatRaw = (argValue(argv, "--format") ?? "auto").trim().toLowerCase();
  const format =
    formatRaw === "flk_json" || formatRaw === "article_line" || formatRaw === "auto"
      ? formatRaw
      : "auto";
  const limitRaw = argValue(argv, "--limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const markDemo = argv.includes("--demo");

  const absIn = path.resolve(inPath);
  const absOut = path.resolve(outPath);
  if (!fs.existsSync(absIn)) {
    console.error(`Input not found: ${absIn}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(absIn, "utf8");
  const { format: detected, records } = detectAndConvertOpenLawDump(raw, {
    format,
    markDemo,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, openLawRecordsToJsonl(records), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        format: detected,
        recordCount: records.length,
        out: absOut,
        next: `export LAWMIND_OPEN_LAW_CORPUS=${absOut}`,
        note: "Verify dump license before production use. Not 北大法宝.",
      },
      null,
      2,
    ),
  );
}

main();
