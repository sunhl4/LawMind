#!/usr/bin/env node
/**
 * Re-inline renderer CSS modules into styles.css at cascade-safe positions.
 *
 * Edit sources under apps/lawmind-desktop/src/renderer/styles/*.css, then:
 *   pnpm lawmind:sync:renderer-css
 *
 * Do NOT @import these modules from the top of styles.css — that breaks cascade order.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.resolve(__dirname, "../../apps/lawmind-desktop/src/renderer");
const stylesPath = path.join(rendererDir, "styles.css");
const stylesDir = path.join(rendererDir, "styles");

/** @type {Array<{ marker: string, chunks: Array<{ file: string, start?: number, end?: number }> }>} */
const BLOCKS = [
  {
    marker: "chat-split",
    chunks: [{ file: "chat.css", start: 1, end: 41 }],
  },
  {
    marker: "desk-layout",
    chunks: [{ file: "desk-layout.css" }],
  },
  {
    marker: "chat-workspace",
    // Keep this slice closed: must include full `.lm-assignment-applied-check .lm-md-code` rule.
    chunks: [{ file: "chat.css", start: 43, end: 58 }],
  },
  {
    marker: "shell-header+chat-main",
    // Keep closed through `.lm-compose-ctx-usage-action .lm-meta` (do not cut mid-rule).
    chunks: [{ file: "shell-header.css" }, { file: "chat.css", start: 60, end: 1122 }],
  },
  {
    marker: "modal-forms",
    chunks: [{ file: "modal-forms.css" }],
  },
  {
    marker: "utilities",
    chunks: [{ file: "utilities.css" }],
  },
  {
    marker: "workflow-hub+chat-compose",
    chunks: [{ file: "workflow-hub.css" }, { file: "chat.css", start: 1124 }],
  },
  {
    marker: "agent-fleet",
    chunks: [
      { file: "agent-fleet.css" },
      { file: "decision-ceremony.css" },
      { file: "agents-workbench.css" },
    ],
  },
  {
    marker: "automations",
    chunks: [{ file: "automations.css" }],
  },
  {
    marker: "buttons",
    chunks: [{ file: "buttons.css" }],
  },
  {
    marker: "model-picker",
    chunks: [{ file: "model-picker.css" }],
  },
  {
    marker: "callouts",
    chunks: [{ file: "callouts.css" }],
  },
  {
    marker: "file-workbench",
    chunks: [{ file: "file-workbench.css" }],
  },
  {
    marker: "matter-review-workbench",
    chunks: [{ file: "matter-review-workbench.css" }, { file: "meeting-workbench.css" }],
  },
  {
    marker: "legacy-rest",
    chunks: [{ file: "legacy-rest.css" }],
  },
  {
    marker: "cockpit-nav",
    chunks: [{ file: "cockpit-nav.css" }],
  },
  {
    marker: "settings",
    chunks: [{ file: "settings.css" }],
  },
];

function readLines(file, start = 1, end = Infinity) {
  const raw = fs.readFileSync(path.join(stylesDir, file), "utf8").split("\n");
  const slice = raw.slice(start - 1, Number.isFinite(end) ? end : raw.length);
  return slice.map((line, i, arr) => (i < arr.length - 1 ? `${line}\n` : line ? `${line}\n` : ""));
}

function stripModuleBanner(lines) {
  if (lines.length > 0 && lines[0].startsWith("/* ──")) {
    return lines.slice(1);
  }
  return lines;
}

function buildBlock(marker, chunks) {
  const out = [];
  for (const chunk of chunks) {
    out.push(...stripModuleBanner(readLines(chunk.file, chunk.start, chunk.end)));
  }
  return out.join("");
}

function replaceImportedBlock(text, marker, replacement) {
  const open = `/* ── imported: ${marker} ── */`;
  const close = `/* ── end imported: ${marker} ── */`;
  const start = text.indexOf(open);
  if (start < 0) {
    const insertAfter = {
      utilities: "modal-forms",
      "model-picker": "buttons",
      "legacy-rest": "matter-review-workbench",
      "cockpit-nav": "legacy-rest",
    }[marker];
    const appendedBlock = `\n/* ── imported: ${marker} ── */\n${replacement.trimEnd()}\n\n${close}\n`;
    if (insertAfter) {
      const anchor = `/* ── end imported: ${insertAfter} ── */`;
      const anchorIdx = text.indexOf(anchor);
      if (anchorIdx >= 0) {
        const insertAt = anchorIdx + anchor.length;
        return `${text.slice(0, insertAt)}${appendedBlock}${text.slice(insertAt)}`;
      }
    }
    return `${text.trimEnd()}\n${appendedBlock}`;
  }
  const contentStart = start + open.length;
  const closeIdx = text.indexOf(close, contentStart);
  if (closeIdx >= 0) {
    return (
      text.slice(0, contentStart) + "\n" + replacement.trimEnd() + "\n\n" + text.slice(closeIdx)
    );
  }
  const next = text.indexOf("/* ── imported:", contentStart);
  const end = next < 0 ? text.length : next;
  const rewritten = `${text.slice(0, contentStart)}\n${replacement.trimEnd()}\n\n${close}\n`;
  const suffix = next < 0 ? "" : text.slice(end);
  console.warn(`[lawmind-sync-renderer-css] ${marker}: backfilled missing end marker`);
  return `${rewritten}${suffix}`;
}

function main() {
  let text = fs.readFileSync(stylesPath, "utf8");
  for (const block of BLOCKS) {
    text = replaceImportedBlock(text, block.marker, buildBlock(block.marker, block.chunks));
  }
  fs.writeFileSync(stylesPath, text, "utf8");
  console.log(`[lawmind-sync-renderer-css] updated ${path.relative(process.cwd(), stylesPath)}`);
}

main();
