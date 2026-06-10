import { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, session } from "electron";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { installLawmindContentSecurityPolicy } from "./session-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireCjs = createRequire(import.meta.url);

// Optional local debug session (set LAWMIND_DEBUG_SESSION=1). Never enabled in packaged builds by default.
const DEBUG_SESSION_ENABLED = Boolean(process.env.LAWMIND_DEBUG_SESSION);
function resolveRepoRootForDebug() {
  if (process.env.LAWMIND_REPO_ROOT) {
    return path.resolve(process.env.LAWMIND_REPO_ROOT);
  }
  return path.resolve(__dirname, "..", "..", "..");
}
const DEBUG_LOG_PATH = DEBUG_SESSION_ENABLED
  ? path.join(resolveRepoRootForDebug(), ".cursor", "debug-lawmind.log")
  : "";
function dbgLog(_location, _message, _data, _hypothesisId) {
  if (!DEBUG_SESSION_ENABLED) {
    return;
  }
  const payload = {
    sessionId: process.env.LAWMIND_DEBUG_SESSION ?? "lawmind",
    location: _location,
    message: _message,
    data: _data,
    hypothesisId: _hypothesisId,
    timestamp: Date.now(),
  };
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true });
    fs.appendFileSync(DEBUG_LOG_PATH, `${JSON.stringify(payload)}\n`);
  } catch {
    /* ignore */
  }
}
if (DEBUG_SESSION_ENABLED) {
  process.on("uncaughtException", (err) => {
    dbgLog("main.mjs:uncaughtException", "uncaughtException", {
      name: err?.name,
      message: err?.message,
      stack: err?.stack?.slice(0, 500),
    }, "H7");
  });
  process.on("unhandledRejection", (reason) => {
    dbgLog("main.mjs:unhandledRejection", "unhandledRejection", { reason: String(reason) }, "H7");
  });
}

const { probeModelInline } = requireCjs("./lawmind-model-probe.cjs");

/** OS keychain wrapper (best-effort; new secrets are refused when unavailable). */
let keyVault;
try {
  keyVault = requireCjs("./lawmind-key-vault.cjs");
} catch (err) {
  console.warn("[LawMind] keychain wrapper unavailable; falling back to plaintext env.", err);
  keyVault = {
    isAvailable: () => false,
    saveSecret: async () => false,
    readSecret: async () => null,
    deleteSecret: async () => false,
    listSecrets: async () => [],
  };
}

/** Account names under the `ai.lawmind.desktop` keychain service. */
const KEYCHAIN_ACCOUNTS = {
  wizardApiKey: "wizard.default.apiKey",
  webSearchApiKey: "wizard.webSearch.apiKey",
  customApiKey: (modelId) => `custom.${String(modelId).replace(/^custom:/, "")}.apiKey`,
};

/**
 * Resolve all known secrets to inject into the local server subprocess.
 * Returns plain `{ ENV_NAME: value }` map (best-effort; never throws).
 */
async function collectSecretsForServerEnv(parsedEnvVars) {
  const out = {};
  if (!keyVault.isAvailable()) {
    return out;
  }
  try {
    // #region agent log
    dbgLog("main.mjs:collectSecrets", "before read wizard", {}, "A");
    // #endregion
    const wizardKey = await keyVault.readSecret(KEYCHAIN_ACCOUNTS.wizardApiKey);
    // #region agent log
    dbgLog("main.mjs:collectSecrets", "after read wizard", { hasWizard: Boolean(wizardKey) }, "A");
    // #endregion
    if (wizardKey) {
      if (!parsedEnvVars.LAWMIND_AGENT_API_KEY) {out.LAWMIND_AGENT_API_KEY = wizardKey;}
      if (!parsedEnvVars.LAWMIND_QWEN_API_KEY) {out.LAWMIND_QWEN_API_KEY = wizardKey;}
    }
    const webSearchKey = await keyVault.readSecret(KEYCHAIN_ACCOUNTS.webSearchApiKey);
    // #region agent log
    dbgLog("main.mjs:collectSecrets", "after read webSearch", { hasWeb: Boolean(webSearchKey) }, "A");
    // #endregion
    if (webSearchKey) {
      if (!parsedEnvVars.LAWMIND_WEB_SEARCH_API_KEY) {out.LAWMIND_WEB_SEARCH_API_KEY = webSearchKey;}
      if (!parsedEnvVars.BRAVE_API_KEY) {out.BRAVE_API_KEY = webSearchKey;}
    }
  // #region agent log
  dbgLog("main.mjs:collectSecrets", "before listSecrets", {}, "A");
  // #endregion
    const all = await keyVault.listSecrets();
  // #region agent log
  dbgLog("main.mjs:collectSecrets", "after listSecrets", { count: all.length }, "A");
  // #endregion
    for (const entry of all) {
      const m = /^custom\.([^.]+)\.apiKey$/.exec(entry.account);
      if (!m) {continue;}
      const uuid = m[1];
      const value = await keyVault.readSecret(entry.account);
      if (value) {
        const envName = `LAWMIND_CUSTOM_${uuid.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
        out[envName] = value;
      }
    }
  } catch (err) {
    console.warn("[LawMind] keychain read failed; subprocess will run without injected secrets.", err);
  }
  return out;
}

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

/** Parse a `.env.lawmind` file body into a `{ KEY: VALUE }` map. */
function parseEnvAssignmentsTopLevel(content) {
  const out = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) {continue;}
    const eq = t.indexOf("=");
    if (eq <= 0) {continue;}
    out[t.slice(0, eq).trim()] = t.slice(eq + 1);
  }
  return out;
}

/** Map wizard model name → desktop default model id (mirrors src/lawmind/models/catalog). */
function defaultModelIdForWizardModel(modelName) {
  const norm = String(modelName || "qwen-plus")
    .trim()
    .toLowerCase();
  if (!norm) {
    return "env:current";
  }
  const builtins = [
    ["qwen-plus", "builtin:qwen-plus"],
    ["qwen-turbo", "builtin:qwen-turbo"],
    ["qwen-max", "builtin:qwen-max"],
    ["qwen3.5-plus", "builtin:qwen3.5-plus"],
    ["qwen-plus-latest", "builtin:qwen3.5-plus"],
    ["gpt-4o", "builtin:gpt-4o"],
    ["gpt-4o-mini", "builtin:gpt-4o-mini"],
    ["deepseek-chat", "builtin:deepseek-chat"],
    ["moonshot-v1-8k", "builtin:moonshot-v1-8k"],
    ["glm-4-plus", "builtin:glm-4-plus"],
  ];
  for (const [name, id] of builtins) {
    if (name === norm) {
      return id;
    }
  }
  return "env:current";
}

function writeWizardDefaultModelId(lawMindRoot, modelName) {
  const modelsPath = path.join(lawMindRoot, "models.json");
  let store = { schemaVersion: 1, customModels: [] };
  try {
    if (fs.existsSync(modelsPath)) {
      const raw = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
      if (raw.schemaVersion === 1 && Array.isArray(raw.customModels)) {
        store = raw;
      }
    }
  } catch {
    /* reset */
  }
  store.defaultModelId = defaultModelIdForWizardModel(modelName);
  fs.writeFileSync(modelsPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
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
      const headers =
        apiAuthToken.trim().length > 0
          ? { authorization: `Bearer ${apiAuthToken}` }
          : undefined;
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { headers });
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
let apiAuthToken = "";
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

async function startLocalServer(repoRoot, wsDir, envPath, retrievalMode, projectPath) {
  const port = await pickPort();
  apiPort = port;
  apiAuthToken = randomBytes(32).toString("hex");
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
      throw new Error(`Server script not found: ${serverScript}`);
    }
    args = ["--import", "tsx", serverScript];
  }

  const parsedEnvVars = fs.existsSync(envPath)
    ? parseEnvAssignmentsTopLevel(fs.readFileSync(envPath, "utf8"))
    : {};
  const injectedSecrets = await collectSecretsForServerEnv(parsedEnvVars);
  // #region agent log
  dbgLog("main.mjs:startLocalServer", "secrets collected", { keyCount: Object.keys(injectedSecrets).length, keychainAvailable: keyVault.isAvailable() }, "A");
  // #endregion

  const mode = retrievalMode === "dual" ? "dual" : "single";
  if (app.isPackaged && process.env.LAWMIND_SKIP_API_AUTH === "1") {
    console.warn(
      "[LawMind] LAWMIND_SKIP_API_AUTH=1 is ignored in packaged builds; loopback API auth remains enabled.",
    );
  }
  return new Promise((resolve, reject) => {
    const serverEnv = {
      ...process.env,
      LAWMIND_WORKSPACE_DIR: wsDir,
      LAWMIND_DESKTOP_PORT: String(port),
      LAWMIND_LOCAL_API_TOKEN: apiAuthToken,
      LAWMIND_ENV_FILE: envPath,
      // Lets local server load the same `.env.lawmind` as CLI, then merge userData env on top.
      LAWMIND_REPO_ROOT: repoRoot,
      LAWMIND_RETRIEVAL_MODE: mode,
      LAWMIND_PROJECT_DIR: projectPath || "",
      ...(app.isPackaged ? { LAWMIND_PACKAGED: "1" } : {}),
      ...injectedSecrets,
    };
    if (app.isPackaged && serverEnv.LAWMIND_SKIP_API_AUTH === "1") {
      delete serverEnv.LAWMIND_SKIP_API_AUTH;
    }
    serverProcess = spawn(cmd, args, {
      cwd,
      env: serverEnv,
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
      .then(() => {
        // #region agent log
        dbgLog("main.mjs:startLocalServer", "local server ready", { port }, "E");
        // #endregion
        resolve(port);
      })
      .catch(reject);
  });
}

/**
 * One-time migration: copy plaintext keys from `.env.lawmind` into the OS keychain
 * when keychain is empty. Keys remain in the env file so restarts do not require re-entry.
 */
async function maybeMigrateEnvKeysToKeychain(envFilePath) {
  if (!keyVault.isAvailable()) {return;}
  if (!fs.existsSync(envFilePath)) {return;}
  let vars;
  try {
    vars = parseEnvAssignmentsTopLevel(fs.readFileSync(envFilePath, "utf8"));
  } catch {
    return;
  }
  const envKey = (vars.LAWMIND_AGENT_API_KEY || vars.LAWMIND_QWEN_API_KEY || "").trim();
  if (!envKey) {return;}
  try {
    const existing = await keyVault.readSecret(KEYCHAIN_ACCOUNTS.wizardApiKey);
    if (existing) {return;}
    await keyVault.saveSecret(KEYCHAIN_ACCOUNTS.wizardApiKey, envKey);
  } catch {
    /* env file remains authoritative */
  }
}

/** After local server restart, verify the saved profile via POST /api/models/test. */
async function postLocalModelTest(modelId) {
  const url = `http://127.0.0.1:${apiPort}/api/models/test`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: modelId || "env:current" }),
    });
    const text = await res.text();
    let body = {};
    try {
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      return {
        ok: false,
        code: "invalid_response",
        error: `无法解析验证响应（HTTP ${res.status}）`,
      };
    }
    if (res.ok && body.ok === true) {
      return { ok: true, latencyMs: body.latencyMs, modelId: body.modelId };
    }
    return {
      ok: false,
      code: typeof body.code === "string" ? body.code : "model_api_error",
      error:
        typeof body.message === "string" && body.message.trim()
          ? body.message.trim()
          : `连接验证失败（HTTP ${res.status}）`,
    };
  } catch (err) {
    return {
      ok: false,
      code: "model_network_error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
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

  await maybeMigrateEnvKeysToKeychain(paths.envFilePath);
  // #region agent log
  dbgLog("main.mjs:restartBackendInternal", "after keychain migration", { keychainAvailable: keyVault.isAvailable() }, "A");
  // #endregion

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
      apiAuthToken,
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
      const openChatOnClick = payload?.openChatOnClick === true;
      const chatAssistantId =
        typeof payload?.chatAssistantId === "string" ? payload.chatAssistantId.trim() : "";
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
      } else if (openChatOnClick) {
        notification.on("click", () => {
          const w = mainWindowRef ?? BrowserWindow.getAllWindows()[0];
          if (w && !w.isDestroyed()) {
            if (w.isMinimized()) {
              w.restore();
            }
            w.show();
            w.focus();
            w.webContents.send("lawmind:notification-click", {
              reason: "open_workspace_chat",
              chatAssistantId: chatAssistantId || undefined,
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

  const parseEnvAssignments = parseEnvAssignmentsTopLevel;

  function writeMergedLawmindEnv(envFilePath, assignments) {
    const header = [
      "# Generated by LawMind desktop setup wizard",
      "# Other LAWMIND_* entries below are preserved when you re-save API settings.",
    ];
    const prev = fs.existsSync(envFilePath)
      ? parseEnvAssignmentsTopLevel(fs.readFileSync(envFilePath, "utf8"))
      : {};
    const merged = { ...prev, ...assignments };
    const body = [
      ...header,
      ...Object.entries(merged).map(([key, value]) => `${key}=${String(value)}`),
      "",
    ].join("\n");
    fs.writeFileSync(envFilePath, body, "utf8");
  }

  function _writeLawmindEnvSubset(envFilePath, removeKeys) {
    if (!fs.existsSync(envFilePath)) {return;}
    const prev = parseEnvAssignmentsTopLevel(fs.readFileSync(envFilePath, "utf8"));
    let changed = false;
    for (const k of removeKeys) {
      if (k in prev) {
        delete prev[k];
        changed = true;
      }
    }
    if (!changed) {return;}
    const header = [
      "# Generated by LawMind desktop setup wizard",
      "# Sensitive API keys are now stored in the OS keychain (`ai.lawmind.desktop` service).",
    ];
    const body = [
      ...header,
      ...Object.entries(prev).map(([key, value]) => `${key}=${String(value)}`),
      "",
    ].join("\n");
    fs.writeFileSync(envFilePath, body, "utf8");
  }

  ipcMain.handle("lawmind:read-model-settings", async () => {
    const paths = lawMindPaths();
    const vars = fs.existsSync(paths.envFilePath)
      ? parseEnvAssignments(fs.readFileSync(paths.envFilePath, "utf8"))
      : {};
    const envKey = (vars.LAWMIND_AGENT_API_KEY || vars.LAWMIND_QWEN_API_KEY || "").trim();
    const envWebKey = (vars.LAWMIND_WEB_SEARCH_API_KEY || vars.BRAVE_API_KEY || "").trim();
    let chainKey = "";
    let chainWebKey = "";
    if (keyVault.isAvailable()) {
      try {
        chainKey = (await keyVault.readSecret(KEYCHAIN_ACCOUNTS.wizardApiKey)) || "";
        chainWebKey = (await keyVault.readSecret(KEYCHAIN_ACCOUNTS.webSearchApiKey)) || "";
      } catch {
        chainKey = "";
        chainWebKey = "";
      }
    }
    return {
      ok: true,
      hasApiKey: Boolean(envKey || chainKey),
      hasWebSearchApiKey: Boolean(envWebKey || chainWebKey),
      keychainAvailable: keyVault.isAvailable(),
      keyStorage: chainKey ? "keychain" : envKey ? "env" : "none",
      webSearchKeyStorage: chainWebKey ? "keychain" : envWebKey ? "env" : "none",
      baseUrl:
        (vars.LAWMIND_AGENT_BASE_URL || vars.LAWMIND_QWEN_BASE_URL || "").trim() ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: (vars.LAWMIND_AGENT_MODEL || vars.LAWMIND_QWEN_MODEL || "qwen-plus").trim() || "qwen-plus",
      envFilePath: paths.envFilePath,
    };
  });

  ipcMain.handle("lawmind:save-setup", async (_evt, payload) => {
    const apiKey = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
    const webSearchApiKey =
      typeof payload?.webSearchApiKey === "string" ? payload.webSearchApiKey.trim() : "";
    const baseUrl = typeof payload?.baseUrl === "string" ? payload.baseUrl.trim() : "";
    const model = typeof payload?.model === "string" ? payload.model.trim() : "";
    const pickWs = typeof payload?.workspaceDir === "string" ? payload.workspaceDir.trim() : "";
    const wantDual =
      payload?.retrievalMode === "dual" ||
      String(payload?.retrievalMode ?? "").toLowerCase() === "dual";
    const legalSameAsChat = payload?.legalRetrievalSameAsChat !== false;

    const paths = lawMindPaths();
    fs.mkdirSync(paths.lawMindRoot, { recursive: true });

    const existingVars = fs.existsSync(paths.envFilePath)
      ? parseEnvAssignments(fs.readFileSync(paths.envFilePath, "utf8"))
      : {};
    const envKey = (existingVars.LAWMIND_AGENT_API_KEY || existingVars.LAWMIND_QWEN_API_KEY || "").trim();
    const envWebKey = (existingVars.LAWMIND_WEB_SEARCH_API_KEY || existingVars.BRAVE_API_KEY || "").trim();
    let chainKey = "";
    let chainWebKey = "";
    if (keyVault.isAvailable()) {
      try {
        chainKey = (await keyVault.readSecret(KEYCHAIN_ACCOUNTS.wizardApiKey)) || "";
        chainWebKey = (await keyVault.readSecret(KEYCHAIN_ACCOUNTS.webSearchApiKey)) || "";
      } catch {
        chainKey = "";
        chainWebKey = "";
      }
    }
    const effectiveKey = apiKey || chainKey || envKey;
    const effectiveWebKey = webSearchApiKey || chainWebKey || envWebKey;
    if (!effectiveKey) {
      return { ok: false, error: "API Key 必填" };
    }
    if (apiKey && !keyVault.isAvailable()) {
      return {
        ok: false,
        error:
          "系统加密存储不可用，无法安全保存新的 API Key。请启用操作系统密钥链，或先在 .env.lawmind 中手工配置后重启。",
        code: "keychain_unavailable",
      };
    }

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

    const inlineProbe = await probeModelInline({
      apiKey: effectiveKey,
      baseUrl: url,
      model: m,
      timeoutMs: 60_000,
    });
    if (!inlineProbe.ok) {
      return { ok: false, error: inlineProbe.error, code: inlineProbe.code, verified: false };
    }

    const envAssignments = {
      LAWMIND_AGENT_BASE_URL: url,
      LAWMIND_AGENT_MODEL: m,
      LAWMIND_QWEN_BASE_URL: url,
      LAWMIND_QWEN_MODEL: m,
      LAWMIND_RETRIEVAL_MODE: retrievalMode,
    };
    if (wantDual && legalSameAsChat) {
      envAssignments.LAWMIND_CHATLAW_BASE_URL = url;
      envAssignments.LAWMIND_CHATLAW_MODEL = m;
    }

    let keyStorage = "env";
    if (keyVault.isAvailable()) {
      try {
        const savedWizard = await keyVault.saveSecret(KEYCHAIN_ACCOUNTS.wizardApiKey, effectiveKey);
        if (!savedWizard) {
          return {
            ok: false,
            error: "密钥链写入失败，已取消保存以避免明文落盘。",
            code: "keychain_write_failed",
          };
        }
        keyStorage = "keychain";
        if (effectiveWebKey) {
          const savedWeb = await keyVault.saveSecret(
            KEYCHAIN_ACCOUNTS.webSearchApiKey,
            effectiveWebKey,
          );
          if (!savedWeb) {
            return {
              ok: false,
              error: "联网搜索 API Key 写入密钥链失败，已取消保存。",
              code: "keychain_write_failed",
            };
          }
        }
        writeMergedLawmindEnv(paths.envFilePath, envAssignments);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "keychain_write_failed",
        };
      }
    } else {
      envAssignments.LAWMIND_AGENT_API_KEY = effectiveKey;
      envAssignments.LAWMIND_QWEN_API_KEY = effectiveKey;
      if (effectiveWebKey) {
        envAssignments.LAWMIND_WEB_SEARCH_API_KEY = effectiveWebKey;
        envAssignments.BRAVE_API_KEY = effectiveWebKey;
      }
      if (wantDual && legalSameAsChat) {
        envAssignments.LAWMIND_CHATLAW_API_KEY = effectiveKey;
      }
      writeMergedLawmindEnv(paths.envFilePath, envAssignments);
    }
    writeWizardDefaultModelId(paths.lawMindRoot, m);

    try {
      await restartBackendInternal();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), verified: false };
    }

    const serverProbe = await postLocalModelTest("env:current");
    if (!serverProbe.ok) {
      return {
        ok: false,
        verified: false,
        code: serverProbe.code,
        error: `配置已写入 ${paths.envFilePath}，但本地服务验证失败：${serverProbe.error}`,
        apiBase: `http://127.0.0.1:${apiPort}`,
        envFilePath: paths.envFilePath,
        keyStorage,
      };
    }

    return {
      ok: true,
      verified: true,
      latencyMs: serverProbe.latencyMs ?? inlineProbe.latencyMs,
      apiBase: `http://127.0.0.1:${apiPort}`,
      workspaceDir: paths.workspaceDir,
      envFilePath: paths.envFilePath,
      retrievalMode,
      keyStorage,
      webSearchApiKeyConfigured: Boolean(effectiveWebKey),
    };
  });

  ipcMain.handle("lawmind:save-custom-model-key", async (_evt, payload) => {
    const id =
      typeof payload?.id === "string" && payload.id.trim() ? payload.id.trim() : "";
    const apiKey =
      typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
    if (!id) {
      return { ok: false, error: "model_id_required" };
    }
    if (!apiKey) {
      return { ok: false, error: "api_key_required" };
    }
    if (!keyVault.isAvailable()) {
      return { ok: false, error: "keychain_unavailable" };
    }
    try {
      await keyVault.saveSecret(KEYCHAIN_ACCOUNTS.customApiKey(id), apiKey);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("lawmind:delete-custom-model-key", async (_evt, payload) => {
    const id =
      typeof payload?.id === "string" && payload.id.trim() ? payload.id.trim() : "";
    if (!id) {
      return { ok: false, error: "model_id_required" };
    }
    if (!keyVault.isAvailable()) {
      return { ok: true, removed: false };
    }
    try {
      const removed = await keyVault.deleteSecret(KEYCHAIN_ACCOUNTS.customApiKey(id));
      return { ok: true, removed };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("lawmind:keychain-status", async () => {
    if (!keyVault.isAvailable()) {
      return { available: false, error: keyVault.lastError?.() };
    }
    try {
      const all = await keyVault.listSecrets();
      return { available: true, count: all.length };
    } catch {
      return { available: true, count: 0 };
    }
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
    return { ok: true, projectDir, apiBase: `http://127.0.0.1:${apiPort}` };
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

  /** 选择本地文件或文件夹（可选多选），用于「按路径导入案件」等。 */
  ipcMain.handle("lawmind:dialog:open-files", async (evt, payload = {}) => {
    const win =
      BrowserWindow.fromWebContents(evt.sender) ??
      mainWindowRef ??
      BrowserWindow.getFocusedWindow();
    const multi = payload?.multi !== false;
    const allowDirectories = payload?.allowDirectories === true;
    const title =
      typeof payload?.title === "string" ? payload.title : allowDirectories ? "选择文件或文件夹" : "选择文件";
    const filters = Array.isArray(payload?.filters)
      ? payload.filters
      : [
          {
            name: "Documents",
            extensions: ["pdf", "doc", "docx", "md", "txt", "rtf"],
          },
          { name: "All", extensions: ["*"] },
        ];

    const platform = process.platform;
    /** @type {import("electron").OpenDialogReturnValue} */
    let res;

    if (allowDirectories && (platform === "darwin" || platform === "linux")) {
      const properties = multi ? ["openFile", "openDirectory", "multiSelections"] : ["openFile", "openDirectory"];
      res = await dialog.showOpenDialog(win ?? undefined, {
        title,
        properties,
        filters,
      });
    } else if (allowDirectories && platform === "win32") {
      const choice = await dialog.showMessageBox(win ?? undefined, {
        type: "question",
        title: "导入案件",
        message: "Windows 下需分别选择文件或文件夹。请选择本次导入方式。",
        buttons: ["取消", "选择文件…", "选择文件夹…"],
        defaultId: 1,
        cancelId: 0,
      });
      if (choice.response === 0) {
        return { ok: false, canceled: true };
      }
      if (choice.response === 1) {
        res = await dialog.showOpenDialog(win ?? undefined, {
          title: `${title}（文件）`,
          properties: multi ? ["openFile", "multiSelections"] : ["openFile"],
          filters,
        });
      } else {
        res = await dialog.showOpenDialog(win ?? undefined, {
          title: `${title}（文件夹）`,
          properties: multi ? ["openDirectory", "multiSelections"] : ["openDirectory"],
        });
      }
    } else {
      res = await dialog.showOpenDialog(win ?? undefined, {
        title,
        properties: multi ? ["openFile", "multiSelections"] : ["openFile"],
        filters,
      });
    }

    if (res.canceled || !res.filePaths?.length) {
      return { ok: false, canceled: true };
    }
    const pathKinds = res.filePaths.map((p) => {
      try {
        const st = fs.statSync(p);
        return st.isDirectory() ? "directory" : "file";
      } catch {
        return "file";
      }
    });
    return { ok: true, filePaths: res.filePaths, pathKinds };
  });

  /** Save text to a path chosen by the user (另存为). */
  ipcMain.handle("lawmind:dialog:save-text-file", async (evt, payload) => {
    const content = typeof payload?.content === "string" ? payload.content : "";
    const defaultName = typeof payload?.defaultName === "string" ? payload.defaultName : "未命名.txt";
    const win =
      BrowserWindow.fromWebContents(evt.sender) ??
      mainWindowRef ??
      BrowserWindow.getFocusedWindow();
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
    if (typeof url !== "string") {
      return { ok: false, error: "invalid_url" };
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "protocol_not_allowed" };
      }
      void shell.openExternal(parsed.toString());
      return { ok: true };
    } catch {
      return { ok: false, error: "invalid_url" };
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
  // #region agent log
  dbgLog("main.mjs:createWindow", "enter", {}, "B");
  // #endregion
  await ensureBackend();
  // #region agent log
  dbgLog("main.mjs:createWindow", "after ensureBackend", { apiPort }, "E");
  // #endregion

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

  // #region agent log
  dbgLog("main.mjs:createWindow", "BrowserWindow created", { sandbox: app.isPackaged }, "B");
  // #endregion

  installLawmindContentSecurityPolicy(session.defaultSession);

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
  const distIndex = path.join(__dirname, "..", "dist", "index.html");
  const useDistInE2e =
    process.env.LAWMIND_E2E === "1" && fs.existsSync(distIndex);
  if (!app.isPackaged && !useDistInE2e) {
    // #region agent log
    dbgLog("main.mjs:createWindow", "before loadURL", { devUrl }, "C");
    // #endregion
    await mainWindow.loadURL(devUrl);
    // #region agent log
    dbgLog("main.mjs:createWindow", "after loadURL", {}, "C");
    // #endregion
    if (process.env.LAWMIND_E2E !== "1") {
      // #region agent log
      dbgLog("main.mjs:createWindow", "before openDevTools", {}, "C");
      // #endregion
      mainWindow.webContents.openDevTools({ mode: "detach" });
      // #region agent log
      dbgLog("main.mjs:createWindow", "after openDevTools", {}, "C");
      // #endregion
    }
  } else {
    await mainWindow.loadFile(useDistInE2e ? distIndex : path.join(__dirname, "..", "dist", "index.html"));
  }
}

void app.whenReady().then(async () => {
  try {
    // #region agent log
    dbgLog("main.mjs:whenReady", "start", { electronVersion: process.versions.electron }, "H0");
    // #endregion
    registerIpcHandlers();
    // #region agent log
    dbgLog("main.mjs:whenReady", "after registerIpcHandlers", {}, "H0");
    // #endregion
    setupApplicationMenu();
    // #region agent log
    dbgLog("main.mjs:whenReady", "after setupApplicationMenu", {}, "H0");
    // #endregion
    await createWindow();
    // #region agent log
    dbgLog("main.mjs:whenReady", "createWindow complete", {}, "H0");
    // #endregion
    if (process.env.LAWMIND_E2E !== "1" && process.env.LAWMIND_SKIP_AUTO_UPDATE !== "1") {
      setTimeout(() => {
        void runAutoUpdateCheckWithNotify();
      }, 12_000);
    }
  } catch (err) {
    // #region agent log
    dbgLog("main.mjs:whenReady", "startup failed", { message: err instanceof Error ? err.message : String(err) }, "H7");
    // #endregion
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
