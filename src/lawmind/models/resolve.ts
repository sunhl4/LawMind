import type { AgentModelConfig, AgentRuntimeModelIdentity } from "../agent/types.js";
import {
  builtinIdForEnvModelName,
  getBuiltinModelById,
  LAWMIND_BUILTIN_MODELS,
} from "./catalog.js";
import { getCustomModelById, readModelsStore } from "./custom-store.js";
import { getPlatformModelById, LAWMIND_PLATFORM_MODELS } from "./platform-catalog.js";
import {
  isPlatformInferenceAvailable,
  listPlatformProviderKeyStatus,
  resolvePlatformProviderApiKeyFromEnv,
  resolvePlatformProxyFromEnv,
} from "./platform-providers.js";
import {
  getProviderDefinition,
  listProviderKeyStatus,
  resolveProviderApiKeyFromEnv,
} from "./providers.js";
import type { ModelCatalogEntry, LawMindModelId } from "./types.js";

/** Wizard / `.env.lawmind` LAWMIND_AGENT_* profile (exact upstream model + URL). */
export const ENV_CURRENT_MODEL_ID = "env:current";

function readAgentEnvProfile(): { apiKey: string; baseUrl: string; model: string } | null {
  const apiKey =
    process.env.LAWMIND_AGENT_API_KEY?.trim() || resolveProviderApiKeyFromEnv("dashscope") || "";
  if (!apiKey) {
    return null;
  }
  const model =
    process.env.LAWMIND_AGENT_MODEL?.trim() || process.env.LAWMIND_QWEN_MODEL?.trim() || "";
  if (!model) {
    return null;
  }
  const dashscope = getProviderDefinition("dashscope");
  const baseUrl = (
    process.env.LAWMIND_AGENT_BASE_URL?.trim() ||
    process.env.LAWMIND_QWEN_BASE_URL?.trim() ||
    dashscope.defaultBaseUrl
  ).replace(/\/$/, "");
  return { apiKey, baseUrl, model };
}

function shouldIncludeEnvCurrentCatalogEntry(): boolean {
  const profile = readAgentEnvProfile();
  if (!profile) {
    return false;
  }
  const builtinMatch = LAWMIND_BUILTIN_MODELS.find((m) => m.model === profile.model);
  if (!builtinMatch) {
    return true;
  }
  if (!resolveProviderApiKeyFromEnv(builtinMatch.provider)) {
    return true;
  }
  return builtinMatch.baseUrl.replace(/\/$/, "") !== profile.baseUrl;
}

export function resolveEnvCurrentToAgentModel(): {
  model?: AgentModelConfig;
  error?: string;
} {
  const profile = readAgentEnvProfile();
  if (!profile) {
    return { error: "missing_agent_env" };
  }
  return {
    model: {
      provider: "openai-compatible",
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      ...baseAgentModelDefaults(),
    },
  };
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function baseAgentModelDefaults(): Pick<
  AgentModelConfig,
  "maxTokens" | "temperature" | "timeoutMs"
> {
  const modelTimeoutMs = parsePositiveIntEnv("LAWMIND_AGENT_TIMEOUT_MS", 120000);
  return {
    maxTokens: 4096,
    temperature: 0.3,
    timeoutMs: modelTimeoutMs,
  };
}

export function resolvePlatformToAgentModel(platformId: string): {
  model?: AgentModelConfig;
  error?: string;
} {
  const def = getPlatformModelById(platformId);
  if (!def) {
    return { error: "unknown_model" };
  }
  const proxy = resolvePlatformProxyFromEnv();
  if (proxy) {
    const baseUrl = proxy.baseUrl.endsWith("/v1") ? proxy.baseUrl : `${proxy.baseUrl}/v1`;
    return {
      model: {
        provider: "openai-compatible",
        baseUrl,
        apiKey: proxy.accessToken,
        model: def.model,
        ...baseAgentModelDefaults(),
      },
    };
  }
  if (def.provider === "platform") {
    return { error: "invalid_platform_provider" };
  }
  const apiKey = resolvePlatformProviderApiKeyFromEnv(def.provider);
  if (!apiKey) {
    return {
      error: "missing_platform_api_key",
      model: {
        provider: "openai-compatible",
        baseUrl: def.baseUrl,
        apiKey: "",
        model: def.model,
        ...baseAgentModelDefaults(),
      },
    };
  }
  return {
    model: {
      provider: "openai-compatible",
      baseUrl: def.baseUrl,
      apiKey,
      model: def.model,
      ...baseAgentModelDefaults(),
    },
  };
}

export function resolveBuiltinToAgentModel(builtinId: string): {
  model?: AgentModelConfig;
  error?: string;
} {
  const def = getBuiltinModelById(builtinId);
  if (!def) {
    return { error: "unknown_model" };
  }
  const apiKey = resolveProviderApiKeyFromEnv(def.provider);
  if (!apiKey) {
    const _prov = getProviderDefinition(def.provider);
    return {
      error: "missing_provider_api_key",
      model: {
        provider: "openai-compatible",
        baseUrl: def.baseUrl,
        apiKey: "",
        model: def.model,
        ...baseAgentModelDefaults(),
      },
    };
  }
  return {
    model: {
      provider: "openai-compatible",
      baseUrl: def.baseUrl,
      apiKey,
      model: def.model,
      ...baseAgentModelDefaults(),
    },
  };
}

/**
 * `process.env` name where the Electron main process injects a custom model's
 * keychain-stored API Key (see `apps/lawmind-desktop/electron/main.mjs`).
 */
function customModelEnvKeyName(customId: string): string {
  const uuid = customId.replace(/^custom:/, "");
  return `LAWMIND_CUSTOM_${uuid.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
}

export function resolveCustomToAgentModel(
  lawMindRoot: string,
  customId: string,
): { model?: AgentModelConfig; error?: string } {
  const row = getCustomModelById(lawMindRoot, customId);
  if (!row) {
    return { error: "unknown_model" };
  }
  const stored = row.apiKey.trim();
  const fromEnv = (process.env[customModelEnvKeyName(customId)] ?? "").trim();
  const apiKey = stored || fromEnv;
  if (!apiKey) {
    return { error: "missing_api_key" };
  }
  return {
    model: {
      provider: "openai-compatible",
      baseUrl: row.baseUrl,
      apiKey,
      model: row.model,
      ...baseAgentModelDefaults(),
    },
  };
}

export function resolveDefaultModelId(lawMindRoot: string): string {
  const store = readModelsStore(lawMindRoot);
  if (store.defaultModelId) {
    return store.defaultModelId;
  }
  const envModel =
    process.env.LAWMIND_AGENT_MODEL?.trim() || process.env.LAWMIND_QWEN_MODEL?.trim() || "";
  const fromEnv = builtinIdForEnvModelName(envModel);
  if (fromEnv && getBuiltinModelById(fromEnv)) {
    const def = getBuiltinModelById(fromEnv)!;
    if (resolveProviderApiKeyFromEnv(def.provider)) {
      return fromEnv;
    }
  }
  if (shouldIncludeEnvCurrentCatalogEntry()) {
    return ENV_CURRENT_MODEL_ID;
  }
  if (isPlatformInferenceAvailable()) {
    return "platform:qwen-plus";
  }
  const firstConfigured = LAWMIND_BUILTIN_MODELS.find((m) =>
    Boolean(resolveProviderApiKeyFromEnv(m.provider)),
  );
  if (firstConfigured) {
    return firstConfigured.id;
  }
  const firstCustom = store.customModels.find((m) => m.apiKey.trim());
  if (firstCustom) {
    return firstCustom.id;
  }
  return "builtin:qwen-plus";
}

function providerLabelForCatalog(provider: ModelCatalogEntry["provider"]): string {
  if (provider === "custom") {
    return "自定义 API 端点";
  }
  if (provider === "platform") {
    return "LawMind 平台推理";
  }
  return getProviderDefinition(provider).label;
}

/** Safe model facts for agent system prompt (never includes apiKey / baseUrl). */
export function resolveModelIdentityForPrompt(
  lawMindRoot: string,
  modelId: string,
  agentModel: AgentModelConfig,
): AgentRuntimeModelIdentity {
  const id = modelId.trim();
  if (id === ENV_CURRENT_MODEL_ID) {
    const upstream = agentModel.model.trim();
    return {
      catalogLabel: upstream ? `主模型 · ${upstream}` : "主模型 · 已连接",
      providerLabel: "OpenAI 兼容 API",
      upstreamModel: upstream || agentModel.model,
      catalogId: id,
    };
  }
  const catalog = buildModelCatalog(lawMindRoot);
  const row = catalog.models.find((m) => m.id === id);
  if (row) {
    return {
      catalogLabel: row.label,
      providerLabel: providerLabelForCatalog(row.provider),
      upstreamModel: agentModel.model,
      catalogId: id,
    };
  }
  return {
    catalogLabel: agentModel.model,
    providerLabel: "OpenAI 兼容 API",
    upstreamModel: agentModel.model,
    catalogId: id || undefined,
  };
}

export function resolveAgentModelById(
  lawMindRoot: string,
  modelId?: string,
): { model?: AgentModelConfig; error?: string; resolvedModelId: LawMindModelId } {
  const id = (modelId?.trim() || resolveDefaultModelId(lawMindRoot)).trim();
  if (id === ENV_CURRENT_MODEL_ID) {
    const r = resolveEnvCurrentToAgentModel();
    return { ...r, resolvedModelId: id };
  }
  if (id.startsWith("platform:")) {
    const r = resolvePlatformToAgentModel(id);
    return { ...r, resolvedModelId: id };
  }
  if (id.startsWith("custom:")) {
    const r = resolveCustomToAgentModel(lawMindRoot, id);
    return { ...r, resolvedModelId: id };
  }
  const r = resolveBuiltinToAgentModel(id);
  return { ...r, resolvedModelId: id };
}

export function isAnyModelConfigured(lawMindRoot: string): boolean {
  if (isPlatformInferenceAvailable()) {
    return true;
  }
  if (listProviderKeyStatus().some((p) => p.configured)) {
    return true;
  }
  const store = readModelsStore(lawMindRoot);
  return store.customModels.some((m) => m.apiKey.trim().length > 0);
}

export function buildModelCatalog(lawMindRoot: string): {
  models: ModelCatalogEntry[];
  defaultModelId: string;
  draftWithModelEnabled: boolean;
  providers: ReturnType<typeof listProviderKeyStatus>;
  platformProviders: ReturnType<typeof listPlatformProviderKeyStatus>;
  platformMode: "proxy" | "platform_key" | "none";
} {
  const store = readModelsStore(lawMindRoot);
  const defaultModelId = resolveDefaultModelId(lawMindRoot);
  const providers = listProviderKeyStatus();
  const verifications = store.verifications ?? {};
  const attachVerification = (row: ModelCatalogEntry): ModelCatalogEntry => {
    const v = verifications[row.id];
    if (!v) {
      return row;
    }
    return { ...row, verifiedAt: v.verifiedAt, verifiedLatencyMs: v.latencyMs };
  };

  const builtins: ModelCatalogEntry[] = LAWMIND_BUILTIN_MODELS.map((m) => {
    const configured = Boolean(resolveProviderApiKeyFromEnv(m.provider));
    const _prov = getProviderDefinition(m.provider);
    return attachVerification({
      id: m.id,
      kind: "builtin",
      label: m.label,
      description: m.description,
      group: m.group,
      provider: m.provider,
      model: m.model,
      baseUrl: m.baseUrl,
      configured,
      providerKeyHint: configured ? undefined : _prov.apiKeyEnvKeys[0],
      contextTokens: m.contextTokens,
      tags: m.tags,
    });
  });

  const customs: ModelCatalogEntry[] = store.customModels.map((m) => {
    const hasInline = Boolean(m.apiKey.trim());
    const hasEnv = Boolean((process.env[customModelEnvKeyName(m.id)] ?? "").trim());
    return attachVerification({
      id: m.id,
      kind: "custom",
      label: m.label,
      group: "自定义模型",
      provider: "custom",
      model: m.model,
      baseUrl: m.baseUrl,
      configured: hasInline || hasEnv,
    });
  });

  const platformAvailable = isPlatformInferenceAvailable();
  const platforms: ModelCatalogEntry[] = LAWMIND_PLATFORM_MODELS.map((m) =>
    attachVerification({
      id: m.id,
      kind: "platform",
      label: m.label,
      description: m.description,
      group: m.group,
      provider: "platform",
      model: m.model,
      baseUrl: resolvePlatformProxyFromEnv()?.baseUrl ?? m.baseUrl,
      configured: platformAvailable,
      contextTokens: m.contextTokens,
      tags: m.tags,
    }),
  );

  const envRows: ModelCatalogEntry[] = [];
  if (shouldIncludeEnvCurrentCatalogEntry()) {
    const profile = readAgentEnvProfile()!;
    envRows.push(
      attachVerification({
        id: ENV_CURRENT_MODEL_ID,
        kind: "builtin",
        label: `主模型（${profile.model}）`,
        description: "使用设置向导写入的模型名、Base URL 与 Key",
        group: "当前配置",
        provider: "dashscope",
        model: profile.model,
        baseUrl: profile.baseUrl,
        configured: true,
      }),
    );
  }

  return {
    models: [...platforms, ...envRows, ...builtins, ...customs],
    defaultModelId,
    draftWithModelEnabled: store.draftWithModelEnabled === true,
    providers,
    platformProviders: listPlatformProviderKeyStatus(),
    platformMode: resolvePlatformProxyFromEnv()
      ? "proxy"
      : platformAvailable
        ? "platform_key"
        : "none",
  };
}
