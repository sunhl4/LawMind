import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveRepoRoot() {
  if (process.env.LAWMIND_REPO_ROOT) {
    return path.resolve(process.env.LAWMIND_REPO_ROOT);
  }
  return path.resolve(__dirname, "..", "..", "..");
}

function validateRepoRoot(root) {
  const pkg = path.join(root, "package.json");
  if (!fs.existsSync(pkg)) {
    return false;
  }
  try {
    const name = JSON.parse(fs.readFileSync(pkg, "utf8")).name;
    return name === "openclaw";
  } catch {
    return false;
  }
}

function lawMindPaths() {
  const lawMindRoot = path.join(app.getPath("userData"), "LawMind");
  const configPath = path.join(lawMindRoot, "desktop-config.json");
  let workspaceOverride = null;
  let retrievalMode = "single";
  try {
    if (fs.existsSync(configPath)) {
      const j = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (typeof j.workspaceDir === "string" && j.workspaceDir.trim()) {
        workspaceOverride = path.resolve(j.workspaceDir.trim());
      }
      if (j.retrievalMode === "dual") {
        retrievalMode = "dual";
      }
    }
  } catch {
    /* ignore bad config */
  }
  const workspaceDir = workspaceOverride || path.join(lawMindRoot, "workspace");
  const envFilePath = path.join(lawMindRoot, ".env.lawmind");
  return { lawMindRoot, configPath, workspaceDir, envFilePath, retrievalMode };
}

function getBundledServerScript() {
  if (!app.isPackaged) {
    return null;
  }
  const p = path.join(process.resourcesPath, "lawmind-server", "lawmind-local-server.cjs");
  return fs.existsSync(p) ? p : null;
}

/** Matches vendor script output: resources/node-runtime/<platform-arch>/ */
function nodeRuntimeKey() {
  return `${process.platform}-${process.arch}`;
}

/**
 * Prefer LAWMIND_NODE_BIN, then packaged Node under extraResources, then PATH `node`.
 */
function resolveNodeExecutable() {
  const override = process.env.LAWMIND_NODE_BIN?.trim();
  if (override) {
    return override;
  }
  if (app.isPackaged) {
    const base = path.join(process.resourcesPath, "node-runtime", nodeRuntimeKey());
    if (process.platform === "win32") {
      const win = path.join(base, "node.exe");
      if (fs.existsSync(win)) {
        return win;
      }
    } else {
      const unix = path.join(base, "bin", "node");
      if (fs.existsSync(unix)) {
        return unix;
      }
    }
  }
  return "node";
}

function pickPort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const p = typeof addr === "object" && addr && "port" in addr ? addr.port : 0;
      s.close(() => resolve(p));
    });
  });
}

let serverProcess = null;
let apiPort = 0;
let workspaceDir = "";
let envFilePath = "";
let lawMindRoot = "";
let configPath = "";
let serverStarted = false;

function startLocalServer(repoRoot, wsDir, envPath, retrievalMode) {
  return new Promise((resolve, reject) => {
    pickPort()
      .then((port) => {
        apiPort = port;
        const bundled = getBundledServerScript();
        const cmd = resolveNodeExecutable();
        let args;
        let cwd = repoRoot;

        if (bundled) {
          args = [bundled];
          cwd = path.dirname(bundled);
        } else {
          const serverScript = path.join(
            repoRoot,
            "apps",
            "lawmind-desktop",
            "server",
            "lawmind-local-server.ts",
          );
          if (!fs.existsSync(serverScript)) {
            reject(new Error(`Server script not found: ${serverScript}`));
            return;
          }
          args = ["--import", "tsx", serverScript];
        }

        const mode = retrievalMode === "dual" ? "dual" : "single";
        serverProcess = spawn(cmd, args, {
          cwd,
          env: {
            ...process.env,
            LAWMIND_WORKSPACE_DIR: wsDir,
            LAWMIND_DESKTOP_PORT: String(port),
            LAWMIND_ENV_FILE: envPath,
            // Lets local server load the same `.env.lawmind` as CLI, then merge userData env on top.
            LAWMIND_REPO_ROOT: repoRoot,
            LAWMIND_RETRIEVAL_MODE: mode,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });

        serverProcess.on("error", reject);
        serverProcess.stderr?.on("data", (d) => {
          process.stderr.write(d);
        });
        serverProcess.stdout?.on("data", (d) => {
          process.stdout.write(d);
        });

        serverProcess.once("exit", (code) => {
          if (code !== 0 && code !== null) {
            console.error(`[LawMind] local server exited with code ${code}`);
          }
        });

        setTimeout(() => resolve(port), bundled ? 200 : 600);
      })
      .catch(reject);
  });
}

async function restartBackendInternal() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  serverStarted = false;
  const paths = lawMindPaths();
  lawMindRoot = paths.lawMindRoot;
  configPath = paths.configPath;
  workspaceDir = paths.workspaceDir;
  envFilePath = paths.envFilePath;
  fs.mkdirSync(workspaceDir, { recursive: true });

  const bundled = getBundledServerScript();
  const repoRoot = bundled ? path.dirname(bundled) : resolveRepoRoot();
  if (!bundled && !validateRepoRoot(repoRoot)) {
    await dialog.showMessageBox({
      type: "error",
      title: "LawMind",
      message: "Cannot find OpenClaw monorepo root.",
      detail:
        "Set LAWMIND_REPO_ROOT to the directory containing openclaw package.json, build the bundled server (pnpm lawmind:bundle:desktop-server), or install a packaged build that includes lawmind-server.",
    });
    throw new Error("no repo root");
  }

  await startLocalServer(repoRoot, workspaceDir, envFilePath, paths.retrievalMode);
  serverStarted = true;
}

async function ensureBackend() {
  if (serverStarted) {
    return;
  }
  await restartBackendInternal();
}

function registerIpcHandlers() {
  ipcMain.handle("lawmind:get-config", () => {
    const paths = lawMindPaths();
    return {
      apiBase: `http://127.0.0.1:${apiPort}`,
      workspaceDir,
      envFilePath,
      lawMindRoot,
      configPath,
      retrievalMode: paths.retrievalMode,
      packaged: app.isPackaged,
      bundledServer: Boolean(getBundledServerScript()),
      nodeRuntimeKey: app.isPackaged ? nodeRuntimeKey() : null,
      nodeExecutable: app.isPackaged ? resolveNodeExecutable() : "node",
    };
  });

  ipcMain.handle("lawmind:pick-workspace", async () => {
    const res = await dialog.showOpenDialog({
      title: "选择 LawMind 工作区目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) {
      return { ok: false };
    }
    return { ok: true, path: res.filePaths[0] };
  });

  ipcMain.handle("lawmind:save-setup", async (_evt, payload) => {
    const apiKey = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
    const baseUrl = typeof payload?.baseUrl === "string" ? payload.baseUrl.trim() : "";
    const model = typeof payload?.model === "string" ? payload.model.trim() : "";
    const pickWs = typeof payload?.workspaceDir === "string" ? payload.workspaceDir.trim() : "";
    const wantDual =
      payload?.retrievalMode === "dual" ||
      String(payload?.retrievalMode ?? "").toLowerCase() === "dual";

    if (!apiKey) {
      return { ok: false, error: "API Key 必填" };
    }

    const paths = lawMindPaths();
    fs.mkdirSync(paths.lawMindRoot, { recursive: true });

    let prev = {};
    try {
      if (fs.existsSync(paths.configPath)) {
        prev = JSON.parse(fs.readFileSync(paths.configPath, "utf8"));
      }
    } catch {
      prev = {};
    }

    const retrievalMode = wantDual ? "dual" : "single";
    const desktopCfg = {
      ...prev,
      workspaceDir: pickWs || prev.workspaceDir || undefined,
      firstRunCompleted: true,
      retrievalMode,
    };
    fs.writeFileSync(paths.configPath, `${JSON.stringify(desktopCfg, null, 2)}\n`, "utf8");

    const url =
      baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const m = model || "qwen-plus";
    const envBody = [
      "# Generated by LawMind desktop setup wizard",
      `LAWMIND_AGENT_BASE_URL=${url}`,
      `LAWMIND_AGENT_API_KEY=${apiKey}`,
      `LAWMIND_AGENT_MODEL=${m}`,
      "# Mirrors for CLI / engine paths that read LAWMIND_QWEN_*",
      `LAWMIND_QWEN_API_KEY=${apiKey}`,
      `LAWMIND_QWEN_MODEL=${m}`,
      "",
    ].join("\n");
    fs.writeFileSync(paths.envFilePath, envBody, "utf8");

    try {
      await restartBackendInternal();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    return {
      ok: true,
      apiBase: `http://127.0.0.1:${apiPort}`,
      workspaceDir,
      envFilePath,
      retrievalMode,
    };
  });

  ipcMain.handle("lawmind:set-retrieval-mode", async (_evt, mode) => {
    const next = mode === "dual" ? "dual" : "single";
    const paths = lawMindPaths();
    fs.mkdirSync(paths.lawMindRoot, { recursive: true });
    let prev = {};
    try {
      if (fs.existsSync(paths.configPath)) {
        prev = JSON.parse(fs.readFileSync(paths.configPath, "utf8"));
      }
    } catch {
      prev = {};
    }
    const merged = { ...prev, retrievalMode: next };
    fs.writeFileSync(paths.configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    try {
      await restartBackendInternal();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return {
      ok: true,
      retrievalMode: next,
      apiBase: `http://127.0.0.1:${apiPort}`,
    };
  });

  ipcMain.handle("lawmind:open-external", (_evt, url) => {
    if (typeof url === "string" && url.startsWith("http")) {
      void shell.openExternal(url);
    }
  });

  ipcMain.handle("lawmind:show-item-in-folder", (_evt, fullPath) => {
    if (typeof fullPath !== "string" || !fullPath.trim()) {
      return { ok: false, error: "path required" };
    }
    const resolved = path.resolve(fullPath.trim());
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: "not found" };
    }
    shell.showItemInFolder(resolved);
    return { ok: true };
  });
}

async function createWindow() {
  await ensureBackend();

  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    title: "LawMind",
    webPreferences: {
      // CommonJS preload is more reliable than .mjs across Electron versions.
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Dev (http://127.0.0.1:Vite): sandbox off avoids preload/contextBridge issues on some Electron+Vite setups. Packaged app uses file:// with sandbox on.
      sandbox: app.isPackaged,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5174";
  if (!app.isPackaged) {
    await mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

void app.whenReady().then(async () => {
  try {
    registerIpcHandlers();
    await createWindow();
  } catch {
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  serverStarted = false;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
