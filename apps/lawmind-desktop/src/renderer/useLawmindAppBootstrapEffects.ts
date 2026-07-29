import { useCallback, useEffect, useState } from "react";
import type { CollabSummaryState } from "./LawmindSettingsCollaboration";
import { errorMessage } from "./api-client";
import { apiAuthHeaders } from "./lawmind-api-auth.ts";
import {
  loadAppBootstrapSnapshot,
  loadInitialAppConfig,
  loadSettingsCollaborationState,
  refreshLocalAppConfig,
  type AppConfig,
} from "./lawmind-app-bootstrap";
import type { HealthPayload } from "./lawmind-app-data.js";
import { readAllowWebSearchPreference } from "./lawmind-web-search-prefs.js";

export type LawmindHealthState = {
  modelConfigured: boolean;
  retrievalMode?: string;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
  webSearchPolicyBlocked?: boolean;
  modelName?: string | null;
  modelEnvFileExists?: boolean;
  draftWithModelEnabled?: boolean;
  draftWithModelActive?: boolean;
  authorityCorpus?: NonNullable<HealthPayload["doctor"]>["authorityCorpus"];
} | null;

export function mapHealthState(payload: {
  modelConfigured?: boolean;
  retrievalMode?: string;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
  modelName?: string | null;
  modelEnvFileExists?: boolean;
  draftWithModelEnabled?: boolean;
  draftWithModelActive?: boolean;
  policy?: HealthPayload["policy"];
  doctor?: HealthPayload["doctor"];
}): NonNullable<LawmindHealthState> {
  return {
    modelConfigured: Boolean(payload.modelConfigured),
    retrievalMode: typeof payload.retrievalMode === "string" ? payload.retrievalMode : undefined,
    dualLegalConfigured: Boolean(payload.dualLegalConfigured),
    webSearchApiKeyConfigured: Boolean(payload.webSearchApiKeyConfigured),
    webSearchPolicyBlocked: payload.policy?.allowWebSearch === false,
    modelName: typeof payload.modelName === "string" ? payload.modelName : null,
    modelEnvFileExists: Boolean(payload.modelEnvFileExists),
    draftWithModelEnabled: payload.draftWithModelEnabled === true,
    draftWithModelActive: payload.draftWithModelActive === true,
    ...(payload.doctor?.authorityCorpus
      ? { authorityCorpus: payload.doctor.authorityCorpus }
      : {}),
    ...(payload.doctor?.authorityUsage
      ? { authorityUsage: payload.doctor.authorityUsage }
      : {}),
  };
}

function applyHealthFromSnapshot(
  snapshot: Awaited<ReturnType<typeof loadAppBootstrapSnapshot>>,
  setHealth: (value: LawmindHealthState) => void,
  setHealthPayload: (value: HealthPayload | null) => void,
  setAllowWebSearchState: (enabled: boolean) => void,
) {
  const nextHealth = mapHealthState(snapshot.health);
  setHealth(nextHealth);
  setHealthPayload(snapshot.health);
  setAllowWebSearchState(
    nextHealth.webSearchPolicyBlocked
      ? false
      : readAllowWebSearchPreference(nextHealth.webSearchApiKeyConfigured === true),
  );
  return nextHealth;
}

export type UseLawmindAppBootstrapEffectsParams = {
  config: AppConfig | null;
  setConfig: (value: AppConfig | null) => void;
  setHealth: (value: LawmindHealthState) => void;
  setHealthPayload: (value: HealthPayload | null) => void;
  setAllowWebSearchState: (enabled: boolean) => void;
  setShowWizard: (open: boolean) => void;
  setWizRetrievalMode: (mode: "single" | "dual") => void;
  setError: (message: string | null) => void;
  applyBootstrapSnapshot: (snapshot: Awaited<ReturnType<typeof loadAppBootstrapSnapshot>>) => void;
  refreshModelsCatalog: (apiBase: string) => Promise<void>;
  showSettings: boolean;
};

export function useLawmindAppBootstrapEffects(params: UseLawmindAppBootstrapEffectsParams) {
  const {
    config,
    setConfig,
    setHealth,
    setHealthPayload,
    setAllowWebSearchState,
    setShowWizard,
    setWizRetrievalMode,
    setError,
    applyBootstrapSnapshot,
    refreshModelsCatalog,
    showSettings,
  } = params;

  const [collabSummarySettings, setCollabSummarySettings] = useState<CollabSummaryState>(undefined);
  const [localServiceReconnecting, setLocalServiceReconnecting] = useState(false);
  const [deskContractBatchDir, setDeskContractBatchDir] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const nextConfig = await loadInitialAppConfig();
        setConfig(nextConfig);
        setWizRetrievalMode(nextConfig.retrievalMode);
      } catch (cause) {
        setError(errorMessage(cause, "加载 LawMind 配置失败"));
      }
    })();
  }, [setConfig, setError, setWizRetrievalMode]);

  useEffect(() => {
    if (!config) {
      return;
    }
    void (async () => {
      try {
        const snapshot = await loadAppBootstrapSnapshot(config.apiBase);
        const nextHealth = applyHealthFromSnapshot(
          snapshot,
          setHealth,
          setHealthPayload,
          setAllowWebSearchState,
        );
        if (!nextHealth.modelConfigured) {
          setShowWizard(true);
        }
        applyBootstrapSnapshot(snapshot);
        await refreshModelsCatalog(config.apiBase);
      } catch (cause) {
        setError(errorMessage(cause, "加载 LawMind 配置失败"));
      }
    })();
  }, [
    applyBootstrapSnapshot,
    config,
    refreshModelsCatalog,
    setAllowWebSearchState,
    setError,
    setHealth,
    setHealthPayload,
    setShowWizard,
  ]);

  const loadCollabSummaryForApi = useCallback(async (apiBase: string) => {
    return loadSettingsCollaborationState(apiBase);
  }, []);

  const reloadCollabSummary = useCallback(
    async (apiBase: string, opts?: { refreshConfigOnFailure?: boolean }) => {
      try {
        const nextState = await loadCollabSummaryForApi(apiBase);
        setCollabSummarySettings(nextState);
        return nextState;
      } catch {
        if (!opts?.refreshConfigOnFailure) {
          setCollabSummarySettings(null);
          return null;
        }
        const fresh = await refreshLocalAppConfig(config);
        if (!fresh || fresh.apiBase === apiBase) {
          setCollabSummarySettings(null);
          return null;
        }
        setConfig(fresh);
        try {
          const retried = await loadCollabSummaryForApi(fresh.apiBase);
          setCollabSummarySettings(retried);
          return retried;
        } catch {
          setCollabSummarySettings(null);
          return null;
        }
      }
    },
    [config, loadCollabSummaryForApi, setConfig],
  );

  const reconnectLocalService = useCallback(async () => {
    setLocalServiceReconnecting(true);
    setError(null);
    try {
      const fresh = await refreshLocalAppConfig(config);
      if (!fresh) {
        throw new Error("无法读取桌面配置，请完全退出并重新打开 LawMind。");
      }
      setConfig(fresh);
      const snapshot = await loadAppBootstrapSnapshot(fresh.apiBase);
      applyHealthFromSnapshot(snapshot, setHealth, setHealthPayload, setAllowWebSearchState);
      applyBootstrapSnapshot(snapshot);
      await refreshModelsCatalog(fresh.apiBase);
      await reloadCollabSummary(fresh.apiBase);
    } catch (cause) {
      setCollabSummarySettings(null);
      setError(errorMessage(cause, "重新连接本地服务失败"));
    } finally {
      setLocalServiceReconnecting(false);
    }
  }, [
    applyBootstrapSnapshot,
    config,
    refreshModelsCatalog,
    reloadCollabSummary,
    setAllowWebSearchState,
    setConfig,
    setError,
    setHealth,
    setHealthPayload,
  ]);

  useEffect(() => {
    if (!config?.apiBase) {
      return;
    }
    void reloadCollabSummary(config.apiBase, { refreshConfigOnFailure: true });
  }, [config?.apiBase, reloadCollabSummary]);

  useEffect(() => {
    if (!showSettings || !config?.apiBase) {
      return;
    }
    void reloadCollabSummary(config.apiBase, { refreshConfigOnFailure: true });
  }, [showSettings, config?.apiBase, reloadCollabSummary]);

  const reloadDeskSettings = useCallback(async () => {
    if (!config?.apiBase) {
      return;
    }
    try {
      const r = await fetch(`${config.apiBase}/api/workspace/desk-settings`, {
        headers: apiAuthHeaders(),
      });
      if (!r.ok) {
        return;
      }
      const j = (await r.json()) as { ok?: boolean; settings?: { contractBatchRelativeDir?: string } };
      const dir = j.settings?.contractBatchRelativeDir;
      setDeskContractBatchDir(typeof dir === "string" ? dir : "");
    } catch {
      /* ignore */
    }
  }, [config?.apiBase]);

  useEffect(() => {
    void reloadDeskSettings();
  }, [reloadDeskSettings]);

  return {
    collabSummarySettings,
    localServiceReconnecting,
    deskContractBatchDir,
    reconnectLocalService,
    reloadCollabSummary,
    reloadDeskSettings,
  };
}
