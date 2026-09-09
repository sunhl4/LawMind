import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useSettingsPanelStore } from "./stores/settings-panel-store";
import type { AppConfig } from "./lawmind-app-bootstrap";
import { loadAppBootstrapSnapshot, refreshLocalAppConfig } from "./lawmind-app-bootstrap";
import { setLoopbackApiAuthToken } from "./lawmind-api-auth";
import { setDraftWithModelEnabled } from "./lawmind-models-api";
import { errorMessage } from "./api-client";
import { clearProjectDirectory } from "./lawmind-settings-project";
import { mapHealthState, type LawmindHealthState } from "./useLawmindAppBootstrapEffects";
import type { HealthPayload } from "./lawmind-app-data.js";

/** After backend restart, adopt the new loopback port/token before further API calls. */
async function adoptConfigAfterBackendRestart(
  previous: AppConfig | null,
  response: { apiBase?: string; apiAuthToken?: string; retrievalMode?: "single" | "dual" },
  setConfig: (value: AppConfig | null) => void,
): Promise<AppConfig | null> {
  if (typeof response.apiAuthToken === "string" && response.apiAuthToken.trim()) {
    setLoopbackApiAuthToken(response.apiAuthToken);
  }
  const fresh = await refreshLocalAppConfig(previous);
  if (fresh) {
    const nextMode =
      response.retrievalMode === "dual" || response.retrievalMode === "single"
        ? response.retrievalMode
        : fresh.retrievalMode;
    const merged: AppConfig = {
      ...fresh,
      apiBase: response.apiBase?.trim() || fresh.apiBase,
      apiAuthToken: response.apiAuthToken?.trim() || fresh.apiAuthToken,
      retrievalMode: nextMode,
    };
    if (merged.apiAuthToken) {
      setLoopbackApiAuthToken(merged.apiAuthToken);
    }
    setConfig(merged);
    return merged;
  }
  if (previous && response.apiBase?.trim()) {
    const merged: AppConfig = {
      ...previous,
      apiBase: response.apiBase.trim(),
      apiAuthToken: response.apiAuthToken?.trim() || previous.apiAuthToken,
      retrievalMode:
        response.retrievalMode === "dual" || response.retrievalMode === "single"
          ? response.retrievalMode
          : previous.retrievalMode,
    };
    if (merged.apiAuthToken) {
      setLoopbackApiAuthToken(merged.apiAuthToken);
    }
    setConfig(merged);
    return merged;
  }
  return previous;
}

export type UseLawmindAppSetupActionsParams = {
  config: AppConfig | null;
  setConfig: (value: AppConfig | null) => void;
  setHealth: Dispatch<SetStateAction<LawmindHealthState>>;
  setHealthPayload: (value: HealthPayload | null) => void;
  setError: (message: string | null) => void;
  applyBootstrapSnapshot: (snapshot: Awaited<ReturnType<typeof loadAppBootstrapSnapshot>>) => void;
  reloadCollabSummary: (apiBase: string, opts?: { refreshConfigOnFailure?: boolean }) => Promise<unknown>;
  showWizard: boolean;
  setShowWizard: (open: boolean) => void;
  wizApiKey: string;
  wizBaseUrl: string;
  wizModel: string;
  wizWorkspace: string;
  wizRetrievalMode: "single" | "dual";
  setWizApiKey: (value: string) => void;
  setWizHasExistingKey: (value: boolean) => void;
  setWizBaseUrl: (value: string) => void;
  setWizModel: (value: string) => void;
  setWizWorkspace: (value: string) => void;
  setWizRetrievalMode: (mode: "single" | "dual") => void;
  setWizBusy: (busy: boolean) => void;
  setWizError: (error: string | null) => void;
  setComposeModelHint: (hint: string | null) => void;
  clearComposeModelHintSoon: (ms: number) => void;
  refreshModelsCatalog: (apiBase: string) => Promise<void>;
};

export function useLawmindAppSetupActions(params: UseLawmindAppSetupActionsParams) {
  const {
    config,
    setConfig,
    setHealth,
    setHealthPayload,
    setError,
    applyBootstrapSnapshot,
    reloadCollabSummary,
    setShowWizard,
    wizApiKey,
    wizBaseUrl,
    wizModel,
    wizWorkspace,
    wizRetrievalMode,
    setWizApiKey,
    setWizHasExistingKey,
    setWizBaseUrl,
    setWizModel,
    setWizWorkspace,
    setWizRetrievalMode,
    setWizBusy,
    setWizError,
    setComposeModelHint,
    clearComposeModelHintSoon,
    refreshModelsCatalog,
  } = params;

  const [retrievalSaving, setRetrievalSaving] = useState(false);
  const [draftWithModelSaving, setDraftWithModelSaving] = useState(false);

  const applyRetrievalMode = useCallback(
    async (mode: "single" | "dual") => {
      const bridge = window.lawmindDesktop;
      if (!bridge?.setRetrievalMode || !config) {
        return;
      }
      setRetrievalSaving(true);
      setError(null);
      try {
        const response = await bridge.setRetrievalMode(mode);
        const adopted = await adoptConfigAfterBackendRestart(config, response, setConfig);
        if (!response.ok) {
          throw new Error(response.error || "切换失败");
        }
        const nextBase = adopted?.apiBase ?? response.apiBase ?? config.apiBase;
        const snapshot = await loadAppBootstrapSnapshot(nextBase);
        setHealth(mapHealthState(snapshot.health));
        setHealthPayload(snapshot.health);
        applyBootstrapSnapshot(snapshot);
      } catch (cause) {
        setError(errorMessage(cause, "切换检索模式失败"));
      } finally {
        setRetrievalSaving(false);
      }
    },
    [applyBootstrapSnapshot, config, setConfig, setError, setHealth, setHealthPayload],
  );

  const applyDraftWithModelEnabled = useCallback(
    async (enabled: boolean) => {
      if (!config?.apiBase) {
        return;
      }
      setDraftWithModelSaving(true);
      setError(null);
      try {
        const result = await setDraftWithModelEnabled(config.apiBase, enabled);
        setHealth((prev) =>
          prev
            ? {
                ...prev,
                draftWithModelEnabled: result.draftWithModelEnabled,
                draftWithModelActive: result.draftWithModelActive,
              }
            : prev,
        );
        const snapshot = await loadAppBootstrapSnapshot(config.apiBase);
        setHealth(mapHealthState(snapshot.health));
        setHealthPayload(snapshot.health);
      } catch (cause) {
        setError(errorMessage(cause, "更新起草模型设置失败"));
      } finally {
        setDraftWithModelSaving(false);
      }
    },
    [config?.apiBase, setError, setHealth, setHealthPayload],
  );

  const runWizardSave = useCallback(async () => {
    const bridge = window.lawmindDesktop;
    if (!bridge?.saveSetup) {
      return;
    }
    setWizBusy(true);
    setWizError(null);
    try {
      const response = await bridge.saveSetup({
        apiKey: wizApiKey.trim(),
        baseUrl: wizBaseUrl.trim() || undefined,
        model: wizModel.trim() || undefined,
        workspaceDir: wizWorkspace.trim() || undefined,
        retrievalMode: wizRetrievalMode,
      });
      // saveSetup restarts the local server (new port + bearer). Refresh before any follow-up fetch.
      const adopted = await adoptConfigAfterBackendRestart(
        config,
        {
          apiBase: response.apiBase,
          apiAuthToken: response.apiAuthToken,
          retrievalMode: response.retrievalMode,
        },
        setConfig,
      );
      if (!response.ok) {
        throw new Error(response.error || "保存或验证失败");
      }
      if (response.verified === false) {
        throw new Error(response.error || "模型连接验证未通过");
      }
      if (response.workspaceDir && response.envFilePath) {
        const nextMode =
          response.retrievalMode === "dual" || wizRetrievalMode === "dual" ? "dual" : "single";
        setConfig({
          ...(adopted ?? config),
          apiBase: adopted?.apiBase ?? response.apiBase ?? config?.apiBase ?? "",
          apiAuthToken: adopted?.apiAuthToken ?? response.apiAuthToken ?? config?.apiAuthToken,
          workspaceDir: response.workspaceDir,
          projectDir: adopted?.projectDir ?? config?.projectDir ?? null,
          envFilePath: response.envFilePath,
          retrievalMode: nextMode,
        });
        setWizRetrievalMode(nextMode);
      }
      setShowWizard(false);
      setWizApiKey("");
      setWizHasExistingKey(true);
      // After model setup: request first-run once (if not dismissed). Dialog opens when suppress lifts.
      try {
        if (typeof window !== "undefined" && !window.localStorage.getItem("lm.firstRun.dismissed")) {
          window.sessionStorage.setItem("lm.firstRun.requestOpen", "1");
        }
      } catch {
        /* ignore */
      }
      const verifyNote =
        typeof response.latencyMs === "number"
          ? `模型已验证可用（${response.latencyMs} ms），配置已保存到本机。`
          : "模型已验证可用，配置已保存到本机。";
      setComposeModelHint(verifyNote);
      clearComposeModelHintSoon(12_000);
      const apiBaseNext = adopted?.apiBase ?? response.apiBase ?? config?.apiBase;
      if (!apiBaseNext) {
        throw new Error("missing api base after save");
      }
      const snapshot = await loadAppBootstrapSnapshot(apiBaseNext);
      setHealth(mapHealthState(snapshot.health));
      setHealthPayload(snapshot.health);
      applyBootstrapSnapshot(snapshot);
      await refreshModelsCatalog(apiBaseNext);
    } catch (cause) {
      setWizError(errorMessage(cause, "保存配置失败"));
    } finally {
      setWizBusy(false);
    }
  }, [
    applyBootstrapSnapshot,
    clearComposeModelHintSoon,
    config,
    refreshModelsCatalog,
    setComposeModelHint,
    setConfig,
    setHealth,
    setHealthPayload,
    setShowWizard,
    setWizApiKey,
    setWizBusy,
    setWizError,
    setWizHasExistingKey,
    setWizRetrievalMode,
    wizApiKey,
    wizBaseUrl,
    wizModel,
    wizRetrievalMode,
    wizWorkspace,
  ]);

  const pickWs = useCallback(async () => {
    const bridge = window.lawmindDesktop;
    if (!bridge?.pickWorkspace) {
      return;
    }
    const response = await bridge.pickWorkspace();
    if (response.ok && response.path) {
      setWizWorkspace(response.path);
    }
  }, [setWizWorkspace]);

  const openApiWizard = useCallback(() => {
    if (!config) {
      return;
    }
    setWizRetrievalMode(config.retrievalMode);
    setWizError(null);
    setShowWizard(true);
    useSettingsPanelStore.getState().setSettingsPanel(false);
    void (async () => {
      const bridge = window.lawmindDesktop;
      if (!bridge?.readModelSettings) {
        return;
      }
      try {
        const meta = await bridge.readModelSettings();
        if (!meta.ok) {
          return;
        }
        setWizHasExistingKey(Boolean(meta.hasApiKey));
        if (typeof meta.baseUrl === "string" && meta.baseUrl.trim()) {
          setWizBaseUrl(meta.baseUrl.trim());
        }
        if (typeof meta.model === "string" && meta.model.trim()) {
          setWizModel(meta.model.trim());
        }
      } catch {
        /* ignore — wizard still usable with defaults */
      }
    })();
  }, [config, setShowWizard, setWizBaseUrl, setWizError, setWizHasExistingKey, setWizModel, setWizRetrievalMode]);

  const pickProject = useCallback(async () => {
    const bridge = window.lawmindDesktop;
    if (!bridge?.pickProject || !bridge.setProjectDir || !config) {
      return;
    }
    const response = await bridge.pickProject();
    if (response.ok && response.path) {
      const setResult = await bridge.setProjectDir(response.path);
      if (!setResult.ok) {
        setError(setResult.error || "设置项目目录失败");
        return;
      }
      const nextApiBase =
        typeof setResult.apiBase === "string" && setResult.apiBase.trim()
          ? setResult.apiBase.trim()
          : config.apiBase;
      setConfig({
        ...config,
        apiBase: nextApiBase,
        projectDir: setResult.projectDir ?? null,
      });
      if (nextApiBase !== config.apiBase) {
        void reloadCollabSummary(nextApiBase, { refreshConfigOnFailure: true });
      }
    }
  }, [config, reloadCollabSummary, setConfig, setError]);

  const clearProject = useCallback(async () => {
    const result = await clearProjectDirectory({
      config,
      setProjectDir: window.lawmindDesktop?.setProjectDir,
    });
    if (result.error) {
      setError(result.error);
      return;
    }
    if (config && result.projectDir !== undefined) {
      const nextApiBase =
        typeof result.apiBase === "string" && result.apiBase.trim()
          ? result.apiBase.trim()
          : config.apiBase;
      setConfig({ ...config, apiBase: nextApiBase, projectDir: result.projectDir });
      if (nextApiBase !== config.apiBase) {
        void reloadCollabSummary(nextApiBase, { refreshConfigOnFailure: true });
      }
    }
  }, [config, reloadCollabSummary, setConfig, setError]);

  return {
    retrievalSaving,
    draftWithModelSaving,
    applyRetrievalMode,
    applyDraftWithModelEnabled,
    runWizardSave,
    pickWs,
    openApiWizard,
    pickProject,
    clearProject,
  };
}
