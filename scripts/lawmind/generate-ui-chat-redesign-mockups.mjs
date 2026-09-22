#!/usr/bin/env node
/**
 * Generate chat-page before/after mockup PNGs via Playwright.
 *
 * Usage (repo root):
 *   node scripts/lawmind/generate-ui-chat-redesign-mockups.mjs
 *
 * Or:
 *   pnpm lawmind:ui:chat-mockups
 *
 * Output:
 *   docs/assets/ui-chat-redesign/01-before-current.png
 *   docs/assets/ui-chat-redesign/02-after-target.png
 *   docs/assets/ui-chat-redesign/00-compare.png  (side-by-side)
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const mockDir = path.join(__dirname, "ui-chat-redesign");
const outDir = path.join(repoRoot, "docs/assets/ui-chat-redesign");
const desktopPkg = path.join(repoRoot, "apps/lawmind-desktop/package.json");

async function loadChromium() {
  const requireFromDesktop = createRequire(desktopPkg);
  try {
    return requireFromDesktop("playwright").chromium;
  } catch {
    try {
      return requireFromDesktop("@playwright/test").chromium;
    } catch (err) {
      console.error(
        "Cannot resolve playwright from apps/lawmind-desktop.\n" +
          "Run: pnpm install && pnpm --filter lawmind-desktop exec playwright install chromium",
      );
      throw err;
    }
  }
}

const WIDTH = 1440;
const HEIGHT = 900;

async function shot(page, htmlFile, outFile) {
  const url = pathToFileURL(htmlFile).href;
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(".frame").screenshot({ path: outFile, type: "png" });
  console.log("wrote", path.relative(repoRoot, outFile));
}

async function writeCompareHtml(beforePng, afterPng, outHtml) {
  const b = (await readFile(beforePng)).toString("base64");
  const a = (await readFile(afterPng)).toString("base64");
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>对话页 改前 / 改后</title>
<style>
  body{margin:0;background:#1c1b19;color:#f3efe8;font:14px/1.4 "PingFang SC",sans-serif}
  h1{margin:16px 20px 8px;font-size:18px}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px 16px 20px}
  figure{margin:0;background:#2a2825;border-radius:12px;overflow:hidden}
  figcaption{padding:10px 12px;font-weight:700}
  img{display:block;width:100%;height:auto}
</style></head><body>
<h1>LawMind 对话页 · 改前 / 改后对照</h1>
<div class="row">
  <figure><figcaption>改前 · 现状示意</figcaption>
    <img src="data:image/png;base64,${b}" alt="before" /></figure>
  <figure><figcaption>改后 · 目标</figcaption>
    <img src="data:image/png;base64,${a}" alt="after" /></figure>
</div>
</body></html>`;
  await writeFile(outHtml, html, "utf8");
}

async function main() {
  await access(desktopPkg);
  const chromium = await loadChromium();
  await mkdir(outDir, { recursive: true });
  const beforeHtml = path.join(mockDir, "before.html");
  const afterHtml = path.join(mockDir, "after.html");
  const beforeOut = path.join(outDir, "01-before-current.png");
  const afterOut = path.join(outDir, "02-after-target.png");
  const compareHtml = path.join(outDir, "00-compare.html");
  const compareOut = path.join(outDir, "00-compare.png");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await shot(page, beforeHtml, beforeOut);
    await shot(page, afterHtml, afterOut);
    await writeCompareHtml(beforeOut, afterOut, compareHtml);
    await page.setViewportSize({ width: 1600, height: 980 });
    await page.goto(pathToFileURL(compareHtml).href, { waitUntil: "networkidle" });
    await page.screenshot({ path: compareOut, type: "png", fullPage: true });
    console.log("wrote", path.relative(repoRoot, compareOut));
    console.log("wrote", path.relative(repoRoot, compareHtml));
  } finally {
    await browser.close();
  }
  console.log("\nDone. Open:");
  console.log(" ", path.relative(repoRoot, compareOut));
  console.log(" ", path.relative(repoRoot, compareHtml));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
