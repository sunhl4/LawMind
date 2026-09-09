#!/usr/bin/env node
/**
 * Generate 在办 Desk V2 before/after mockup PNGs via Playwright (Retina 2×).
 *
 * Usage (repo root):
 *   pnpm lawmind:ui:agents-desk-mockups
 *   node scripts/lawmind/generate-ui-agents-desk-mockups.mjs
 *
 * Optional (override density; default 3×):
 *   LAWMIND_UI_DPR=2 pnpm lawmind:ui:agents-desk-mockups
 */
import { mkdir, access } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const mockDir = path.join(__dirname, "ui-agents-desk-v2");
const outDir = path.join(repoRoot, "docs/assets/ui-agents-desk-v2");
const desktopPkg = path.join(repoRoot, "apps/lawmind-desktop/package.json");

const WIDTH = 1440;
const HEIGHT = 900;
const DPR = Math.max(1, Number(process.env.LAWMIND_UI_DPR || 3) || 3);

async function loadChromium() {
  const requireFromDesktop = createRequire(desktopPkg);
  try {
    return requireFromDesktop("playwright").chromium;
  } catch {
    return requireFromDesktop("@playwright/test").chromium;
  }
}

async function shot(page, htmlFile, outFile) {
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "networkidle" });
  await page.locator(".frame").screenshot({
    path: outFile,
    type: "png",
    // Omit animations; keep full pixel density from deviceScaleFactor.
    animations: "disabled",
  });
  console.log(
    "wrote",
    path.relative(repoRoot, outFile),
    `(${WIDTH * DPR}×${HEIGHT * DPR} @${DPR}x)`,
  );
}

async function writeCompareHtml(outHtml) {
  // Reference sibling PNGs by relative URL (no base64) so compare stays crisp at 1:1 CSS size.
  await writeFile(
    outHtml,
    `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>在办 · 现状 / Decision Inbox</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #1c1b19;
      color: #f3efe8;
      font: 15px/1.4 "PingFang SC", "Hiragino Sans GB", sans-serif;
    }
    h1 { margin: 20px 24px 10px; font-size: 20px; letter-spacing: -0.02em; }
    .row {
      display: grid;
      grid-template-columns: ${WIDTH}px ${WIDTH}px;
      gap: 16px;
      padding: 12px 24px 28px;
      width: ${WIDTH * 2 + 16 + 48}px;
    }
    figure {
      margin: 0;
      width: ${WIDTH}px;
      background: #2a2825;
      border-radius: 12px;
      overflow: hidden;
    }
    figcaption { padding: 12px 14px; font-weight: 700; font-size: 14px; }
    img {
      display: block;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      object-fit: fill;
      image-rendering: -webkit-optimize-contrast;
    }
  </style>
</head>
<body>
  <h1>LawMind 在办 · 现状问题 vs Decision Inbox 目标（${DPR}× Retina）</h1>
  <div class="row">
    <figure>
      <figcaption>现状 · 等权双栏 / 多 Tab</figcaption>
      <img src="./01-current-pain.png" width="${WIDTH}" height="${HEIGHT}" alt="current" />
    </figure>
    <figure>
      <figcaption>目标 · 待我确认 Inbox + Focus Stage</figcaption>
      <img src="./02-inbox-focus.png" width="${WIDTH}" height="${HEIGHT}" alt="target" />
    </figure>
  </div>
</body>
</html>
`,
    "utf8",
  );
}

async function main() {
  await access(desktopPkg);
  const chromium = await loadChromium();
  await mkdir(outDir, { recursive: true });

  const beforeHtml = path.join(mockDir, "current-pain.html");
  const afterHtml = path.join(mockDir, "inbox-focus.html");
  const beforeOut = path.join(outDir, "01-current-pain.png");
  const afterOut = path.join(outDir, "02-inbox-focus.png");
  const compareHtml = path.join(outDir, "00-compare.html");
  const compareOut = path.join(outDir, "00-compare.png");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: DPR,
  });
  const page = await context.newPage();
  try {
    await shot(page, beforeHtml, beforeOut);
    await shot(page, afterHtml, afterOut);
    await writeCompareHtml(compareHtml);

    // Compare at 1:1 CSS size of each panel so PNGs are not downscaled before capture.
    const compareW = WIDTH * 2 + 16 + 48;
    const compareH = HEIGHT + 120;
    await page.setViewportSize({ width: compareW, height: compareH });
    await page.goto(pathToFileURL(compareHtml).href, { waitUntil: "networkidle" });
    await page.screenshot({
      path: compareOut,
      type: "png",
      fullPage: true,
      animations: "disabled",
    });
    console.log("wrote", path.relative(repoRoot, compareOut), `(@${DPR}x, panels 1:1)`);
    console.log("wrote", path.relative(repoRoot, compareHtml));
  } finally {
    await browser.close();
  }
  console.log("\nDone. Open docs/assets/ui-agents-desk-v2/00-compare.png");
  console.log(
    "Design tokens: apps/lawmind-desktop/src/renderer/styles.css (historical UI doc: docs/archive/LAWMIND-DESKTOP-UI.md).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
