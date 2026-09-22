#!/usr/bin/env node
/**
 * Insert sync markers into styles.css at cascade-safe anchors.
 * Contiguous module blocks get start + end markers; others get start only (sync skips until bounded).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesPath = path.resolve(__dirname, "../../apps/lawmind-desktop/src/renderer/styles.css");

/** @type {Array<{ marker: string, startNeedle: string, endNeedle?: string }>} */
const MARKERS = [
  {
    marker: "chat-split",
    startNeedle: "/* Messages ↔ compose (vertical drag) */",
    endNeedle: ".lm-side-collapsed {",
  },
  {
    marker: "desk-layout",
    startNeedle: "/* ── 在办整页（desk）：商用信息架构",
    endNeedle: ".lm-records-row-asst {",
  },
  {
    marker: "chat-workspace",
    startNeedle:
      "/* Chat: single flex child so messages + compose share height and wheel scroll targets .lm-messages */",
    endNeedle: ".lm-chat-workspace {",
  },
  {
    marker: "shell-header+chat-main",
    startNeedle: "/* 对话：从「文件」页引用的路径（发送时附加给模型） */",
  },
  {
    marker: "modal-forms",
    startNeedle: ".lm-help-panel {",
  },
  {
    marker: "workflow-hub+chat-compose",
    startNeedle: ".lm-requires-action-card {",
  },
];

function markerOpen(marker) {
  return `/* ── imported: ${marker} ── */`;
}

function markerClose(marker) {
  return `/* ── end imported: ${marker} ── */`;
}

function findRuleClose(lines, ruleStartIdx) {
  let depth = 0;
  for (let i = ruleStartIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
      }
    }
    if (depth === 0 && i > ruleStartIdx) {
      return i;
    }
  }
  return ruleStartIdx;
}

function insertAtLine(lines, idx, insertLines) {
  lines.splice(idx, 0, ...insertLines);
}

function ensureMarkerBlock(lines, { marker, startNeedle, endNeedle }) {
  const open = markerOpen(marker);
  if (lines.some((l) => l.includes(open))) {
    return;
  }

  const startIdx = lines.findIndex(
    (l) => l.includes(startNeedle) || l.trim() === startNeedle.trim(),
  );
  if (startIdx < 0) {
    throw new Error(`start anchor not found for ${marker}: ${startNeedle}`);
  }

  insertAtLine(lines, startIdx, [open, ""]);

  if (!endNeedle) {
    return;
  }

  const endRuleIdx = lines.findIndex(
    (l, i) => i > startIdx && l.trim().startsWith(endNeedle.trim()),
  );
  if (endRuleIdx < 0) {
    throw new Error(`end anchor not found for ${marker}: ${endNeedle}`);
  }
  const endIdx = findRuleClose(lines, endRuleIdx);
  const close = markerClose(marker);
  insertAtLine(lines, endIdx + 1, ["", close]);
}

function main() {
  const lines = fs.readFileSync(stylesPath, "utf8").split("\n");
  for (const spec of MARKERS) {
    ensureMarkerBlock(lines, spec);
  }
  fs.writeFileSync(stylesPath, lines.join("\n"), "utf8");
  console.log(
    `[lawmind-bootstrap-renderer-css-markers] inserted markers in ${path.relative(process.cwd(), stylesPath)}`,
  );
}

main();
