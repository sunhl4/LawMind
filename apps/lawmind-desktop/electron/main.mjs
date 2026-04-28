import { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("electron").BrowserWindow | null} */
let mainWindowRef = null;

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
    return name === "lawmind" || name === "openclaw";
  } catch {
    return false;
  }
}

function lawMindPaths() {
  const lawMindRoot = path.join(app.getPath("userData"), "LawMind");
  const configPath = path.join(lawMindRoot, "desktop-config.json");
  let workspaceOverride = null;
  let projectOverride = null;
  let retrievalMode = "single";
  try {
    if (fs.existsSync(configPath)) {
      const j = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (typeof j.workspaceDir === "string" && j.workspaceDir.trim()) {
        workspaceOverride = path.resolve(j.workspaceDir.trim());
      }
      if (typeof j.projectDir === "string" && j.projectDir.trim()) {
        projectOverride = path.resolve(j.projectDir.trim());
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
  return {
    lawMindRoot,
    configPath,
    workspaceDir,
    projectDir: projectOverride,
    envFilePath,
    retrievalMode,
  };
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

async function waitForLocalServerReady(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null) {
      throw new Error("LawMind local server exited before becoming ready");
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        return;
      }
      lastError = new Error(`Health check returned HTTP ${res.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Timed out waiting for LawMind local server to start${lastError ? `: ${lastError.message}` : ""}`,
  );
}

let serverProcess = null;
let apiPort = 0;
let workspaceDir = "";
let projectDir = null;
let envFilePath = "";
let lawMindRoot = "";
let configPath = "";
let serverStarted = false;

/** Public download landing (browser). Override with env `LAWMIND_DOWNLOAD_PAGE_URL`. */
const DEFAULT_LAWMIND_DOWNLOAD_PAGE_URL =
  "https://cdn.jsdelivr.net/gh/lawmind/lawmind@main/apps/lawmind-desktop/download/index.html";

function resolveLawmindDownloadPageUrl() {
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

async function runAutoUpdateCheckWithNotify() {
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

async function checkUpdatesWithUi() {
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

const MAX_TEXT_READ_BYTES = 1_000_000;

function toPosix(relPath) {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function getAllowedRoots() {
  const roots = {
    workspace: workspaceDir,
  };
  if (projectDir) {
    roots.project = projectDir;
  }
  return roots;
}

function realpathSafe(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function isUnderRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(root + path.sep);
}

function assertRoot(rootKey) {
  if (rootKey !== "workspace" && rootKey !== "project") {
    throw new Error("invalid root");
  }
  const roots = getAllowedRoots();
  const rootPath = roots[rootKey];
  if (!rootPath) {
    throw new Error(`root not available: ${rootKey}`);
  }
  return rootPath;
}

function resolveFsPath(rootKey, relPath = "", opts = {}) {
  const {
    mustExist = false,
    allowRoot = true,
  } = opts;
  const rootPath = assertRoot(rootKey);
  const rel = toPosix(relPath);
  if (!allowRoot && !rel) {
    throw new Error("root path is not allowed for this operation");
  }
  if (rel.includes("..")) {
    throw new Error("path traversal is not allowed");
  }
  const absPath = path.resolve(rootPath, rel);
  if (!isUnderRoot(rootPath, absPath)) {
    throw new Error("path escapes root");
  }
  if (mustExist && !fs.existsSync(absPath)) {
    throw new Error("path does not exist");
  }
  const real = realpathSafe(absPath);
  if (real && !isUnderRoot(rootPath, real)) {
    throw new Error("symlink escapes root");
  }
  return { rootPath, absPath, rel };
}

function isLikelyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

function listDirectoryEntries(rootKey, relPath = "") {
  const { absPath, rel } = resolveFsPath(rootKey, relPath, { mustExist: true, allowRoot: true });
  const stat = fs.statSync(absPath);
  if (!stat.isDirectory()) {
    throw new Error("path is not a directory");
  }
  const entries = fs.readdirSync(absPath, { withFileTypes: true });
  return entries
    .map((entry) => {
      const childRel = toPosix(path.join(rel, entry.name));
      const childAbs = path.join(absPath, entry.name);
      const childStat = fs.statSync(childAbs);
      return {
        name: entry.name,
        path: childRel,
        kind: entry.isDirectory() ? "directory" : "file",
        size: entry.isDirectory() ? undefined : childStat.size,
        mtimeMs: childStat.mtimeMs,
      };
    })
    .toSorted((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

function startLocalServer(repoRoot, wsDir, envPath, retrievalMode, projectPath) {
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
            LAWMIND_PROJECT_DIR: projectPath || "",
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

        waitForLocalServerReady(port)
          .then(() => resolve(port))
          .catch(reject);
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
  projectDir = paths.projectDir ?? null;
  envFilePath = paths.envFilePath;
  fs.mkdirSync(workspaceDir, { recursive: true });

  const bundled = getBundledServerScript();
  const repoRoot = bundled ? path.dirname(bundled) : resolveRepoRoot();
  if (!bundled && !validateRepoRoot(repoRoot)) {
    await dialog.showMessageBox({
      type: "error",
      title: "LawMind",
      message: "Cannot find LawMind workspace root.",
      detail:
        "Set LAWMIND_REPO_ROOT to the directory containing the LawMind workspace package.json, build the bundled server (pnpm lawmind:bundle:desktop-server), or install a packaged build that includes lawmind-server.",
    });
    throw new Error("no repo root");
  }

  await startLocalServer(
    repoRoot,
    workspaceDir,
    envFilePath,
    paths.retrievalMode,
    paths.projectDir ?? "",
  );
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
      projectDir,
      envFilePath,
      lawMindRoot,
      configPath,
      retrievalMode: paths.retrievalMode,
      packaged: app.isPackaged,
      bundledServer: Boolean(getBundledServerScript()),
      nodeRuntimeKey: app.isPackaged ? nodeRuntimeKey() : null,
      nodeExecutable: app.isPackaged ? resolveNodeExecutable() : "node",
      appVersion: app.getVersion(),
      downloadPageUrl: resolveLawmindDownloadPageUrl(),
    };
  });

  ipcMain.handle("lawmind:check-updates", async () => {
    await checkUpdatesWithUi();
    return { ok: true };
  });

  ipcMain.handle("lawmind:show-notification", (_evt, payload) => {
    try {
      const title =
        typeof payload?.title === "string" && payload.title.trim()
          ? payload.title.trim()
          : "LawMind";
      const body = typeof payload?.body === "string" ? payload.body : "";
      if (!Notification.isSupported()) {
        return { ok: false, error: "notifications_not_supported" };
      }
      const notification = new Notification({ title, body: body.slice(0, 512) });
      const openSettingsOnClick = payload?.openSettingsOnClick === true;
      const openReviewOnClick = payload?.openReviewOnClick === true;
      const reviewTaskId =
        typeof payload?.reviewTaskId === "string" ? payload.reviewTaskId.trim() : "";
      const reviewMatterIdRaw = payload?.reviewMatterId;
      const reviewMatterId =
        typeof reviewMatterIdRaw === "string" && reviewMatterIdRaw.trim()
          ? reviewMatterIdRaw.trim()
          : null;
      if (openSettingsOnClick) {
        notification.on("click", () => {
          const w = mainWindowRef ?? BrowserWindow.getAllWindows()[0];
          if (w && !w.isDestroyed()) {
            if (w.isMinimized()) {
              w.restore();
            }
            w.show();
            w.focus();
            w.webContents.send("lawmind:notification-click", {
              reason: "open_settings_collaboration",
            });
          }
        });
      } else if (openReviewOnClick) {
        notification.on("click", () => {
          const w = mainWindowRef ?? BrowserWindow.getAllWindows()[0];
          if (w && !w.isDestroyed()) {
            if (w.isMinimized()) {
              w.restore();
            }
            w.show();
            w.focus();
            w.webContents.send("lawmind:notification-click", {
              reason: "open_review",
              reviewTaskId: reviewTaskId || undefined,
              reviewMatterId: reviewMatterId ?? undefined,
            });
          }
        });
      }
      notification.show();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
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

  ipcMain.handle("lawmind:pick-project", async () => {
    const res = await dialog.showOpenDialog({
      title: "选择项目目录",
      properties: ["openDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) {
      return { ok: false };
    }
    return { ok: true, path: res.filePaths[0] };
  });

  ipcMain.handle("lawmind:set-project-dir", async (_evt, nextPath) => {
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

    let projectAbs = null;
    if (typeof nextPath === "string" && nextPath.trim()) {
      projectAbs = path.resolve(nextPath.trim());
      if (!fs.existsSync(projectAbs) || !fs.statSync(projectAbs).isDirectory()) {
        return { ok: false, error: "invalid project directory" };
      }
    }

    const merged = {
      ...prev,
      projectDir: projectAbs || undefined,
    };
    fs.writeFileSync(paths.configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    projectDir = projectAbs;
    // Restart local API so LAWMIND_PROJECT_DIR and /api/fs/* match File Workbench.
    try {
      await restartBackendInternal();
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        projectDir,
      };
    }
    return { ok: true, projectDir };
  });

  ipcMain.handle("lawmind:fs:list", (_evt, payload) => {
    try {
      const root = payload?.root;
      const relPath = payload?.path ?? "";
      const entries = listDirectoryEntries(root, relPath);
      return { ok: true, entries };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("lawmind:fs:read", (_evt, payload) => {
    try {
      const root = payload?.root;
      const relPath = payload?.path ?? "";
      const { absPath } = resolveFsPath(root, relPath, { mustExist: true, allowRoot: false });
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) {
        throw new Error("path is not a file");
      }
      if (stat.size > MAX_TEXT_READ_BYTES) {
        throw new Error(`file too large (>${MAX_TEXT_READ_BYTES} bytes)`);
      }
      const buffer = fs.readFileSync(absPath);
      if (isLikelyBinary(buffer)) {
        throw new Error("binary file is not editable in this view");
      }
      return {
        ok: true,
        content: buffer.toString("utf8"),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("lawmind:fs:write", (_evt, payload) => {
    try {
      const root = payload?.root;
      const relPath = payload?.path ?? "";
      const content = typeof payload?.content === "string" ? payload.content : "";
      const expectedMtimeMs =
        typeof payload?.expectedMtimeMs === "number" ? payload.expectedMtimeMs : undefined;
      const { absPath } = resolveFsPath(root, relPath, { mustExist: false, allowRoot: false });

      let priorStat = null;
      if (fs.existsSync(absPath)) {
        priorStat = fs.statSync(absPath);
        if (!priorStat.isFile()) {
          throw new Error("path is not a file");
        }
      } else {
        const parent = path.dirname(absPath);
        fs.mkdirSync(parent, { recursive: true });
      }

      if (
        priorStat &&
        expectedMtimeMs !== undefined &&
        Math.abs(priorStat.mtimeMs - expectedMtimeMs) > 1
      ) {
        return {
          ok: false,
          conflict: true,
          error: "file was modified externally",
          mtimeMs: priorStat.mtimeMs,
        };
      }
      fs.writeFileSync(absPath, content, "utf8");
      const next = fs.statSync(absPath);
      return { ok: true, mtimeMs: next.mtimeMs, size: next.size };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("lawmind:fs:mkdir", (_evt, payload) => {
    try {
      const root = payload?.root;
      const relPath = payload?.path ?? "";
      const { absPath } = resolveFsPath(root, relPath, { mustExist: false, allowRoot: false });
      fs.mkdirSync(absPath, { recursive: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("lawmind:fs:rename", (_evt, payload) => {
    try {
      const root = payload?.root;
      const fromPath = payload?.fromPath ?? "";
      const toPath = payload?.toPath ?? "";
      const { absPath: fromAbs } = resolveFsPath(root, fromPath, { mustExist: true, allowRoot: false });
      const { absPath: toAbs } = resolveFsPath(root, toPath, { mustExist: false, allowRoot: false });
      fs.renameSync(fromAbs, toAbs);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("lawmind:fs:delete", (_evt, payload) => {
    try {
      const root = payload?.root;
      const relPath = payload?.path ?? "";
      const { absPath } = resolveFsPath(root, relPath, { mustExist: true, allowRoot: false });
      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        fs.rmSync(absPath, { recursive: true, force: false });
      } else {
        fs.unlinkSync(absPath);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Copy a file or directory within the same root (for paste in file tree). */
  ipcMain.handle("lawmind:fs:copy", (_evt, payload) => {
    try {
      const root = payload?.root;
      const fromPath = payload?.fromPath ?? "";
      const toPath = payload?.toPath ?? "";
      if (!fromPath || !toPath) {
        return { ok: false, error: "fromPath and toPath are required" };
      }
      const { absPath: fromAbs } = resolveFsPath(root, fromPath, { mustExist: true, allowRoot: false });
      const { absPath: toAbs } = resolveFsPath(root, toPath, { mustExist: false, allowRoot: false });
      if (fs.existsSync(toAbs)) {
        return { ok: false, error: "destination already exists" };
      }
      const st = fs.statSync(fromAbs);
      if (st.isDirectory()) {
        fs.cpSync(fromAbs, toAbs, { recursive: true });
      } else {
        fs.copyFileSync(fromAbs, toAbs);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Save text to a path chosen by the user (另存为). */
  ipcMain.handle("lawmind:dialog:save-text-file", async (_evt, payload) => {
    const content = typeof payload?.content === "string" ? payload.content : "";
    const defaultName = typeof payload?.defaultName === "string" ? payload.defaultName : "未命名.txt";
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showSaveDialog(win ?? undefined, {
      title: "另存为",
      defaultPath: defaultName,
      filters: [
        { name: "Text & markup", extensions: ["txt", "md", "json", "ts", "tsx", "js", "css", "html"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (res.canceled || !res.filePath) {
      return { ok: false, canceled: true };
    }
    fs.writeFileSync(res.filePath, content, "utf8");
    return { ok: true, filePath: res.filePath };
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

  /** 用系统默认应用打开工作区/项目内文件（如 Word 文档） */
  ipcMain.handle("lawmind:open-with-system", async (_evt, payload) => {
    try {
      const root = payload?.root;
      const relPath = payload?.path ?? "";
      const { absPath } = resolveFsPath(root, relPath, { mustExist: true, allowRoot: false });
      const err = await shell.openPath(absPath);
      if (err) {
        return { ok: false, error: err };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

function setupApplicationMenu() {
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
    setupApplicationMenu();
    await createWindow();
    setTimeout(() => {
      void runAutoUpdateCheckWithNotify();
    }, 12_000);
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
