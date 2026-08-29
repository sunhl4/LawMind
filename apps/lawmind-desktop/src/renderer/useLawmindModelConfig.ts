import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api-client";
import {
  fetchModelsCatalog,
  setDefaultModelId,
  testModelConnection,
  type ModelCatalogEntry,
  type PlatformProviderKeyStatus,
  type ProviderKeyStatus,
} from "./lawmind-models-api";
import { resolveComposeModelSelectValue } from "./lawmind-model-picker-utils";
import { readSelectedModelId, writeSelectedModelId } from "./lawmind-selected-model-pref";

export type UseLawmindModelConfigArgs = {
  apiBase: string | undefined;
  selectedAssistantId: string;
};

export function useLawmindModelConfig(args: UseLawmindModelConfigArgs) {
  const { apiBase, selectedAssistantId } = args;
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogEntry[]>([]);
  const [modelProviders, setModelProviders] = useState<ProviderKeyStatus[]>([]);
  const [platformProviders, setPlatformProviders] = useState<PlatformProviderKeyStatus[]>([]);
  const [platformMode, setPlatformMode] = useState<"proxy" | "platform_key" | "none">("none");
  const [selectedModelId, setSelectedModelId] = useState("builtin:qwen-plus");
  const [composeModelHint, setComposeModelHint] = useState<string | null>(null);
  const [composeModelQuickTestBusy, setComposeModelQuickTestBusy] = useState(false);
  const composeModelHintTimerRef = useRef<number | null>(null);

  const refreshModelsCatalog = useCallback(async (base: string) => {
    try {
      const payload = await fetchModelsCatalog(base);
      const models = payload.models ?? [];
      setModelCatalog(models);
      setModelProviders(payload.providers ?? []);
      setPlatformProviders(payload.platformProviders ?? []);
      setPlatformMode(payload.platformMode ?? "none");
      const isUsable = (id: string) => models.some((m) => m.id === id && m.configured);
      const stored = readSelectedModelId(selectedAssistantId);
      const next =
        (payload.defaultModelId && isUsable(payload.defaultModelId)
          ? payload.defaultModelId
          : null) ??
        (stored && isUsable(stored) ? stored : null) ??
        models.find((m) => m.configured)?.id ??
        "builtin:qwen-plus";
      setSelectedModelId(next);
      writeSelectedModelId(next, selectedAssistantId);
    } catch {
      /* keep previous catalog */
    }
  }, [selectedAssistantId]);

  const handleModelSelect = useCallback(
    async (modelId: string) => {
      setComposeModelHint(null);
      if (!apiBase) {
        return;
      }
      setSelectedModelId(modelId);
      writeSelectedModelId(modelId, selectedAssistantId);
      try {
        await setDefaultModelId(apiBase, modelId);
      } catch {
        /* local selection still applies for this session */
      }
    },
    [apiBase, selectedAssistantId],
  );

  useEffect(() => {
    if (!modelCatalog.length) {
      return;
    }
    const stored = readSelectedModelId(selectedAssistantId);
    const isUsable = (id: string) => modelCatalog.some((m) => m.id === id && m.configured);
    if (stored && isUsable(stored) && stored !== selectedModelId) {
      setSelectedModelId(stored);
    }
  }, [selectedAssistantId, modelCatalog, selectedModelId]);

  useEffect(() => {
    return () => {
      if (composeModelHintTimerRef.current != null) {
        window.clearTimeout(composeModelHintTimerRef.current);
      }
    };
  }, []);

  const clearComposeModelHintSoon = useCallback((ms: number) => {
    if (composeModelHintTimerRef.current != null) {
      window.clearTimeout(composeModelHintTimerRef.current);
    }
    composeModelHintTimerRef.current = window.setTimeout(() => {
      setComposeModelHint(null);
      composeModelHintTimerRef.current = null;
    }, ms);
  }, []);

  const flashComposeModelHint = useCallback(
    (message: string, ms = 5000) => {
      setComposeModelHint(message);
      clearComposeModelHintSoon(ms);
    },
    [clearComposeModelHintSoon],
  );

  const composeModelQuickTest = useCallback(async () => {
    if (!apiBase) {
      setComposeModelHint("后端未就绪");
      clearComposeModelHintSoon(5000);
      return;
    }
    const effectiveId = resolveComposeModelSelectValue(modelCatalog, selectedModelId);
    const picked = modelCatalog.find((m) => m.id === effectiveId);
    if (picked && !picked.configured) {
      setComposeModelHint(`「${picked.label}」未配置 API Key，请打开 API 配置向导或添加自定义模型。`);
      clearComposeModelHintSoon(8000);
      return;
    }
    setComposeModelQuickTestBusy(true);
    setComposeModelHint(null);
    try {
      const body = await testModelConnection(apiBase, effectiveId);
      const label =
        typeof body.model === "string"
          ? body.model
          : typeof picked?.model === "string"
            ? picked.model
            : effectiveId;
      setComposeModelHint(
        `已连接「${label}」${typeof body.latencyMs === "number" ? ` · ${body.latencyMs} ms` : ""}`,
      );
      await refreshModelsCatalog(apiBase);
    } catch (cause) {
      setComposeModelHint(errorMessage(cause, "连接测试失败"));
    } finally {
      setComposeModelQuickTestBusy(false);
      clearComposeModelHintSoon(10000);
    }
  }, [
    apiBase,
    clearComposeModelHintSoon,
    modelCatalog,
    refreshModelsCatalog,
    selectedModelId,
  ]);

  return {
    modelCatalog,
    modelProviders,
    platformProviders,
    platformMode,
    selectedModelId,
    setSelectedModelId,
    composeModelHint,
    setComposeModelHint,
    composeModelQuickTestBusy,
    refreshModelsCatalog,
    handleModelSelect,
    flashComposeModelHint,
    clearComposeModelHintSoon,
    composeModelQuickTest,
  };
}
