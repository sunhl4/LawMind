import { app, dialog } from "electron";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __electronDir = path.dirname(fileURLToPath(import.meta.url));
const requireCjs = createRequire(import.meta.url);

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
export const KEYCHAIN_ACCOUNTS = {
  wizardApiKey: "wizard.default.apiKey",
  webSearchApiKey: "wizard.webSearch.apiKey",
  customApiKey: (modelId) => `custom.${String(modelId).replace(/^custom:/, "")}.apiKey`,
  mcpSecret: (serverId) => `mcp.${String(serverId).replace(/[^a-zA-Z0-9_-]/g, "_")}.secret`,
};

export { keyVault };

/**
 * Resolve all known secrets to inject into the local server subprocess.
 * Returns plain `{ ENV_NAME: value }` map (best-effort; never throws).
 */
export async function collectSecretsForServerEnv(parsedEnvVars) {
  const out = {};
  if (!keyVault.isAvailable()) {
    return out;
  }
  try {
    const wizardKey = await keyVault.readSecret(KEYCHAIN_ACCOUNTS.wizardApiKey);
    if (wizardKey) {
      if (!parsedEnvVars.LAWMIND_AGENT_API_KEY) {out.LAWMIND_AGENT_API_KEY = wizardKey;}
      if (!parsedEnvVars.LAWMIND_QWEN_API_KEY) {out.LAWMIND_QWEN_API_KEY = wizardKey;}
    }
    const webSearchKey = await keyVault.readSecret(KEYCHAIN_ACCOUNTS.webSearchApiKey);
    if (webSearchKey) {
      if (!parsedEnvVars.LAWMIND_WEB_SEARCH_API_KEY) {out.LAWMIND_WEB_SEARCH_API_KEY = webSearchKey;}
      if (!parsedEnvVars.BRAVE_API_KEY) {out.BRAVE_API_KEY = webSearchKey;}
    }
    const all = await keyVault.listSecrets();
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
    for (const entry of all) {
      const mcp = /^mcp\.([^.]+)\.secret$/.exec(entry.account);
      if (!mcp) {continue;}
      const value = await keyVault.readSecret(entry.account);
      if (value) {
        const envName = `LAWMIND_MCP_${mcp[1].replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_SECRET`;
        out[envName] = value;
      }
    }
  } catch (err) {
    console.warn("[LawMind] keychain read failed; subprocess will run without injected secrets.", err);
  }
  return out;
}

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
export let apiPort = 0;
export let apiAuthToken = "";
export let workspaceDir = "";
export let projectDir = null;
export let envFilePath = "";
export let lawMindRoot = "";
export let configPath = "";
let serverStarted = false;

export function resolveRepoRoot() {
  if (process.env.LAWMIND_REPO_ROOT) {
    return path.resolve(process.env.LAWMIND_REPO_ROOT);
  }
  return path.resolve(__electronDir, "..", "..", "..");
}

export function validateRepoRoot(root) {
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

export function lawMindPaths() {
  const root = path.join(app.getPath("userData"), "LawMind");
  const cfgPath = path.join(root, "desktop-config.json");
  let workspaceOverride = null;
  let projectOverride = null;
  let retrievalMode = "single";
  try {
    if (fs.existsSync(cfgPath)) {
      const j = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
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
  const wsDir = workspaceOverride || path.join(root, "workspace");
  const envPath = path.join(root, ".env.lawmind");
  return {
    lawMindRoot: root,
    configPath: cfgPath,
    workspaceDir: wsDir,
    projectDir: projectOverride,
    envFilePath: envPath,
    retrievalMode,
  };
}

/** Parse a `.env.lawmind` file body into a `{ KEY: VALUE }` map. */
export function parseEnvAssignmentsTopLevel(content) {
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
export function defaultModelIdForWizardModel(modelName) {
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

export function writeWizardDefaultModelId(root, modelName) {
  const modelsPath = path.join(root, "models.json");
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

export function getBundledServerScript() {
  if (!app.isPackaged) {
    return null;
  }
  const p = path.join(process.resourcesPath, "lawmind-server", "lawmind-local-server.cjs");
  return fs.existsSync(p) ? p : null;
}

/** Matches vendor script output: resources/node-runtime/<platform-arch>/ */
export function nodeRuntimeKey() {
  return `${process.platform}-${process.arch}`;
}

/**
 * Prefer LAWMIND_NODE_BIN, then packaged Node under extraResources, then PATH `node`.
 */
export function resolveNodeExecutable() {
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

async function startLocalServer(repoRoot, wsDir, envPath, retrievalMode, projectPath) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await startLocalServerOnce(repoRoot, wsDir, envPath, retrievalMode, projectPath);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // pickPort→bind 竞态（listen(0)+close 后端口被抢注）：杀残留子进程、换端口重试。
      try {
        serverProcess?.kill();
      } catch {
        /* ignore */
      }
      serverProcess = null;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}

async function startLocalServerOnce(repoRoot, wsDir, envPath, retrievalMode, projectPath) {
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
        resolve(port);
      })
      .catch(reject);
  });
}

/**
 * One-time migration: copy plaintext keys from `.env.lawmind` into the OS keychain
 * when keychain is empty. Keys remain in the env file so restarts do not require re-entry.
 */
export async function maybeMigrateEnvKeysToKeychain(envPath) {
  if (!keyVault.isAvailable()) {return;}
  if (!fs.existsSync(envPath)) {return;}
  let vars;
  try {
    vars = parseEnvAssignmentsTopLevel(fs.readFileSync(envPath, "utf8"));
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
export async function postLocalModelTest(modelId) {
  const url = `http://127.0.0.1:${apiPort}/api/models/test`;
  const headers = {
    "content-type": "application/json",
    ...(apiAuthToken ? { authorization: `Bearer ${apiAuthToken}` } : {}),
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
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
    if (res.status === 401 || body.code === "invalid_api_token") {
      return {
        ok: false,
        code: "local_api_unauthorized",
        error: `本地 API 鉴权失败（HTTP ${res.status}）。请确保重启后 token 已正确注入。`,
      };
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

export function getAllowedRoots() {
  const roots = {
    workspace: workspaceDir,
  };
  if (projectDir) {
    roots.project = projectDir;
  }
  return roots;
}

export function setProjectDir(next) {
  projectDir = next;
}

export async function restartBackendInternal() {
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

export async function ensureBackend() {
  if (serverStarted) {
    return;
  }
  await restartBackendInternal();
}

export function killLocalServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  serverStarted = false;
}

export function isWorkspaceDaemonEnabled(wsDir = workspaceDir) {
  if (!wsDir) {
    return false;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(wsDir, "lawmind", "daemon.json"), "utf8"));
    return raw.enabled === true;
  } catch {
    return false;
  }
}

function isWorkspaceDaemonPidAlive(wsDir) {
  try {
    const pid = Number(fs.readFileSync(path.join(wsDir, "lawmind", "daemon.pid"), "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) {
      return false;
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Keep in sync with `buildDaemonProcessEnv` in `src/lawmind/platform/lawmind-daemon.ts`. */
function buildDaemonProcessEnv(source, extra) {
  const hostKeys = new Set(["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "NODE_PATH"]);
  const deny = new Set(["LAWMIND_LOCAL_API_TOKEN", "LAWMIND_SKIP_API_AUTH", "LAWMIND_DESKTOP_PORT"]);
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (value == null || value === "") {
      continue;
    }
    if (deny.has(key)) {
      continue;
    }
    if (hostKeys.has(key) || key.startsWith("LAWMIND_") || key.startsWith("BRAVE_")) {
      out[key] = value;
    }
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value != null && value !== "") {
        out[key] = value;
      }
    }
  }
  out.LAWMIND_DAEMON = "1";
  delete out.LAWMIND_LOCAL_API_TOKEN;
  delete out.LAWMIND_SKIP_API_AUTH;
  delete out.LAWMIND_DESKTOP_PORT;
  return out;
}

/** After the desktop quits, keep automations ticking on this machine. */
export function spawnWorkspaceDaemon() {
  const wsDir = workspaceDir;
  if (!wsDir || !isWorkspaceDaemonEnabled(wsDir) || isWorkspaceDaemonPidAlive(wsDir)) {
    return false;
  }
  const bundled = getBundledServerScript();
  const cmd = resolveNodeExecutable();
  const repoRoot = bundled ? path.dirname(bundled) : resolveRepoRoot();
  let args;
  let cwd = repoRoot;
  if (bundled) {
    args = [bundled];
    cwd = path.dirname(bundled);
  } else {
    const serverScript = path.join(repoRoot, "apps", "lawmind-desktop", "server", "lawmind-local-server.ts");
    if (!fs.existsSync(serverScript)) {
      return false;
    }
    args = ["--import", "tsx", serverScript];
  }
  const child = spawn(cmd, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    env: buildDaemonProcessEnv(process.env, {
      LAWMIND_WORKSPACE_DIR: wsDir,
      LAWMIND_ENV_FILE: envFilePath || "",
      LAWMIND_REPO_ROOT: repoRoot,
    }),
  });
  child.unref();
  return true;
}
