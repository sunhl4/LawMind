#!/usr/bin/env node
/**
 * Generate 在办 Desk V3 (Decision Ceremony) mockup PNGs via Playwright (Retina).
 *
 * Usage:
 *   pnpm lawmind:ui:agents-desk-v3-mockups
 *   LAWMIND_UI_DPR=2 pnpm lawmind:ui:agents-desk-v3-mockups
 */
import { mkdir, access, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const mockDir = path.join(__dirname, "ui-agents-desk-v3");
const outDir = path.join(repoRoot, "docs/assets/ui-agents-desk-v3");
const v2Out = path.join(repoRoot, "docs/assets/ui-agents-desk-v2/02-inbox-focus.png");
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
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "networkidle" });
  await page.locator(".frame").screenshot({
    path: outFile,
    type: "png",
    animations: "disabled",
  });
  console.log(
    "wrote",
    path.relative(repoRoot, outFile),
    `(${WIDTH * DPR}×${HEIGHT * DPR} @${DPR}x)`,
  );
}

async function writeCompareHtml(outHtml, hasV2) {
  const leftSrc = hasV2 ? "../ui-agents-desk-v2/02-inbox-focus.png" : "./02-clear-desk.png";
  const leftCap = hasV2 ? "V2 · Inbox 双栏（仍偏保守）" : "V3 · Clear Desk";
  await writeFile(
    outHtml,
    `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>在办 · V2 Inbox vs V3 Ceremony</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; background: #1c1b19; color: #f3efe8;
      font: 15px/1.4 "PingFang SC", sans-serif;
    }
    h1 { margin: 20px 24px 8px; font-size: 20px; }
    .sub { margin: 0 24px 12px; color: #b8aea0; font-size: 13px; }
    .row {
      display: grid;
      grid-template-columns: ${WIDTH}px ${WIDTH}px;
      gap: 16px;
      padding: 12px 24px 28px;
      width: ${WIDTH * 2 + 16 + 48}px;
    }
    figure {
      margin: 0; width: ${WIDTH}px; background: #2a2825;
      border-radius: 12px; overflow: hidden;
    }
    figcaption { padding: 12px 14px; font-weight: 700; font-size: 14px; }
    img {
      display: block; width: ${WIDTH}px; height: ${HEIGHT}px;
      object-fit: fill;
    }
  </style>
</head>
<body>
  <h1>LawMind 在办 · 跳出旧壳：V2 Inbox → V3 Ceremony（${DPR}×）</h1>
  <p class="sub">左侧仍是侧栏+列表+详情；右侧是 Superhuman/DocuSign 式全屏签批仪式（队列默认隐身）</p>
  <div class="row">
    <figure>
      <figcaption>${leftCap}</figcaption>
      <img src="${leftSrc}" width="${WIDTH}" height="${HEIGHT}" alt="left" />
    </figure>
    <figure>
      <figcaption>V3 · Decision Ceremony（推荐）</figcaption>
      <img src="./01-ceremony-focus.png" width="${WIDTH}" height="${HEIGHT}" alt="ceremony" />
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

  let hasV2 = true;
  try {
    await access(v2Out);
  } catch {
    hasV2 = false;
  }

  const ceremonyHtml = path.join(mockDir, "ceremony-focus.html");
  const clearHtml = path.join(mockDir, "clear-desk.html");
  const ceremonyOut = path.join(outDir, "01-ceremony-focus.png");
  const clearOut = path.join(outDir, "02-clear-desk.png");
  const compareHtml = path.join(outDir, "00-compare.html");
  const compareOut = path.join(outDir, "00-compare.png");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: DPR,
  });
  const page = await context.newPage();
  try {
    await shot(page, ceremonyHtml, ceremonyOut);
    await shot(page, clearHtml, clearOut);
    await writeCompareHtml(compareHtml, hasV2);

    const compareW = WIDTH * 2 + 16 + 48;
    const compareH = HEIGHT + 140;
    await page.setViewportSize({ width: compareW, height: compareH });
    await page.goto(pathToFileURL(compareHtml).href, { waitUntil: "networkidle" });
    await page.screenshot({
      path: compareOut,
      type: "png",
      fullPage: true,
      animations: "disabled",
    });
    console.log("wrote", path.relative(repoRoot, compareOut), `(@${DPR}x)`);
    console.log("wrote", path.relative(repoRoot, compareHtml));
  } finally {
    await browser.close();
  }
  console.log("\nDone. Open docs/assets/ui-agents-desk-v3/00-compare.png");
  console.log("Design: docs/LAWMIND-DESKTOP-UI.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
