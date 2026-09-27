// TODO(renderer-fetch-proxy): migrate remaining fetch calls to fetchApi / api-client-proxy.
import type { CollabSummaryState } from "./LawmindSettingsCollaboration";
import {
  loadAssistantsPayload,
  loadCollaborationPayload,
  loadCollaborationSummaryPayload,
  loadHealthPayload,
  loadRecordsPayload,
} from "./lawmind-app-data";
import { apiAuthHeaders, setLoopbackApiAuthToken } from "./lawmind-api-auth.ts";
import { isUsableLoopbackBase, persistDevAppConfig } from "./lawmind-dev-config-cache.ts";

export type AppConfig = {
  apiBase: string;
  apiAuthToken?: string;
  workspaceDir: string;
  projectDir: string | null;
  envFilePath: string;
  retrievalMode: "single" | "dual";
  /** Present when loaded from Electron preload `getConfig`. */
  packaged?: boolean;
  appVersion?: string;
  downloadPageUrl?: string;
};

function normalizeRetrievalMode(mode: string | null | undefined): "single" | "dual" {
  return mode === "dual" ? "dual" : "single";
}

export async function loadInitialAppConfig(): Promise<AppConfig> {
  const bridge = window.lawmindDesktop;
  if (bridge?.getConfig) {
    const config = await bridge.getConfig();
    setLoopbackApiAuthToken(config.apiAuthToken);
    const loaded = {
      apiBase: config.apiBase,
      apiAuthToken: config.apiAuthToken,
      workspaceDir: config.workspaceDir,
      projectDir: config.projectDir ?? null,
      envFilePath: config.envFilePath,
      retrievalMode: normalizeRetrievalMode(config.retrievalMode),
      packaged: config.packaged,
      appVersion: config.appVersion,
      downloadPageUrl: config.downloadPageUrl,
    };
    persistDevAppConfig(loaded);
    return loaded;
  }
  throw new Error(
    "Preload bridge missing: LawMind only runs as the local desktop app. Open the installed LawMind app (or `pnpm lawmind:desktop` in development).",
  );
}

export type AppBootstrapShell = {
  health: Awaited<ReturnType<typeof loadHealthPayload>>;
  assistants: Awaited<ReturnType<typeof loadAssistantsPayload>>;
};

/**
 * 首屏分两拍：引导载荷（模型、版本、助手）到了就交给 `onShell`，
 * 任务列表和协作记录在后面到。这只发生在打开窗口和重新连接时，不发生在每次切界面。
 */
export async function loadAppBootstrapSnapshot(
  apiBase: string,
  hooks?: { onShell?: (shell: AppBootstrapShell) => void },
) {
  const base = apiBase.replace(/\/$/, "");
  // 健康检查失败时不能把已经发出的列表请求留成未处理拒绝：
  // 断连会被渲染成页面错误，崩溃恢复把这当成监督失败。
  let recordsError: unknown;
  let collaborationError: unknown;
  const recordsPromise = loadRecordsPayload(apiBase).catch((err: unknown) => {
    recordsError = err;
    return { tasks: [], items: [] };
  });
  const collaborationPromise = loadCollaborationPayload(apiBase).catch((err: unknown) => {
    collaborationError = err;
    return { delegations: [], events: [], gateHistory: [] };
  });
  const bootstrapRes = await fetch(`${base}/api/bootstrap`, { headers: apiAuthHeaders() })
    .then(async (res) => (res.ok ? ((await res.json()) as Record<string, unknown>) : null))
    .catch(() => null);

  let health: AppBootstrapShell["health"];
  let assistants: AppBootstrapShell["assistants"];
  if (bootstrapRes?.ok === true) {
    health = (bootstrapRes.health ?? {}) as AppBootstrapShell["health"];
    assistants = {
      assistants: (bootstrapRes.assistants as AppBootstrapShell["assistants"]["assistants"]) ?? [],
      presets: (bootstrapRes.presets as AppBootstrapShell["assistants"]["presets"]) ?? [],
    };
  } else {
    const [fallbackHealth, fallbackAssistants] = await Promise.all([
      loadHealthPayload(apiBase),
      loadAssistantsPayload(apiBase),
    ]);
    health = fallbackHealth;
    assistants = fallbackAssistants;
  }
  hooks?.onShell?.({ health, assistants });

  const [records, collaboration] = await Promise.all([recordsPromise, collaborationPromise]);
  if (recordsError) {
    throw recordsError;
  }
  if (collaborationError) {
    throw collaborationError;
  }
  return {
    health,
    records,
    assistants,
    collaboration,
  };
}

export async function loadSettingsCollaborationState(apiBase: string): Promise<CollabSummaryState | null> {
  const payload = await loadCollaborationSummaryPayload(apiBase);
  if (!payload.ok) {
    return null;
  }
  return {
    collaborationEnabled: Boolean(payload.collaborationEnabled),
    collaborationHint:
      typeof payload.collaborationHint === "string" ? payload.collaborationHint : undefined,
    delegationCount: Number.isFinite(payload.delegationCount) ? Number(payload.delegationCount) : 0,
  };
}

/** Re-read Electron `getConfig()` so renderer picks up a new local API port after backend restart. */
export async function refreshLocalAppConfig(
  previous?: AppConfig | null,
): Promise<AppConfig | null> {
  const bridge = window.lawmindDesktop;
  if (!bridge?.getConfig) {
    return previous ?? null;
  }
  const config = await bridge.getConfig();
  const apiBase = (config.apiBase ?? "").replace(/\/$/, "");
  const apiAuthToken = config.apiAuthToken?.trim() || undefined;
  if (!isUsableLoopbackBase(apiBase)) {
    return previous ?? null;
  }
  if (apiAuthToken) {
    setLoopbackApiAuthToken(apiAuthToken);
  }
  const loaded: AppConfig = {
    apiBase,
    apiAuthToken: apiAuthToken ?? previous?.apiAuthToken,
    workspaceDir: config.workspaceDir,
    projectDir: config.projectDir ?? null,
    envFilePath: config.envFilePath,
    retrievalMode: normalizeRetrievalMode(config.retrievalMode),
    packaged: config.packaged,
    appVersion: config.appVersion,
    downloadPageUrl: config.downloadPageUrl,
  };
  persistDevAppConfig(loaded);
  return loaded;
}
