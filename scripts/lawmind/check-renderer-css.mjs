#!/usr/bin/env node
/**
 * CI gate: renderer styles.css must contain sync markers and stay above minimum size.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.resolve(__dirname, "../../apps/lawmind-desktop/src/renderer");
const stylesPath = path.join(rendererDir, "styles.css");

const REQUIRED_MARKERS = [
  "chat-split",
  "desk-layout",
  "chat-workspace",
  "shell-header+chat-main",
  "modal-forms",
  "utilities",
  "workflow-hub+chat-compose",
  "buttons",
  "model-picker",
  "callouts",
  "file-workbench",
  "matter-review-workbench",
  "legacy-rest",
  "settings",
];

const MIN_BYTES = 150_000;

/** Fail fast on truncated sync blocks (e.g. missing closing `}`). */
function validateCssBraces(text) {
  let depth = 0;
  let inString = false;
  let stringQuote = "";
  let inComment = false;
  let inLineComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      }
      continue;
    }
    if (inComment) {
      if (ch === "*" && next === "/") {
        inComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      inComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth < 0) {
        throw new Error("styles.css has extra closing brace");
      }
    }
  }
  if (depth !== 0) {
    throw new Error(`styles.css has ${depth} unclosed rule block(s)`);
  }
}

async function main() {
  const text = fs.readFileSync(stylesPath, "utf8");
  const size = Buffer.byteLength(text, "utf8");
  const errors = [];

  if (size < MIN_BYTES) {
    errors.push(
      `styles.css too small (${size} bytes < ${MIN_BYTES}); run pnpm lawmind:sync:renderer-css or restore CSS modules`,
    );
  }

  if (!text.includes('@import "./styles/tokens.css"')) {
    errors.push('styles.css must @import "./styles/tokens.css"');
  }
  if (!text.includes('@import "./styles/animations.css"')) {
    errors.push('styles.css must @import "./styles/animations.css"');
  }

  for (const marker of REQUIRED_MARKERS) {
    const open = `/* ── imported: ${marker} ── */`;
    if (!text.includes(open)) {
      errors.push(`missing sync marker: ${open}`);
    }
  }

  try {
    validateCssBraces(text);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (errors.length > 0) {
    console.error("[check-renderer-css] FAILED");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  console.log(`[check-renderer-css] OK (${size} bytes, ${REQUIRED_MARKERS.length} markers)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
