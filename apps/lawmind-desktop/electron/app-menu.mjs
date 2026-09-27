import { app, BrowserWindow, dialog, Menu } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceDir } from "./local-server.mjs";
import { LAWMIND_PRODUCT_NAME } from "./brand.mjs";
import { safeOpenExternal } from "./safe-shell-command.mjs";

const electronDir = path.dirname(fileURLToPath(import.meta.url));

/** Public download landing (browser). Override with env `LAWMIND_DOWNLOAD_PAGE_URL`. */
const DEFAULT_LAWMIND_DOWNLOAD_PAGE_URL =
  "https://cdn.jsdelivr.net/gh/sunhl4/LawMind@main/apps/lawmind-desktop/download/index.html";

export function resolveLawmindDownloadPageUrl() {
  const fromEnv = process.env.LAWMIND_DOWNLOAD_PAGE_URL?.trim();
  return fromEnv || DEFAULT_LAWMIND_DOWNLOAD_PAGE_URL;
}

let autoUpdaterSingleton = null;

async function loadAutoUpdater() {
  if (!app.isPackaged) {
    return null;
  }
  if (process.env.LAWMIND_SKIP_AUTO_UPDATE === "1") {
    return null;
  }
  if (!autoUpdaterSingleton) {
    const { autoUpdater } = await import("electron-updater");
    autoUpdaterSingleton = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  }
  return autoUpdaterSingleton;
}

export async function runAutoUpdateCheckWithNotify() {
  try {
    const autoUpdater = await loadAutoUpdater();
    if (!autoUpdater) {
      return;
    }
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    console.warn("[LawMind] auto-update:", e instanceof Error ? e.message : e);
  }
}

export async function checkUpdatesWithUi() {
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      type: "info",
      title: LAWMIND_PRODUCT_NAME,
      message: "这是开发版本，没有应用内更新。",
    });
    return;
  }
  if (process.env.LAWMIND_SKIP_AUTO_UPDATE === "1") {
    await dialog.showMessageBox({
      type: "info",
      title: LAWMIND_PRODUCT_NAME,
      message: "应用内更新已关闭。请向管理员索取安装包。",
    });
    return;
  }
  try {
    const autoUpdater = await loadAutoUpdater();
    if (!autoUpdater) {
      return;
    }
    const r = await autoUpdater.checkForUpdates();
    if (r?.isUpdateAvailable) {
      await dialog.showMessageBox({
        type: "info",
        title: LAWMIND_PRODUCT_NAME,
        message: `发现新版本 ${r.updateInfo.version}。将自动下载；下载完成后会通知您，退出应用时可完成安装。`,
      });
      return;
    }
    await dialog.showMessageBox({
      type: "info",
      title: LAWMIND_PRODUCT_NAME,
      message: "当前已是最新版本。",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[LawMind] check for updates:", msg);
    await dialog.showMessageBox({
      type: "warning",
      title: LAWMIND_PRODUCT_NAME,
      message: "这次没能检查更新。请稍后再试，或从下载页获取安装包。",
    });
  }
}

/** Dev renderer origin (Vite). Shared by window load and the will-navigate guard. */
export function resolveLawmindDevServerUrl() {
  return process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5174";
}

export async function loadRendererIntoWindow(win, hash = "") {
  const devUrl = resolveLawmindDevServerUrl();
  const distIndex = path.join(electronDir, "..", "dist", "index.html");
  const useDistInE2e =
    process.env.LAWMIND_E2E === "1" && fs.existsSync(distIndex);
  if (!app.isPackaged && !useDistInE2e) {
    const url = hash ? `${devUrl}/#${hash}` : devUrl;
    await win.loadURL(url);
    return;
  }
  const indexPath = useDistInE2e ? distIndex : path.join(electronDir, "..", "dist", "index.html");
  if (hash) {
    await win.loadFile(indexPath, { hash });
  } else {
    await win.loadFile(indexPath);
  }
}

export function setupApplicationMenu() {
  const isMac = process.platform === "darwin";
  const sendFileMenu = (action) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    win?.webContents.send("lawmind:file-menu", { action });
  };
  const fileSubmenu = [
    {
      label: "保存",
      accelerator: "CommandOrControl+S",
      click: () => {
        sendFileMenu("save");
      },
    },
    {
      label: "另存为…",
      accelerator: "Shift+CommandOrControl+S",
      click: () => {
        sendFileMenu("save-as");
      },
    },
  ];
  const viewSubmenu = [
    ...(app.isPackaged
      ? []
      : [
          { role: "reload", label: "重新载入" },
          { role: "toggleDevTools", label: "开发者工具" },
          { type: "separator" },
        ]),
    { role: "resetZoom", label: "实际大小" },
    { role: "zoomIn", label: "放大" },
    { role: "zoomOut", label: "缩小" },
  ];
  const template = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        { label: "文件", submenu: fileSubmenu },
        {
          label: "编辑",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
          ],
        },
        {
          label: "显示",
          submenu: viewSubmenu,
        },
        {
          label: "帮助",
          submenu: [
            {
              label: "检查更新…",
              click: () => {
                void checkUpdatesWithUi();
              },
            },
            {
              label: "下载安装包…",
              click: () => {
                void safeOpenExternal(resolveLawmindDownloadPageUrl(), workspaceDir);
              },
            },
          ],
        },
        { label: "窗口", submenu: [{ role: "minimize", label: "最小化" }, { role: "zoom", label: "缩放" }, { type: "separator" }, { role: "front", label: "全部置于顶层" }] },
      ]
    : [
        { label: "文件", submenu: [...fileSubmenu, { type: "separator" }, { role: "quit", label: "退出" }] },
        {
          label: "编辑",
          submenu: [
            { role: "undo", label: "撤销" },
            { role: "redo", label: "重做" },
            { type: "separator" },
            { role: "cut", label: "剪切" },
            { role: "copy", label: "复制" },
            { role: "paste", label: "粘贴" },
          ],
        },
        { label: "显示", submenu: viewSubmenu },
        {
          label: "帮助",
          submenu: [
            {
              label: "检查更新…",
              click: () => {
                void checkUpdatesWithUi();
              },
            },
            {
              label: "下载安装包…",
              click: () => {
                void safeOpenExternal(resolveLawmindDownloadPageUrl(), workspaceDir);
              },
            },
          ],
        },
        { label: "窗口", submenu: [{ role: "minimize", label: "最小化" }, { role: "close", label: "关闭" }] },
      ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
