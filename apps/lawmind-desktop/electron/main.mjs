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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    width: 1100,
    height: 780,
    title: "LawMind",
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

void app.whenReady().then(async () => {
  try {
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
