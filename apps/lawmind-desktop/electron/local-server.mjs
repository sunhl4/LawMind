import { app, BrowserWindow, dialog } from "electron";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  computeSupervisionBackoffMs,
  SERVER_SUPERVISION_DEFAULTS,
  shouldAttemptSupervisedRestart,
} from "./server-supervision.mjs";
import { LAWMIND_PRODUCT_NAME } from "./brand.mjs";
import { credentialForClient } from "./local-api-credentials.mjs";
import {
  buildPortDrift,
  classifyDiscoveryResponse,
  manifestInstructions,
  resolveManifestTargets,
} from "./local-api-port-contract.mjs";
import { hostAccessFilePath, rootsFromStore } from "./host-access-store.mjs";
import { applyOfficeCliEnv, resolveOfficeCliExecutable } from "./officecli-runtime.mjs";
import {
  defaultModelIdForWizardModel,
  inferWizardProviderId,
  writeWizardDefaultModelId,
} from "./wizard-model-store.mjs";

export { defaultModelIdForWizardModel, inferWizardProviderId, writeWizardDefaultModelId };

const electronDir = path.dirname(fileURLToPath(import.meta.url));
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
  /** 审计链 HMAC 密钥（hex）：keychain 保管，注入子进程；headless 降级为工作区外 key 文件。 */
  auditChainKey: "audit.hashChainKey",
  /** 邮件凭证落盘加密密钥（hex）：同上分层。 */
  mailSecretsKey: "mail.secretsKey",
  /**
   * 本机 API **安装密钥**（hex）：回环 API 的跨重启根密钥。
   *
   * 所有客户端凭据都由它派生（`credential(clientId) = HMAC(secret, clientId:epoch)`），
   * 所以它必须比进程活得久 —— 这正是修掉「重启后 Word 窗格报 unauthorized」的那一步。
   * 轮换它等于换掉所有客户端凭据；要撤单个客户端用吊销名单，不要动它。
   */
  localApiInstallationSecret: "localApi.installationSecret",
};

export { keyVault };

/**
 * 读取或生成一把 keychain 保管的本地对称密钥（hex）。
 * keychain 不可用时返回 null——子进程引擎会降级为工作区外 0600 key 文件。
 */
async function ensureKeychainLocalKey(account) {
  const existing = await keyVault.readSecret(account);
  if (existing) {
    return existing;
  }
  const generated = randomBytes(32).toString("hex");
  const saved = await keyVault.saveSecret(account, generated);
  return saved ? generated : null;
}

/**
 * 本机 API 安装密钥：keychain 优先，不可用时降级为**工作区之外**的 0600 文件。
 *
 * 分层的理由与 `auditChainKey` / `mailSecretsKey` 完全一致：keychain 在无桌面会话
 * （headless / CI）时不可用，此时不能让鉴权直接失效，也不能把根密钥写进工作区。
 *
 * **为什么必须落在工作区之外**：`workspace/` 是 agent 可写区（Skills 就在那儿播种），
 * 把鉴权根密钥放进去，等于让被审查的材料有机会改掉自己的锁。`lawMindRoot` 是
 * `<userData>/LawMind`，在工作区之外，也落在 `LAWMIND_USER_DATA_DIR` 的 E2E 隔离里。
 */
async function ensureLocalApiInstallationSecret() {
  if (keyVault.isAvailable()) {
    const existing = await keyVault.readSecret(KEYCHAIN_ACCOUNTS.localApiInstallationSecret);
    if (existing && /^[0-9a-f]{64}$/.test(existing.trim())) {
      return existing.trim();
    }
    const generated = randomBytes(32).toString("hex");
    const saved = await keyVault.saveSecret(
      KEYCHAIN_ACCOUNTS.localApiInstallationSecret,
      generated,
    );
    if (saved) {
      return generated;
    }
  }

  const secretPath = path.join(lawMindPaths().lawMindRoot, "local-api-installation-secret");
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(existing)) {
      return existing;
    }
  } catch {
    /* 首次运行或文件不可读：下面重建 */
  }
  const generated = randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    // 0600：只有本用户可读。密钥不进日志、不进环境变量的历史记录以外的地方。
    fs.writeFileSync(secretPath, `${generated}\n`, { mode: 0o600 });
  } catch (err) {
    console.warn("[LawMind] 无法写入本机 API 安装密钥文件；本次为进程内临时密钥。", err);
  }
  return generated;
}

/**
 * 凭据代次与吊销名单（非秘密，放 `desktop-config.json`）。
 *
 * 放配置文件而不是 keychain，是因为它们要能被「看」：排障时最常问的两件事正是
 * 「现在第几代」与「哪个客户端被撤了」。密钥才需要藏。
 */
function readLocalApiCredentialState() {
  try {
    const raw = JSON.parse(fs.readFileSync(lawMindPaths().configPath, "utf8"));
    const epoch = Number(raw?.localApiEpoch);
    const revoked = Array.isArray(raw?.localApiRevokedClients)
      ? raw.localApiRevokedClients.map((x) => String(x).trim()).filter(Boolean)
      : [];
    return {
      epoch: Number.isInteger(epoch) && epoch > 0 ? epoch : 1,
      revokedClients: revoked,
    };
  } catch {
    return { epoch: 1, revokedClients: [] };
  }
}

/**
 * 缓存注入子进程的本地密钥，供 lawmindd（quit 时 spawn，同步路径）复用同一批密钥，
 * 避免桌面服务器与 daemon 各持一把钥匙导致审计链/邮件凭证跨进程不一致。
 */
let cachedLocalKeyEnv = {};

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
      const wizardUrl =
        parsedEnvVars.LAWMIND_AGENT_BASE_URL || parsedEnvVars.LAWMIND_QWEN_BASE_URL || "";
      const provider = inferWizardProviderId(wizardUrl);
      if (!parsedEnvVars.LAWMIND_AGENT_API_KEY) {out.LAWMIND_AGENT_API_KEY = wizardKey;}
      if (provider === "dashscope" && !parsedEnvVars.LAWMIND_QWEN_API_KEY) {
        out.LAWMIND_QWEN_API_KEY = wizardKey;
      }
      if (provider === "deepseek" && !parsedEnvVars.LAWMIND_DEEPSEEK_API_KEY) {
        out.LAWMIND_DEEPSEEK_API_KEY = wizardKey;
      }
      if (provider === "openai" && !parsedEnvVars.LAWMIND_PROVIDER_OPENAI_API_KEY) {
        out.LAWMIND_PROVIDER_OPENAI_API_KEY = wizardKey;
      }
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
    const auditChainKey = await ensureKeychainLocalKey(KEYCHAIN_ACCOUNTS.auditChainKey);
    if (auditChainKey) {
      out.LAWMIND_AUDIT_CHAIN_KEY = auditChainKey;
    }
    const mailSecretsKey = await ensureKeychainLocalKey(KEYCHAIN_ACCOUNTS.mailSecretsKey);
    if (mailSecretsKey) {
      out.LAWMIND_MAIL_SECRETS_KEY = mailSecretsKey;
    }
    cachedLocalKeyEnv = {
      ...(out.LAWMIND_AUDIT_CHAIN_KEY ? { LAWMIND_AUDIT_CHAIN_KEY: out.LAWMIND_AUDIT_CHAIN_KEY } : {}),
      ...(out.LAWMIND_MAIL_SECRETS_KEY ? { LAWMIND_MAIL_SECRETS_KEY: out.LAWMIND_MAIL_SECRETS_KEY } : {}),
    };
  } catch (err) {
    console.warn("[LawMind] keychain read failed; subprocess will run without injected secrets.", err);
  }
  return out;
}

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
export let apiPort = 0;
/**
 * **主进程自己**的本地 API 凭据（clientId=`desktop`）。
 *
 * 主进程是本地 API 的一个独立客户端（健康检查、模型探活），所以它有自己的身份，
 * 不与渲染层共用。渲染层拿的是 `rendererAuthToken`。
 */
export let apiAuthToken = "";
/**
 * **渲染层**的凭据（clientId=`renderer`）。经 IPC（`lawmind:get-config` /
 * `lawmind:loopback-config`）下发，不下发安装密钥本身。
 */
export let rendererAuthToken = "";
/** 凭据代次（轮换 = +1；服务端接受 epoch 与 epoch-1）。 */
export let localApiEpoch = 1;
/** 被吊销的客户端名单（撤单个客户端用这里，不要动安装密钥）。 */
export let localApiRevokedClients = [];
/** 本进程实例标识（非秘密，供客户端陈旧检测）。 */
export let localApiInstanceId = "";
/**
 * 端口漂移记录：持久化端口没绑上、回退到别的端口时非空。
 *
 * 形状 `{ requestedPort, actualPort, occupant }`，`occupant` ∈
 * `another-lawmind`（另一个 LawMind 实例占着）/ `foreign`（外部程序）/ `unknown`。
 *
 * 为什么要暴露而不是只打日志：Word 侧载清单把端口钉死，漂移 ⇒ **所有已侧载窗格失联**，
 * 且窗格自己无法重新发现（发现端点也在旧 base 上）。这是「静默违反持久化契约」，
 * 必须让律师在体检面板里看得见，而不是等在 Word 里报一句没头没尾的加载失败。
 * 根因治理见 `main.mjs` 的单实例锁。
 */
export let loopbackPortDrift = null;
export let workspaceDir = "";
export let projectDir = null;
export let envFilePath = "";
export let lawMindRoot = "";
export let configPath = "";
let serverStarted = false;

// ── 崩溃监督状态 ──
// intentionalStop 区分「正常停止」（killLocalServer / 手动重启 / 应用退出）与
// 「意外退出」；只有后者触发监督重启。supervisionAttempts 在重启成功（ready）后归零。
let intentionalStop = false;
let supervisionAttempts = 0;
let supervisionTimer = null;

function clearSupervisionTimer() {
  if (supervisionTimer) {
    clearTimeout(supervisionTimer);
    supervisionTimer = null;
  }
}

function onServerProcessExit(code) {
  if (!serverStarted || intentionalStop) {
    // 启动重试循环内的失败由 startLocalServer 自己兜底；正常停止不监督。
    return;
  }
  serverStarted = false;
  scheduleSupervisedRestart(`exit code ${code}`);
}

function scheduleSupervisedRestart(reason) {
  if (supervisionTimer) {
    return; // 已排队，避免重复调度。
  }
  supervisionAttempts += 1;
  if (!shouldAttemptSupervisedRestart(supervisionAttempts)) {
    console.error(
      `[LawMind] local server crashed repeatedly (${reason}); giving up after ${SERVER_SUPERVISION_DEFAULTS.maxAttempts} supervised restarts.`,
    );
    void dialog
      .showMessageBox({
        type: "error",
        title: LAWMIND_PRODUCT_NAME,
        message: "LawMind 本地服务多次崩溃，已停止自动重启。",
        detail: "请在设置页检查环境后手动重启本地服务；若持续崩溃请查看日志定位原因。",
      })
      .catch(() => {});
    return;
  }
  const delayMs = computeSupervisionBackoffMs(supervisionAttempts);
  console.warn(
    `[LawMind] local server exited unexpectedly (${reason}); supervised restart ${supervisionAttempts}/${SERVER_SUPERVISION_DEFAULTS.maxAttempts} in ${delayMs}ms`,
  );
  supervisionTimer = setTimeout(() => {
    supervisionTimer = null;
    restartBackendInternal().catch((err) => {
      console.error("[LawMind] supervised restart failed:", err);
      // 启动失败计入下一次退避；到上限后放弃并表面化。
      scheduleSupervisedRestart("restart failed");
    });
  }, delayMs);
  supervisionTimer.unref?.();
}

export function resolveRepoRoot() {
  if (process.env.LAWMIND_REPO_ROOT) {
    return path.resolve(process.env.LAWMIND_REPO_ROOT);
  }
  return path.resolve(electronDir, "..", "..", "..");
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
  // userData 的唯一决策点在 pinDevUserData（main 启动时调用），这里只读结果。
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

export function resolveOfficeCliForServer(repoRoot = resolveRepoRoot()) {
  return resolveOfficeCliExecutable({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    repoRoot,
  });
}

function withOfficeCliServerEnv(baseEnv, repoRoot) {
  const bin = resolveOfficeCliForServer(repoRoot);
  const next = applyOfficeCliEnv(baseEnv, bin);
  if (app.isPackaged) {
    next.LAWMIND_RESOURCES_PATH = process.resourcesPath;
  }
  return next;
}

/** 向内核要一个空闲回环端口。 @returns {Promise<number>} */
function listenEphemeralPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const p = typeof addr === "object" && addr && "port" in addr ? addr.port : 0;
      s.close(() => resolve(p));
    });
  });
}

/**
 * Prefer the previous loopback port so the renderer does not keep a dead apiBase.
 * @returns {Promise<number>}
 */
function pickPort(preferred = 0) {
  const want = preferred;
  if (!Number.isInteger(want) || want <= 0 || want > 65535) {
    return listenEphemeralPort();
  }
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", () => {
      listenEphemeralPort().then(resolve, reject);
    });
    s.listen(want, "127.0.0.1", () => {
      s.close(() => resolve(want));
    });
  });
}

/**
 * 上次成功绑定的本机 API 端口（持久化在 `desktop-config.json`）。
 *
 * 为什么需要：`apiPort` 只是**进程内**记忆，整个 app 重启后会归零 → `pickPort(0)` 走
 * `listen(0)` 拿随机端口。于是端口每次启动都换一个，而 Word 插件侧载的 `manifest.xml`
 * 里写死的是取清单那一刻的端口 → 律师侧载一次，重启 app 后插件就加载不出来。
 * 持久化后跨重启复用同一端口，侧载清单不再失效。
 *
 * **但「回退随机」这一步是静默的，而这正是 2026-09-21 那次故障的根因**：
 * 持久化端口被另一个实例占着时，app 悄悄换到随机端口，于是所有已侧载的 Word 窗格
 * 全部失联 —— 而且窗格无处重新发现新端口（发现端点也挂在旧 base 上）。
 * 所以现在把漂移**记录下来并暴露出去**（见 `loopbackPortDrift`）。
 */
function readPersistedApiPort() {
  try {
    const raw = fs.readFileSync(lawMindPaths().configPath, "utf8");
    const value = Number(JSON.parse(raw)?.apiPort);
    return Number.isInteger(value) && value > 0 && value <= 65535 ? value : 0;
  } catch {
    return 0;
  }
}

/** 该端口现在能不能绑（能绑 = 没有占用者）。 */
function isPortBindable(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => {
      s.close(() => resolve(true));
    });
  });
}

/**
 * 谁占着这个端口 —— 决定要不要告诉用户「另一个 LawMind 正在跑」。
 *
 * 判据不是进程名（不可靠），而是**问它是不是本机 API**：发现端点只有 LawMind 会回，
 * 且回的是我们的形状（判定逻辑在纯模块里，可单测）。
 */
async function probePortOccupant(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/lawmind-local`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) {
      return "foreign";
    }
    return classifyDiscoveryResponse(await res.json());
  } catch {
    // 连不上或不是 HTTP：可能是外部程序，也可能是刚死的残留。区分不了就如实说。
    return "unknown";
  }
}

/**
 * 「重新侧载 Word 清单」：用**当前**端口重新生成清单并装回去。
 *
 * 为什么需要这个动作：清单里的回环地址是**生成时**按请求 `Host` 现场替换的，但律师
 * 存盘并侧载之后就**钉死**在那个文件里了。所以端口一旦变化（见 `loopbackPortDrift`），
 * 唯一出路就是用当前端口重新生成并重新安装 —— 此前这一步只能照文档手工做。
 *
 * 落点优先级：
 *   1. Word 的 wef 侧载目录（macOS：`~/Library/Containers/com.microsoft.Word/.../wef/`）
 *      —— 直接可用，重启 Word 即生效；
 *   2. Word 容器不存在（没装 Word / 换平台）→ 退到下载目录，让律师自己拖进去。
 *
 * 清单由**服务端现场生成**（不是本地拼模板），这样端口与模板只有一处真相；
 * 静态面 GET 本就免 bearer，所以这里不需要凭据。
 */
export async function syncWordAddinManifest() {
  if (!apiPort) {
    return { ok: false, error: "本机服务尚未启动。" };
  }
  const base = `http://localhost:${apiPort}`;
  let manifest;
  try {
    const res = await fetch(`${base}/word-addin/manifest.xml`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ok: false, error: `取清单失败（HTTP ${res.status}）。` };
    }
    manifest = await res.text();
  } catch (err) {
    return {
      ok: false,
      error: `取清单失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const attempts = resolveManifestTargets({
    platform: process.platform,
    home: app.getPath("home"),
    downloads: app.getPath("downloads"),
    exists: (p) => fs.existsSync(p),
  });

  for (const attempt of attempts) {
    const file = path.join(attempt.dir, "manifest.xml");
    try {
      fs.mkdirSync(attempt.dir, { recursive: true });
      fs.writeFileSync(file, manifest, "utf8");
      return {
        ok: true,
        apiBase: base,
        path: file,
        location: attempt.location,
        bytes: Buffer.byteLength(manifest, "utf8"),
        instructions: manifestInstructions(attempt.location, base),
      };
    } catch (err) {
      attempts.push({
        location: `${attempt.location}-failed`,
        dir: attempt.dir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const failed = attempts.filter((a) => a.location.endsWith("-failed"));
  return {
    ok: false,
    apiBase: base,
    error: `写入清单失败：${failed.map((f) => `${f.dir}（${f.error}）`).join("；")}`,
  };
}

/** Best-effort：端口复用是优化，写盘失败绝不能影响启动。 */
function persistApiPort(port) {  if (!Number.isInteger(port) || port <= 0) {
    return;
  }
  try {
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
    fs.writeFileSync(
      paths.configPath,
      `${JSON.stringify({ ...prev, apiPort: port }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

function broadcastLoopbackConfig() {
  if (!apiPort || !rendererAuthToken) {
    return;
  }
  const payload = {
    apiBase: `http://127.0.0.1:${apiPort}`,
    // 发给渲染层的是**它自己的**凭据（clientId=renderer），不是主进程那把，
    // 也不是安装密钥。协议形状与改造前一致，故渲染层无需改动即可继续工作。
    apiAuthToken: rendererAuthToken,
    instanceId: localApiInstanceId,
    epoch: localApiEpoch,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      continue;
    }
    win.webContents.send("lawmind:loopback-config", payload);
  }
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
  // 进程内优先复用上次端口；跨 app 重启则复用持久化的端口（侧载清单不失效）。
  const preferredPort = apiPort || readPersistedApiPort();
  // 先判定「持久化端口是否被占、被谁占」—— 这一步只为诊断，绑定仍交给 pickPort。
  const occupant =
    preferredPort > 0 && !(await isPortBindable(preferredPort))
      ? await probePortOccupant(preferredPort)
      : null;
  const port = await pickPort(preferredPort);
  apiPort = port;
  persistApiPort(port);

  // 端口漂移 = 静默破坏侧载契约。记下来（体检面板可见），并在日志里说清后果。
  loopbackPortDrift = buildPortDrift({
    preferredPort,
    actualPort: port,
    occupant: occupant ?? "unknown",
  });
  if (loopbackPortDrift) {
    const who =
      occupant === "another-lawmind"
        ? "另一个 LawMind 实例"
        : occupant === "foreign"
          ? "其它程序"
          : "其它程序（该端口不响应本机 API 探测，无法进一步区分）";
    console.warn(
      `[LawMind] 本机 API 端口从 ${preferredPort} 漂移到 ${port}：${preferredPort} 被${who}占用。` +
        `Word 加载项的侧载清单把端口钉死（http://localhost:${preferredPort}/word-addin/taskpane.html），` +
        `因此在重新侧载清单之前，已打开的窗格会报「无法加载」或加载失败。` +
        `请在「设置 → 体检」里用「重新侧载 Word 清单」修复。`,
    );
  }

  // ── 派生式凭据（本次改造的核心）─────────────────────────────────────────
  // 安装密钥**跨重启持久**，所以同一 clientId 的凭据不随重启变化 ⇒ 已经打开的
  // Word 窗格与渲染层不再因重启而 401。改造前这里是 `randomBytes(32)`：
  // 端口持久化 + 令牌每进程轮换 + 加载项只能一次性取令牌 ⇒ 重启必然打断所有客户端。
  const installationSecret = await ensureLocalApiInstallationSecret();
  const credentialState = readLocalApiCredentialState();
  localApiEpoch = credentialState.epoch;
  localApiRevokedClients = credentialState.revokedClients;
  localApiInstanceId = randomBytes(8).toString("hex");
  // 主进程自己也走独立身份（它要健康检查、探模型），不再和渲染层共用一把钥匙。
  apiAuthToken = credentialForClient(installationSecret, "desktop", localApiEpoch);
  rendererAuthToken = credentialForClient(installationSecret, "renderer", localApiEpoch);
  // 没有 IPC 通道的客户端（脚本 / CLI）从发现文件取凭据。
  writeLocalApiClientFile(installationSecret, localApiEpoch);

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

  let auditExternalAnchorUrl = "";
  try {
    const deskSettingsPath = path.join(wsDir, "lawmind", "desk-settings.json");
    if (fs.existsSync(deskSettingsPath)) {
      const ds = JSON.parse(fs.readFileSync(deskSettingsPath, "utf8"));
      if (typeof ds.auditExternalAnchorUrl === "string") {
        auditExternalAnchorUrl = ds.auditExternalAnchorUrl.trim();
      }
    }
  } catch {
    /* ignore bad settings */
  }

  const mode = retrievalMode === "dual" ? "dual" : "single";
  if (app.isPackaged && process.env.LAWMIND_SKIP_API_AUTH === "1") {
    console.warn(
      "[LawMind] LAWMIND_SKIP_API_AUTH=1 is ignored in packaged builds; loopback API auth remains enabled.",
    );
  }
  if (auditExternalAnchorUrl) {
    process.env.LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL = auditExternalAnchorUrl;
  }

  return new Promise((resolve, reject) => {
    const serverEnv = withOfficeCliServerEnv(
      {
        ...process.env,
        LAWMIND_WORKSPACE_DIR: wsDir,
        LAWMIND_DESKTOP_PORT: String(port),
        // 派生式凭据的根：安装密钥 + 代次 + 吊销名单 + 实例标识。
        // 子进程只拿到**密钥**（用于现算各客户端凭据），不参与持久化决策。
        LAWMIND_LOCAL_API_INSTALLATION_SECRET: installationSecret,
        LAWMIND_LOCAL_API_EPOCH: String(localApiEpoch),
        LAWMIND_LOCAL_API_REVOKED_CLIENTS: localApiRevokedClients.join(","),
        LAWMIND_LOCAL_API_INSTANCE_ID: localApiInstanceId,
        LAWMIND_ENV_FILE: envPath,
        LAWMIND_REPO_ROOT: repoRoot,
        LAWMIND_RETRIEVAL_MODE: mode,
        LAWMIND_PROJECT_DIR: projectPath || "",
        LAWMIND_HOST_ACCESS_FILE: hostAccessFilePath(lawMindPaths().lawMindRoot),
        ...(auditExternalAnchorUrl
          ? { LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL: auditExternalAnchorUrl }
          : {}),
        ...(app.isPackaged ? { LAWMIND_PACKAGED: "1" } : {}),
        ...injectedSecrets,
      },
      repoRoot,
    );
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
      onServerProcessExit(code);
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
  const paths = lawMindPaths();
  return rootsFromStore(workspaceDir, projectDir, paths.lawMindRoot);
}

export function setProjectDir(next) {
  projectDir = next;
}

export async function restartBackendInternal() {
  // 本次（重）启动前的旧进程停止属正常停止，不触发监督重启。
  intentionalStop = true;
  clearSupervisionTimer();
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
      title: LAWMIND_PRODUCT_NAME,
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
  intentionalStop = false;
  // 重启成功（ready）后归零监督计数，恢复全额退避额度。
  supervisionAttempts = 0;
  broadcastLoopbackConfig();
}

export async function ensureBackend() {
  if (serverStarted) {
    return;
  }
  await restartBackendInternal();
}

/**
 * 无 IPC 通道的客户端（脚本 / CLI）怎么拿到凭据 —— **同用户可读的发现文件**。
 *
 * 三种客户端各有投递通道：桌面主进程与渲染层走 IPC，Word 插件走同源 `config.js`。
 * 只剩 CLI 没有通道。给它单独写一个 0600 发现文件，而不是让它读安装密钥：
 * 前者泄了只能读，后者泄了能为**任意 clientId** 现算凭据（等于根密钥）。
 *
 * 位置在 `lawMindRoot`（`<userData>/LawMind`，工作区之外）——工作区是 agent 可写区，
 * 凭据文件放进去就等于让被审查的材料能给自己签一把钥匙。
 *
 * 形状与 `/.well-known/lawmind-local` 一致（base / epoch / instanceId），
 * 额外带上 `credentials`。文件在应用停止时删除：服务都没了，留着凭据只是脏数据。
 */
function localApiClientFilePath() {
  return path.join(lawMindPaths().lawMindRoot, "local-api-clients.json");
}

function writeLocalApiClientFile(installationSecret, epoch) {
  try {
    const body = {
      base: `http://127.0.0.1:${apiPort}`,
      epoch,
      instanceId: localApiInstanceId,
      // 只写「没有别的投递通道」的客户端 —— 不全量落盘。
      credentials: { cli: credentialForClient(installationSecret, "cli", epoch) },
    };
    fs.writeFileSync(localApiClientFilePath(), `${JSON.stringify(body, null, 2)}\n`, {
      mode: 0o600,
    });
  } catch (err) {
    // 写不进去不影响桌面端与插件（它们不走这个文件），所以只是降级，不是失败。
    console.warn("[LawMind] 未能写出本机 API 的 CLI 凭据文件。", err);
  }
}

/**
 * 只删除**本实例写出**的那一份。
 *
 * 为什么必须比对 instanceId：这个文件在 userData 下，是**跨实例共享**的。
 * 同一台机器上若同时开着两个 LawMind（开发栈 + 打包版、或两个 dev 实例），
 * 无条件 `rm` 会让先退出的那个把另一个正在用的凭据删掉 —— 表现为「CLI 突然说
 * 凭据文件不存在」，而服务其实活得好好的。谁的实例谁负责收尾。
 */
function removeLocalApiClientFile() {
  try {
    const raw = fs.readFileSync(localApiClientFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.instanceId === "string" && parsed.instanceId !== localApiInstanceId) {
      return; // 是别的实例写的，不归我们删。
    }
    fs.rmSync(localApiClientFilePath(), { force: true });
  } catch {
    /* 不存在或不可读：无需处理 */
  }
}

export function killLocalServer() {
  // 正常停止：标记 intentionalStop 并取消排队中的监督重启。
  intentionalStop = true;
  clearSupervisionTimer();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  serverStarted = false;
  removeLocalApiClientFile();
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
  // 凭据根密钥与代次同样在拒绝名单里：daemon 不监听端口，没有理由持有它们。
  const deny = new Set([
    "LAWMIND_LOCAL_API_TOKEN",
    "LAWMIND_SKIP_API_AUTH",
    "LAWMIND_DESKTOP_PORT",
    "LAWMIND_LOCAL_API_INSTALLATION_SECRET",
    "LAWMIND_LOCAL_API_EPOCH",
    "LAWMIND_LOCAL_API_REVOKED_CLIENTS",
    "LAWMIND_LOCAL_API_INSTANCE_ID",
  ]);
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
  delete out.LAWMIND_LOCAL_API_INSTALLATION_SECRET;
  delete out.LAWMIND_LOCAL_API_EPOCH;
  delete out.LAWMIND_LOCAL_API_REVOKED_CLIENTS;
  delete out.LAWMIND_LOCAL_API_INSTANCE_ID;
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
    env: withOfficeCliServerEnv(
      buildDaemonProcessEnv(process.env, {
        LAWMIND_WORKSPACE_DIR: wsDir,
        LAWMIND_ENV_FILE: envFilePath || "",
        LAWMIND_REPO_ROOT: repoRoot,
        // 与桌面服务器同一把审计链/邮件密钥（keychain 来源）；无缓存时 daemon 降级 key 文件。
        ...cachedLocalKeyEnv,
      }),
      repoRoot,
    ),
  });
  child.unref();
  return true;
}
