import type { CollabSummaryState } from "./LawmindSettingsCollaboration";
import {
  loadAssistantsPayload,
  loadCollaborationPayload,
  loadCollaborationSummaryPayload,
  loadHealthPayload,
  loadRecordsPayload,
} from "./lawmind-app-data";

export type AppConfig = {
  apiBase: string;
  workspaceDir: string;
  projectDir: string | null;
  envFilePath: string;
  retrievalMode: "single" | "dual";
};

function normalizeRetrievalMode(mode: string | null | undefined): "single" | "dual" {
  return mode === "dual" ? "dual" : "single";
}

export async function loadInitialAppConfig(): Promise<AppConfig> {
  const bridge = window.lawmindDesktop;
  if (bridge?.getConfig) {
    const config = await bridge.getConfig();
    return {
      apiBase: config.apiBase,
      workspaceDir: config.workspaceDir,
      projectDir: config.projectDir ?? null,
      envFilePath: config.envFilePath,
      retrievalMode: normalizeRetrievalMode(config.retrievalMode),
    };
  }
  const devApi = (import.meta.env.VITE_LAWMIND_DEV_API as string | undefined)?.trim();
  if (devApi) {
    return {
      apiBase: devApi.replace(/\/$/, ""),
      workspaceDir: "(browser dev / E2E - use Electron for full config)",
      projectDir: null,
      envFilePath: "",
      retrievalMode: "single",
    };
  }
  throw new Error(
    "Preload bridge missing: run `pnpm lawmind:desktop` and use the Electron window (do not open this tab in Chrome/Safari).",
  );
}

export async function loadAppBootstrapSnapshot(apiBase: string) {
  const [health, records, assistants, collaboration] = await Promise.all([
    loadHealthPayload(apiBase),
    loadRecordsPayload(apiBase),
    loadAssistantsPayload(apiBase),
    loadCollaborationPayload(apiBase),
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
