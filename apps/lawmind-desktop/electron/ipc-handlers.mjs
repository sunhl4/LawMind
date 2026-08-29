import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Notification,
  screen,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  MAX_IMAGE_READ_BYTES,
  MAX_TEXT_READ_BYTES,
  mimeTypeForImagePath,
} from "./fs-bridge.mjs";
import { checkUpdatesWithUi, loadRendererIntoWindow, resolveLawmindDownloadPageUrl } from "./app-menu.mjs";
import {
  KEYCHAIN_ACCOUNTS,
  keyVault,
  apiPort,
  apiAuthToken,
  workspaceDir,
  projectDir,
  envFilePath,
  lawMindRoot,
  configPath,
  lawMindPaths,
  parseEnvAssignmentsTopLevel,
  writeWizardDefaultModelId,
  getBundledServerScript,
  nodeRuntimeKey,
  resolveNodeExecutable,
  ensureBackend,
  restartBackendInternal,
  postLocalModelTest,
  setProjectDir,
} from "./local-server.mjs";

const __electronDir = path.dirname(fileURLToPath(import.meta.url));
const requireCjs = createRequire(import.meta.url);
const { probeModelInline } = requireCjs("./lawmind-model-probe.cjs");

/**
 * @param {{
 *   getMainWindowRef: () => import("electron").BrowserWindow | null;
 *   auxWindows: Map<string, import("electron").BrowserWindow>;
 *   fsBridge: ReturnType<typeof import("./fs-bridge.mjs").createFsBridge>;
 * }} deps
 */
export function registerIpcHandlers(deps) {
  const { getMainWindowRef, auxWindows, fsBridge } = deps;
  const { resolveFsPath, listDirectoryEntries, isLikelyBinary } = fsBridge;

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
      const chatSessionId =
        typeof payload?.chatSessionId === "string" ? payload.chatSessionId.trim() : "";
      const reviewTaskId =
        typeof payload?.reviewTaskId === "string" ? payload.reviewTaskId.trim() : "";
      const reviewMatterIdRaw = payload?.reviewMatterId;
      const reviewMatterId =
        typeof reviewMatterIdRaw === "string" && reviewMatterIdRaw.trim()
          ? reviewMatterIdRaw.trim()
          : null;
      if (openSettingsOnClick) {
        notification.on("click", () => {
          const w = getMainWindowRef() ?? BrowserWindow.getAllWindows()[0];
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
          const w = getMainWindowRef() ?? BrowserWindow.getAllWindows()[0];
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
          const w = getMainWindowRef() ?? BrowserWindow.getAllWindows()[0];
          if (w && !w.isDestroyed()) {
            if (w.isMinimized()) {
              w.restore();
            }
            w.show();
            w.focus();
            w.webContents.send("lawmind:notification-click", {
              reason: "open_workspace_chat",
              chatAssistantId: chatAssistantId || undefined,
              chatSessionId: chatSessionId || undefined,
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

  /** Remove plaintext secrets from `.env.lawmind` after they are stored in the OS keychain. */
  function writeLawmindEnvWithoutKeys(envFilePath, removeKeys) {
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

  const WIZARD_ENV_SECRET_KEYS = [
    "LAWMIND_AGENT_API_KEY",
    "LAWMIND_QWEN_API_KEY",
    "LAWMIND_CHATLAW_API_KEY",
    "LAWMIND_WEB_SEARCH_API_KEY",
    "BRAVE_API_KEY",
  ];

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
        // Env-file keys win over keychain at server bootstrap; strip so the new keychain
        // secret is not shadowed by a stale plaintext key from an earlier save.
        writeLawmindEnvWithoutKeys(paths.envFilePath, WIZARD_ENV_SECRET_KEYS);
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
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        verified: false,
        apiBase: `http://127.0.0.1:${apiPort}`,
        apiAuthToken,
      };
    }

    const serverProbe = await postLocalModelTest("env:current");
    if (!serverProbe.ok) {
      return {
        ok: false,
        verified: false,
        code: serverProbe.code,
        error: `配置已写入 ${paths.envFilePath}，但本地服务验证失败：${serverProbe.error}`,
        apiBase: `http://127.0.0.1:${apiPort}`,
        apiAuthToken,
        envFilePath: paths.envFilePath,
        keyStorage,
      };
    }

    return {
      ok: true,
      verified: true,
      latencyMs: serverProbe.latencyMs ?? inlineProbe.latencyMs,
      apiBase: `http://127.0.0.1:${apiPort}`,
      apiAuthToken,
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

  ipcMain.handle("lawmind:save-mcp-server-secret", async (_evt, payload) => {
    const id =
      typeof payload?.id === "string" && payload.id.trim() ? payload.id.trim() : "";
    const secret =
      typeof payload?.secret === "string" ? payload.secret.trim() : "";
    if (!id) {
      return { ok: false, error: "server_id_required" };
    }
    if (!secret) {
      return { ok: false, error: "secret_required" };
    }
    if (!keyVault.isAvailable()) {
      return { ok: false, error: "keychain_unavailable" };
    }
    try {
      await keyVault.saveSecret(KEYCHAIN_ACCOUNTS.mcpSecret(id), secret);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("lawmind:delete-mcp-server-secret", async (_evt, payload) => {
    const id =
      typeof payload?.id === "string" && payload.id.trim() ? payload.id.trim() : "";
    if (!id) {
      return { ok: false, error: "server_id_required" };
    }
    if (!keyVault.isAvailable()) {
      return { ok: true, removed: false };
    }
    try {
      const removed = await keyVault.deleteSecret(KEYCHAIN_ACCOUNTS.mcpSecret(id));
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
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        apiBase: `http://127.0.0.1:${apiPort}`,
        apiAuthToken,
      };
    }
    return {
      ok: true,
      retrievalMode: next,
      apiBase: `http://127.0.0.1:${apiPort}`,
      apiAuthToken,
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

  ipcMain.handle("lawmind:pick-folder", async () => {
    const res = await dialog.showOpenDialog({
      title: "选择要扫描的历史材料文件夹",
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
    setProjectDir(projectAbs);
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
      const imageMime = mimeTypeForImagePath(relPath);
      const maxBytes = imageMime ? MAX_IMAGE_READ_BYTES : MAX_TEXT_READ_BYTES;
      if (stat.size > maxBytes) {
        throw new Error(`file too large (>${maxBytes} bytes)`);
      }
      const buffer = fs.readFileSync(absPath);
      if (imageMime) {
        return {
          ok: true,
          kind: "image",
          mimeType: imageMime,
          contentBase64: buffer.toString("base64"),
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        };
      }
      if (isLikelyBinary(buffer)) {
        throw new Error("binary file is not editable in this view");
      }
      return {
        ok: true,
        kind: "text",
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
      getMainWindowRef() ??
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
      getMainWindowRef() ??
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
    // 与 fs-bridge 同型根守卫：只允许展示 workspace / project 内的文件，
    // 避免渲染进程被控时探测或暴露任意磁盘路径。
    const roots = [workspaceDir, projectDir].filter((r) => typeof r === "string" && r.trim());
    const insideAllowedRoot = roots.some((root) => {
      const abs = path.resolve(root);
      return resolved === abs || resolved.startsWith(abs + path.sep);
    });
    if (!insideAllowedRoot) {
      return { ok: false, error: "outside_allowed_roots" };
    }
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

  /** Cursor-like aux window (e.g. review delivery preview undocked). */
  ipcMain.handle("lawmind:open-aux-window", async (_evt, payload) => {
    try {
      const kind = typeof payload?.kind === "string" ? payload.kind.trim() : "";
      const taskId = typeof payload?.taskId === "string" ? payload.taskId.trim() : "";
      const title =
        typeof payload?.title === "string" && payload.title.trim()
          ? payload.title.trim()
          : "交付预览";
      if (kind !== "review-preview" || !taskId) {
        return { ok: false, error: "invalid_aux_window" };
      }
      await ensureBackend();
      const key = `${kind}:${taskId}`;
      const existing = auxWindows.get(key);
      if (existing && !existing.isDestroyed()) {
        existing.focus();
        return { ok: true, focused: true };
      }

      const point = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(point);
      const width = 720;
      const height = Math.min(900, Math.max(560, display.workAreaSize.height - 80));
      const x = Math.min(
        Math.max(display.workArea.x, point.x - 48),
        display.workArea.x + display.workArea.width - width,
      );
      const y = Math.min(
        Math.max(display.workArea.y, point.y - 24),
        display.workArea.y + display.workArea.height - height,
      );

      const win = new BrowserWindow({
        width,
        height,
        x,
        y,
        title: `${title} — LawMind`,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__electronDir, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: app.isPackaged,
        },
      });
      auxWindows.set(key, win);
      win.on("closed", () => {
        if (auxWindows.get(key) === win) {
          auxWindows.delete(key);
        }
      });
      win.webContents.setWindowOpenHandler(({ url }) => {
        try {
          const u = new URL(url);
          if (u.protocol === "http:" || u.protocol === "https:") {
            void shell.openExternal(url);
          }
        } catch {
          /* ignore */
        }
        return { action: "deny" };
      });

      const hash = `lm-popout=review-preview&taskId=${encodeURIComponent(taskId)}`;
      await loadRendererIntoWindow(win, hash);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

}
