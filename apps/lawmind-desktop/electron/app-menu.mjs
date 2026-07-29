import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __electronDir = path.dirname(fileURLToPath(import.meta.url));

/** Public download landing (browser). Override with env `LAWMIND_DOWNLOAD_PAGE_URL`. */
const DEFAULT_LAWMIND_DOWNLOAD_PAGE_URL =
  "https://cdn.jsdelivr.net/gh/lawmind/lawmind@main/apps/lawmind-desktop/download/index.html";

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
      title: "LawMind",
      message: "当前为开发构建，请使用菜单「下载安装包」页面获取正式版本。",
    });
    return;
  }
  if (process.env.LAWMIND_SKIP_AUTO_UPDATE === "1") {
    await dialog.showMessageBox({
      type: "info",
      title: "LawMind",
      message: "已按环境变量关闭应用内更新，请联系管理员获取安装包。",
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
        title: "LawMind",
        message: `发现新版本 ${r.updateInfo.version}。将自动下载；下载完成后会通知您，退出应用时可完成安装。`,
      });
      return;
    }
    await dialog.showMessageBox({
      type: "info",
      title: "LawMind",
      message: "当前已是最新版本。",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await dialog.showMessageBox({
      type: "warning",
      title: "LawMind",
      message: `检查更新失败：${msg}`,
    });
  }
}

export async function loadRendererIntoWindow(win, hash = "") {
  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5174";
  const distIndex = path.join(__electronDir, "..", "dist", "index.html");
  const useDistInE2e =
    process.env.LAWMIND_E2E === "1" && fs.existsSync(distIndex);
  if (!app.isPackaged && !useDistInE2e) {
    const url = hash ? `${devUrl}/#${hash}` : devUrl;
    await win.loadURL(url);
    return;
  }
  const indexPath = useDistInE2e ? distIndex : path.join(__electronDir, "..", "dist", "index.html");
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
      label: "Save",
      accelerator: "CommandOrControl+S",
      click: () => {
        sendFileMenu("save");
      },
    },
    {
      label: "Save As…",
      accelerator: "Shift+CommandOrControl+S",
      click: () => {
        sendFileMenu("save-as");
      },
    },
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
        { label: "File", submenu: fileSubmenu },
        {
          label: "Edit",
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
          label: "View",
          submenu: [
            { role: "reload" },
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
          ],
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
                void shell.openExternal(resolveLawmindDownloadPageUrl());
              },
            },
          ],
        },
        { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] },
      ]
    : [
        { label: "File", submenu: [...fileSubmenu, { type: "separator" }, { role: "quit" }] },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
          ],
        },
        { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }] },
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
                void shell.openExternal(resolveLawmindDownloadPageUrl());
              },
            },
          ],
        },
        { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
      ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
