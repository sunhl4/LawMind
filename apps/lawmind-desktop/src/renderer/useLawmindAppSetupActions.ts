import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { AppConfig } from "./lawmind-app-bootstrap";
import { loadAppBootstrapSnapshot, refreshLocalAppConfig } from "./lawmind-app-bootstrap";
import { setLoopbackApiAuthToken } from "./lawmind-api-auth";
import { setDraftWithModelEnabled } from "./lawmind-models-api";
import { errorMessage, apiSendJson } from "./api-client";
import { applyPostFirstrunPermissionDefaults } from "./lawmind-compose-prefs";
import { clearProjectDirectory } from "./lawmind-settings-project";
import { mapHealthState, type LawmindHealthState } from "./useLawmindAppBootstrapEffects";
import type { HealthPayload } from "./lawmind-app-data.js";

/** 演示案件 ID 与首跑种子提示（与首跑向导「跳过向导，直接开始」同一口径）。 */
export const FIRST_RUN_DEMO_MATTER_ID = "演示案件";
export const FIRST_RUN_SEED_PROMPT = "把材料拖进来，或直接说要办的事。不必先选文书类型。";

/**
 * 钥匙验证通过后零选择落到可干活对话：建演示案件 + 写首跑审计 + 可执行默认 + 种子提示。
 * 失败只抛给调用方吞掉——模型已配好，律师仍能直接在对话里开工。
 */
export async function startWorkingConversation(
  apiBase: string | undefined,
  extra?: { onSeedReady?: (params: { matterId: string; seedPrompt: string }) => void },
): Promise<void> {
  if (!apiBase?.trim()) {
    return;
  }
  const created = await apiSendJson<{ ok?: boolean; error?: string }, { matterId: string }>(
    apiBase,
    "/api/matters/create",
    "POST",
    { matterId: FIRST_RUN_DEMO_MATTER_ID },
  );
  if (!created.ok) {
    throw new Error(created.error ?? "无法创建演示案件");
  }
  try {
    await apiSendJson<{ ok?: boolean; error?: string }, { matterId: string }>(
      apiBase,
      "/api/onboarding/firstrun-wizard",
      "POST",
      { matterId: FIRST_RUN_DEMO_MATTER_ID },
    );
  } catch {
    /* 首跑审计失败不阻断进入对话 */
  }
  applyPostFirstrunPermissionDefaults({ executable: true });
  extra?.onSeedReady?.({
    matterId: FIRST_RUN_DEMO_MATTER_ID,
    seedPrompt: FIRST_RUN_SEED_PROMPT,
  });
  try {
    window.localStorage.setItem("lm.firstRun.dismissed", "1");
  } catch {
    /* ignore */
  }
}

/** After backend restart, adopt the new loopback port/token before further API calls. */
async function adoptConfigAfterBackendRestart(  previous: AppConfig | null,
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

export type RunWizardSaveExtra = {
  webSearchApiKey?: string;
  /**
   * 钥匙验证通过后直接落到「可干活对话」的回调：建好演示案件 + 种子提示，
   * 不再经由首跑向导弹窗（零选择冷启动）。
   */
  onSeedReady?: (params: { matterId: string; seedPrompt: string }) => void;
};

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
  const [npcSaving, setNpcSaving] = useState(false);

  const applyOpenLawNpc = useCallback(
    async (enabled: boolean) => {
      const bridge = window.lawmindDesktop;
      if (!bridge?.setOpenLawNpc || !config) {
        return;
      }
      setNpcSaving(true);
      setError(null);
      try {
        const response = await bridge.setOpenLawNpc({ enabled });
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
        setError(errorMessage(cause, "切换国家法律法规数据库开关失败"));
      } finally {
        setNpcSaving(false);
      }
    },
    [applyBootstrapSnapshot, config, setConfig, setError, setHealth, setHealthPayload],
  );

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

  const runWizardSave = useCallback(async (extra?: RunWizardSaveExtra) => {
    const bridge = window.lawmindDesktop;
    if (!bridge?.saveSetup) {
      return;
    }
    setWizBusy(true);
    setWizError(null);
    try {
      const response = await bridge.saveSetup({
        apiKey: wizApiKey.trim(),
        webSearchApiKey: extra?.webSearchApiKey,
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
      // 钥匙一验证通过就落到可干活对话：建演示案件 + 种子提示 + 可执行默认。
      // 不再弹首跑向导（零选择冷启动）；律师之后仍可从设置重新打开向导。
      try {
        if (typeof window !== "undefined" && !window.localStorage.getItem("lm.firstRun.dismissed")) {
          await startWorkingConversation(adopted?.apiBase ?? response.apiBase ?? config?.apiBase, extra);
        }
      } catch {
        /* 冷启动落点失败不阻断：模型已配好，律师可直接在对话里开工 */
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
    // Wizard is portaled onto document.body. Do not close settings — otherwise
    // Cancel / a missed overlay dumps the lawyer onto 对话 with no verify CTA.
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
    npcSaving,
    applyOpenLawNpc,
    runWizardSave,
    pickWs,
    openApiWizard,
    pickProject,
    clearProject,
  };
}
