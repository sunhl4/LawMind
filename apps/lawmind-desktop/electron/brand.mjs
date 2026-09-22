/**
 * Desktop product brand — reads apps/lawmind-desktop/branding/manifest.json.
 * Next rebrand: change the manifest (and icon files it lists), then
 * `pnpm lawmind:desktop:brand`. Do not scatter new product-name literals.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDevUserDataDir } from "./lawmind-root.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const desktopRoot = path.resolve(__dirname, "..");

/** @typedef {{ productName: string, appId: string, devUserDataFolder: string, icons: Record<string, string>, svgCopies: string[] }} LawmindDesktopBrand */

/** @returns {LawmindDesktopBrand} */
export function loadDesktopBrand(root = desktopRoot) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "branding", "manifest.json"), "utf8"));
  if (typeof raw.productName !== "string" || !raw.productName.trim()) {
    throw new Error("branding/manifest.json missing productName");
  }
  return raw;
}

const brand = loadDesktopBrand();

export const LAWMIND_PRODUCT_NAME = brand.productName;
export const LAWMIND_APP_ID = brand.appId;

export function resolveRuntimeAppIconPath(electronDir = __dirname) {
  return path.join(electronDir, "icon.png");
}

/**
 * Keep unpackaged userData on the historical Electron folder so renaming
 * CFBundleName / app.setName does not migrate workspace or .env.lawmind.
 * @param {{ getPath: (name: string) => string, setPath: (name: string, p: string) => void, isPackaged?: boolean }} electronApp
 */
export function pinDevUserData(electronApp, { packaged = electronApp.isPackaged } = {}) {
  const target = resolveDevUserDataDir({
    appDataDir: electronApp.getPath("appData"),
    brandFolder: brand.devUserDataFolder,
    // 测试/开发可把应用状态整体隔离到临时目录；打包版忽略该变量（见 lawmind-root.mjs）。
    override: process.env.LAWMIND_USER_DATA_DIR,
    packaged,
  });
  if (!target) {
    return;
  }
  electronApp.setPath("userData", target);
}

export function applyProductName(electronApp, name = LAWMIND_PRODUCT_NAME) {
  electronApp.setName(name);
  if (typeof electronApp.setAboutPanelOptions === "function") {
    electronApp.setAboutPanelOptions({
      applicationName: name,
      applicationVersion: electronApp.getVersion?.() ?? "",
    });
  }
}
