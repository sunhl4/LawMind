import { app, BrowserWindow, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installLawmindContentSecurityPolicy } from "./session-config.mjs";
import { createFsBridge } from "./fs-bridge.mjs";
import {
  ensureBackend,
  killLocalServer,
  getAllowedRoots,
} from "./local-server.mjs";
import {
  setupApplicationMenu,
  loadRendererIntoWindow,
  runAutoUpdateCheckWithNotify,
} from "./app-menu.mjs";
import { registerIpcHandlers } from "./ipc-handlers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("electron").BrowserWindow | null} */
let mainWindowRef = null;

/** @type {Map<string, import("electron").BrowserWindow>} */
const auxWindows = new Map();

const fsBridge = createFsBridge(getAllowedRoots);

function installIpcHandlers() {
  registerIpcHandlers({
    getMainWindowRef: () => mainWindowRef,
    auxWindows,
    fsBridge,
  });
}

async function createWindow() {
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
    mainWindowRef = null;
  });

  // target=_blank / window.open to http(s) must open in the system browser, not an in-app window (often blank).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === "http:" || u.protocol === "https:") {
        void shell.openExternal(url);
        return { action: "deny" };
      }
    } catch {
      /* ignore bad URLs */
    }
    return { action: "deny" };
  });

  await loadRendererIntoWindow(mainWindow);
  if (!app.isPackaged && process.env.LAWMIND_E2E !== "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

void app.whenReady().then(async () => {
  try {
    installIpcHandlers();
    setupApplicationMenu();
    await createWindow();
    if (process.env.LAWMIND_E2E !== "1" && process.env.LAWMIND_SKIP_AUTO_UPDATE !== "1") {
      setTimeout(() => {
        void runAutoUpdateCheckWithNotify();
      }, 12_000);
    }
  } catch {
    app.quit();
  }
});

app.on("window-all-closed", () => {
  killLocalServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  killLocalServer();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
