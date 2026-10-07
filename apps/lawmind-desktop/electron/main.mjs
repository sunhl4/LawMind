import { app, BrowserWindow, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installLawmindContentSecurityPolicy } from "./session-config.mjs";
import { createFsBridge } from "./fs-bridge.mjs";
import {
  ensureBackend,
  killLocalServer,
  getAllowedRoots,
  spawnWorkspaceDaemon,
  workspaceDir,
} from "./local-server.mjs";
import { safeOpenExternal } from "./safe-shell-command.mjs";
import {
  setupApplicationMenu,
  loadRendererIntoWindow,
  resolveLawmindDevServerUrl,
  runAutoUpdateCheckWithNotify,
} from "./app-menu.mjs";
import { registerIpcHandlers } from "./ipc-handlers.mjs";
import {
  isAllowedMainWindowNavigationUrl,
  isAuxPopoutWindowUrl,
  isDevToolsWindowUrl,
  shouldKeepLocalServerAlive,
} from "./app-windows.mjs";
import {
  installAppRendererProcessGoneHandler,
  installRendererRecovery,
} from "./renderer-recovery.mjs";
import {
  LAWMIND_PRODUCT_NAME,
  applyProductName,
  pinDevUserData,
  resolveRuntimeAppIconPath,
} from "./brand.mjs";
import { ignoreBrokenPipe } from "./child-log-forward.mjs";

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appIconPath = resolveRuntimeAppIconPath(__dirname);
applyProductName(app);
pinDevUserData(app);

/** @type {import("electron").BrowserWindow | null} */
let mainWindowRef = null;

/** @type {Map<string, import("electron").BrowserWindow>} */
const auxWindows = new Map();

const fsBridge = createFsBridge(getAllowedRoots);

function windowUrl(win) {
  try {
    return win.webContents.getURL();
  } catch {
    return "";
  }
}

function isDevToolsWindow(win) {
  return Boolean(win) && !win.isDestroyed() && isDevToolsWindowUrl(windowUrl(win));
}

function listAppWindows() {
  return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed() && !isDevToolsWindow(win));
}

function findReusableMainWindow() {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    return mainWindowRef;
  }
  return listAppWindows().find((win) => !isAuxPopoutWindowUrl(windowUrl(win))) ?? null;
}

function focusExistingWindow(win) {
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
}

function installIpcHandlers() {
  registerIpcHandlers({
    getMainWindowRef: () => mainWindowRef,
    auxWindows,
    fsBridge,
  });
}

function denyInAppWindowOpen(contents) {
  // target=_blank / window.open to http(s) must open in the system browser, not an in-app window (often blank).
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === "http:" || u.protocol === "https:") {
        void safeOpenExternal(url, workspaceDir);
        return { action: "deny" };
      }
    } catch {
      /* ignore bad URLs */
    }
    return { action: "deny" };
  });
}

function denyUnexpectedMainWindowNavigation(contents) {
  // will-navigate：同窗口导航可把远程页面装进带 preload 的主窗口（token + fs 桥随之暴露）。
  // 只允许预期 origin（packaged file:// dist / dev Vite loopback 端口），其余一律拦下。
  // 程序化 loadURL/loadFile 不触发 will-navigate，正常加载不受影响。
  const distIndexPath = path.join(__dirname, "..", "dist", "index.html");
  contents.on("will-navigate", (event, url) => {
    if (
      isAllowedMainWindowNavigationUrl(url, {
        devServerUrl: resolveLawmindDevServerUrl(),
        distIndexPath,
      })
    ) {
      return;
    }
    event.preventDefault();
  });
}

async function createWindow() {
  const existing = findReusableMainWindow();
  if (existing) {
    mainWindowRef = existing;
    focusExistingWindow(existing);
    return;
  }

  await ensureBackend();

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 720,
    title: LAWMIND_PRODUCT_NAME,
    icon: appIconPath,
    autoHideMenuBar: true,
    webPreferences: {
      // CommonJS preload is more reliable than .mjs across Electron versions.
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Dev (http://127.0.0.1:Vite): sandbox off avoids preload/contextBridge issues on some Electron+Vite setups. Packaged app uses file:// with sandbox on.
      sandbox: app.isPackaged,
    },
  });

  installLawmindContentSecurityPolicy(session.defaultSession, { dev: !app.isPackaged });

  mainWindowRef = mainWindow;
  mainWindow.on("closed", () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
  });

  denyInAppWindowOpen(mainWindow.webContents);
  denyUnexpectedMainWindowNavigation(mainWindow.webContents);
  installRendererRecovery(mainWindow, (win, hash) => loadRendererIntoWindow(win, hash));

  await loadRendererIntoWindow(mainWindow);
  // Never auto-open *detached* DevTools: that window is easy to mistake for a
  // new chat, and closing it can kill the local API (see window-all-closed).
  // Opt-in docked tools: LAWMIND_DEVTOOLS=1. View → Toggle Developer Tools always works.
  if (!app.isPackaged && process.env.LAWMIND_E2E !== "1" && process.env.LAWMIND_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "bottom" });
  }
}

/**
 * 单实例锁：同一 userData 只允许一个应用实例。
 *
 * ## 为什么必须有（2026-09-21 实测故障）
 *
 * Word 的侧载清单把回环端口**钉死**在文件里（生成时按实际 `Host` 替换，但律师存盘后
 * 就不再变化）。允许第二个实例启动时：它会发现持久化端口被占（第一个实例还活着），
 * 于是 `pickPort` **静默**回退到随机端口 —— 此后所有已侧载的 Word 窗格全部失联，
 * 而且窗格**无处重新发现**新端口（发现端点 /.well-known/lawmind-local 也挂在旧 base 上）。
 * 现场表现：窗格先报 `unauthorized`（旧令牌），服务换端口后变成 `Load failed`。
 *
 * 同一 userData 下的多实例还有另外两处已踩过的坑：共享的 CLI 凭据发现文件被先退出的
 * 实例删掉（已加 instanceId 比对缓解）、以及两个实例争同一个工作区（AGENTS.md 明令禁止）。
 *
 * ## dev 逃生阀
 *
 * `LAWMIND_ALLOW_MULTI_INSTANCE=1`（仅非打包态生效）：少数确实要开两个实例的调试场景。
 * 此时端口漂移的风险由使用者承担 —— 启动会打一行醒目警告，且漂移仍会记进体检面板。
 *
 * E2E 不受影响：`requestSingleInstanceLock` 的锁基于 userData 路径，而 E2E 用
 * `LAWMIND_USER_DATA_DIR` 给每个实例独立目录，因此各自拿得到锁。
 */
const allowMultiInstance = !app.isPackaged && process.env.LAWMIND_ALLOW_MULTI_INSTANCE === "1";
const singleInstanceOk = allowMultiInstance || app.requestSingleInstanceLock();
if (allowMultiInstance) {
  console.warn(
    "[LawMind] LAWMIND_ALLOW_MULTI_INSTANCE=1：已关闭单实例锁。若已有实例在跑，本实例可能被迫换端口，导致 Word 加载项的侧载清单失联。",
  );
}
if (!singleInstanceOk) {
  // 第二个实例：不抢端口、不动共享的凭据文件，把已有窗口叫到前台后退出。
  console.warn("[LawMind] 已有实例在运行（同一数据目录），本实例退出。");
  app.quit();
}

void app.whenReady().then(async () => {
  if (!singleInstanceOk) {
    return;
  }
  try {
    if (process.platform === "darwin" && app.dock) {
      app.dock.setIcon(appIconPath);
    }
    installIpcHandlers();
    setupApplicationMenu();
    installAppRendererProcessGoneHandler(() => createWindow());
    await createWindow();
    if (process.env.LAWMIND_E2E !== "1" && process.env.LAWMIND_SKIP_AUTO_UPDATE !== "1") {
      setTimeout(() => {
        void runAutoUpdateCheckWithNotify();
      }, 12_000);
    }
  } catch (err) {
    console.error("[LawMind] startup failed:", err);
    // Do not quit immediately — retry once so a transient Vite/port race does not kill the app.
    try {
      await createWindow();
    } catch (retryErr) {
      console.error("[LawMind] startup retry failed:", retryErr);
      app.quit();
    }
  }
});

if (singleInstanceOk) {
  // 第二实例被拒时 Electron 会带上它的 argv 触发这个事件 —— 用户以为「没打开」，
  // 其实是已有窗口在后台。把它叫到前台，别让律师对着 Dock 反复点。
  app.on("second-instance", () => {
    const existing = findReusableMainWindow();
    if (existing) {
      mainWindowRef = existing;
      focusExistingWindow(existing);
      return;
    }
    void createWindow();
  });
}

if (singleInstanceOk) {
  app.on("window-all-closed", () => {
    const keep = shouldKeepLocalServerAlive({
      mainAlive: Boolean(mainWindowRef && !mainWindowRef.isDestroyed()),
      auxAliveCount: [...auxWindows.values()].filter((win) => !win.isDestroyed()).length,
      remainingAppWindowCount: listAppWindows().length,
    });
    if (keep) {
      return;
    }
    killLocalServer();
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    killLocalServer();
    try {
      spawnWorkspaceDaemon();
    } catch {
      /* best-effort */
    }
  });

  app.on("activate", () => {
    const existing = findReusableMainWindow();
    if (existing) {
      mainWindowRef = existing;
      focusExistingWindow(existing);
      return;
    }
    if (listAppWindows().length === 0) {
      void createWindow();
    }
  });
}
