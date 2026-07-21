#!/usr/bin/env node
import { mkdir, access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const mockDir = path.join(__dirname, "ui-agents-desk-v4");
const outDir = path.join(repoRoot, "docs/assets/ui-agents-desk-v4");
const desktopPkg = path.join(repoRoot, "apps/lawmind-desktop/package.json");
const WIDTH = 1440;
const HEIGHT = 900;
const DPR = 3;

async function loadChromium() {
  const requireFromDesktop = createRequire(desktopPkg);
  try {
    return requireFromDesktop("playwright").chromium;
  } catch {
    return requireFromDesktop("@playwright/test").chromium;
  }
}

async function main() {
  await access(desktopPkg);
  const chromium = await loadChromium();
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: DPR,
  });
  const page = await context.newPage();
  try {
    const html = path.join(mockDir, "workbench.html");
    const out = path.join(outDir, "01-workbench.png");
    await page.goto(pathToFileURL(html).href, { waitUntil: "networkidle" });
    await page.locator(".frame").screenshot({ path: out, type: "png", animations: "disabled" });
    console.log("wrote", path.relative(repoRoot, out));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
