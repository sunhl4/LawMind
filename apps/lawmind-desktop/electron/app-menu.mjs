import { app, BrowserWindow, dialog, Menu } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceDir } from "./local-server.mjs";
import { LAWMIND_PRODUCT_NAME } from "./brand.mjs";
import { safeOpenExternal } from "./safe-shell-command.mjs";
import {
  APP_UPDATE_STATUS,
  appUpdateUnsupportedReason,
  getAppUpdateController,
  setAppUpdateConfirmInstall,
  setAppUpdateElectronApp,
  setAppUpdateShowProgress,
} from "./app-updates.mjs";

// 更新模块通过全局引用判 packaged（保持可测试）。app-menu 静态 import 了 electron，
// 由这里注入引用。
setAppUpdateElectronApp(app);

const electronDir = path.dirname(fileURLToPath(import.meta.url));

/** Public download landing (browser). Override with env `LAWMIND_DOWNLOAD_PAGE_URL`. */
const DEFAULT_LAWMIND_DOWNLOAD_PAGE_URL =
  "https://cdn.jsdelivr.net/gh/sunhl4/LawMind@main/apps/lawmind-desktop/download/index.html";

export function resolveLawmindDownloadPageUrl() {
  const fromEnv = process.env.LAWMIND_DOWNLOAD_PAGE_URL?.trim();
  return fromEnv || DEFAULT_LAWMIND_DOWNLOAD_PAGE_URL;
}

function focusedWindowOrAny() {
  return (
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  );
}

/** 「更新」药丸/已就绪态 → Cursor 式「重启并安装」确认框。返回是否确认。 */
async function confirmRestartToUpdate(state) {
  const version = state?.version ? ` ${state.version}` : "";
  const message = `新版${version} 已下载完毕。重启 LawMind 即可完成安装。`;
  const detail =
    "现在重启会先退出应用，安装完成后会自动重新打开。重启前请先保存尚未保存的改动；稍后也可以在退出时自动安装。";
  const win = focusedWindowOrAny();
  const opts = {
    type: "info",
    title: LAWMIND_PRODUCT_NAME,
    buttons: ["立即重启安装", "稍后"],
    defaultId: 0,
    cancelId: 1,
    message,
    detail,
  };
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return r.response === 0;
}

/** 下载中的进度说明框（点药丸时看到真实进度）。 */
async function showDownloadProgress(state) {
  const version = state?.version ? ` ${state.version}` : "";
  const percent =
    typeof state?.percent === "number" ? `${Math.round(state.percent)}%` : "进行中";
  const message = `新版${version} 正在后台下载（${percent}）。`;
  const detail = "下载完成后，左下角会出现金色的「更新」按钮；届时点击即可重启安装。";
  const win = focusedWindowOrAny();
  const opts = {
    type: "info",
    title: LAWMIND_PRODUCT_NAME,
    buttons: ["好"],
    message,
    detail,
  };
  if (win) {
    await dialog.showMessageBox(win, opts);
  } else {
    await dialog.showMessageBox(opts);
  }
}

setAppUpdateConfirmInstall(confirmRestartToUpdate);
setAppUpdateShowProgress(showDownloadProgress);

export async function checkUpdatesWithUi() {
  const disabled = appUpdateUnsupportedReason();
  if (disabled) {
    await dialog.showMessageBox({
      type: "info",
      title: LAWMIND_PRODUCT_NAME,
      message: disabled,
    });
    return;
  }

  try {
    const controller = getAppUpdateController();
    // 已下载/下载中不要再触发一次检查：那会把药丸从「就绪」打回「下载中」，
    // 还可能重复下载。直接给重启或进度。
    const current = controller.uiState();
    if (current.status === APP_UPDATE_STATUS.downloaded) {
      if (await confirmRestartToUpdate(current)) {
        controller.installNow();
      }
      return;
    }
    if (current.status === APP_UPDATE_STATUS.downloading) {
      await showDownloadProgress(current);
      return;
    }

    await controller.checkSilently();
    const state = controller.uiState();
    if (state.status === APP_UPDATE_STATUS.downloaded) {
      // 已就绪：直接给「重启并安装」。
      if (await confirmRestartToUpdate(state)) {
        controller.installNow();
      }
      return;
    }
    if (state.status === APP_UPDATE_STATUS.downloading) {
      await showDownloadProgress(state);
      return;
    }
    if (state.status === APP_UPDATE_STATUS.available) {
      await dialog.showMessageBox({
        type: "info",
        title: LAWMIND_PRODUCT_NAME,
        message: `发现新版本 ${state.version}，已开始后台下载。`,
        detail: "下载完成后左下角会出现「更新」按钮，点击即可安装；退出应用时也会自动安装。",
      });
      return;
    }
    if (state.status === APP_UPDATE_STATUS.unsupported) {
      await dialog.showMessageBox({
        type: "warning",
        title: LAWMIND_PRODUCT_NAME,
        message: "应用内更新当前不可用。请从下载页获取安装包。",
        detail: state.error || undefined,
      });
      return;
    }
    if (state.status === APP_UPDATE_STATUS.error) {
      await dialog.showMessageBox({
        type: "warning",
        title: LAWMIND_PRODUCT_NAME,
        message: "这次没能检查更新。请稍后再试，或从下载页获取安装包。",
        detail: state.error || undefined,
      });
      return;
    }
    await dialog.showMessageBox({
      type: "info",
      title: LAWMIND_PRODUCT_NAME,
      message: "当前已是最新版本。",
    });
  } catch (e) {
    console.warn(
      "[LawMind] check for updates:",
      e instanceof Error ? e.message : e,
    );
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
