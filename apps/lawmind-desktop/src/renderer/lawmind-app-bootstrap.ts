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

export async function loadAppBootstrapSnapshot(apiBase: string) {
  const base = apiBase.replace(/\/$/, "");
  const [bootstrapRes, records, collaboration] = await Promise.all([
    fetch(`${base}/api/bootstrap`, { headers: apiAuthHeaders() })
      .then(async (res) => (res.ok ? ((await res.json()) as Record<string, unknown>) : null))
      .catch(() => null),
    loadRecordsPayload(apiBase),
    loadCollaborationPayload(apiBase),
  ]);

  if (bootstrapRes?.ok === true) {
    return {
      health: (bootstrapRes.health ?? {}) as Awaited<ReturnType<typeof loadHealthPayload>>,
      records,
      assistants: {
        ok: true,
        assistants: (bootstrapRes.assistants as Awaited<ReturnType<typeof loadAssistantsPayload>>["assistants"]) ?? [],
        presets: (bootstrapRes.presets as Awaited<ReturnType<typeof loadAssistantsPayload>>["presets"]) ?? [],
      },
      collaboration,
    };
  }

  const [health, assistants] = await Promise.all([
    loadHealthPayload(apiBase),
    loadAssistantsPayload(apiBase),
  ]);
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
  return {
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
}
