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
    chunks: [{ file: "chat.css", start: 1, end: 117 }],
  },
  {
    marker: "desk-layout",
    chunks: [{ file: "desk-layout.css" }],
  },
  {
    marker: "chat-workspace",
    // Keep this slice closed: must include full `.lm-assignment-applied-check .lm-md-code` rule.
    chunks: [{ file: "chat.css", start: 119, end: 134 }],
  },
  {
    marker: "shell-header+chat-main",
    // Keep closed through `.lm-compose-ctx-usage-meter-fill--danger` (do not cut mid-rule).
    // 注意：chat.css 的行号会随编辑漂移；切点必须落在规则边界上，
    // 否则 buildBlock 断言会报出“ends mid-rule”。下一块从 1195 续，二者相接不跳行。
    chunks: [{ file: "shell-header.css" }, { file: "chat.css", start: 136, end: 1194 }],
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
    // 与上一块相接（上一块切到 1194），从 1195 起，不跳行、不切在规则中间。
    chunks: [{ file: "workflow-hub.css" }, { file: "chat.css", start: 1195 }],
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

/**
 * 括号深度（字符串/注释感知）。与 `scripts/lawmind/check-renderer-css.mjs` 同一口径。
 * 同步切片是**按行号**做的：一旦切点落在规则中间，生成的 styles.css 就会
 * 少一个 `}`、下一块多一个 `}`——CI 会红，但排查要手工算行号。
 */
function braceDepth(text) {
  let depth = 0;
  let inString = false;
  let stringQuote = "";
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
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
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
    }
  }
  return depth;
}

function describeChunk(chunk) {
  const range =
    chunk.start == null && chunk.end == null ? "全部" : `${chunk.start ?? 1}–${chunk.end ?? "末"}`;
  return `${chunk.file}[${range}]`;
}

/**
 * 逐 chunk 累计深度，定位是哪一段把切点切在了规则中间。
 * 返回 null 表示该块平衡。
 */
function findUnbalancedBlock(marker, chunks) {
  let depth = 0;
  let openedAt = null;
  for (const chunk of chunks) {
    const text = stripModuleBanner(readLines(chunk.file, chunk.start, chunk.end)).join("");
    for (const ch of text) {
      if (ch === "{") {
        depth++;
        if (depth === 1) {
          openedAt = chunk;
        }
      } else if (ch === "}") {
        depth--;
      }
    }
  }
  if (depth === 0) {
    return null;
  }
  return { marker, depth, openedAt };
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

function buildExpectedText() {
  let text = fs.readFileSync(stylesPath, "utf8");
  for (const block of BLOCKS) {
    text = replaceImportedBlock(text, block.marker, buildBlock(block.marker, block.chunks));
  }
  return text;
}

/** 按 marker 切出各块，用于在陈旧时报出「哪一块与源不一致」。 */
function splitImportedBlocks(text) {
  const blocks = new Map();
  for (const marker of BLOCKS.map((b) => b.marker)) {
    const open = `/* ── imported: ${marker} ── */`;
    const close = `/* ── end imported: ${marker} ── */`;
    const start = text.indexOf(open);
    if (start < 0) {
      continue;
    }
    const end = text.indexOf(close, start + open.length);
    blocks.set(marker, end < 0 ? text.slice(start) : text.slice(start, end + close.length));
  }
  return blocks;
}

function reportStaleBlocks(currentText, expectedText) {
  const current = splitImportedBlocks(currentText);
  const expected = splitImportedBlocks(expectedText);
  const stale = [];
  for (const [marker, want] of expected) {
    const have = current.get(marker);
    if (have !== want) {
      stale.push(marker);
    }
  }
  return stale;
}

function main() {
  const checkOnly = process.argv.includes("--check");

  // 先校验再写：宁可不同步，也不要写出少 `}` / 多 `}` 的 styles.css。
  // 切片按行号做，改上游 CSS 很容易把切点顶到规则中间；在这里失败，
  // 报出的就是「哪一块、哪一段、深度多少」，不必再去手工算行号。
  const unbalanced = BLOCKS.map((block) => findUnbalancedBlock(block.marker, block.chunks)).filter(
    (row) => row !== null,
  );
  if (unbalanced.length > 0) {
    console.error("[lawmind-sync-renderer-css] 拒绝写入：切片切在规则中间");
    for (const row of unbalanced) {
      const where = row.openedAt ? `；最后打开的规则来自 ${describeChunk(row.openedAt)}` : "";
      console.error(
        `  - 块 "${row.marker}" 括号深度 ${row.depth}（应为 0）${where}\n` +
          `    请把该块的 chat.css start/end 调到规则边界（` +
          `上一块的 end 应为「最后一个完整规则的 }」所在行，下一块的 start 取其后一行）。`,
      );
    }
    process.exit(1);
  }

  const currentText = fs.readFileSync(stylesPath, "utf8");
  const expectedText = buildExpectedText();

  const finalDepth = braceDepth(expectedText);
  if (finalDepth !== 0) {
    console.error(
      `[lawmind-sync-renderer-css] 拒绝写入：合并后括号深度 ${finalDepth}（应为 0），styles.css 会损坏。`,
    );
    process.exit(1);
  }

  if (checkOnly) {
    if (currentText === expectedText) {
      console.log("[lawmind-sync-renderer-css] styles.css 与源模块一致");
      return;
    }
    const stale = reportStaleBlocks(currentText, expectedText);
    console.error(
      "[lawmind-sync-renderer-css] styles.css 已陈旧：源模块改过但未同步。\n" +
        `  不一致的块：${stale.length > 0 ? stale.join("、") : "（块外内容）"}\n` +
        "  修复：pnpm lawmind:sync:renderer-css",
    );
    process.exit(1);
  }

  fs.writeFileSync(stylesPath, expectedText, "utf8");
  console.log(`[lawmind-sync-renderer-css] updated ${path.relative(process.cwd(), stylesPath)}`);
}

main();
