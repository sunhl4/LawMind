import { routerLlmConfigFromEnv, type OpenAiJsonClientConfig } from "../llm/openai-json.js";
import { resolveAgentModelById, resolveDefaultModelId } from "./resolve.js";

export type RouterModeLabel = "model" | "keyword";

/**
 * Env gate for model instruction routing.
 * - `model` / unset：具备 LLM 凭据时启用（关键词仅作失败回退）
 * - `keyword` / `off` / `0` / `false` / `no`：强制关键词
 */
export function isLegacyEnvRouterWithModelEnabled(): boolean {
  const mode = (process.env.LAWMIND_ROUTER_MODE ?? "").trim().toLowerCase();
  if (mode === "keyword" || mode === "off" || mode === "0" || mode === "false" || mode === "no") {
    return false;
  }
  if (mode === "model" || mode === "") {
    return true;
  }
  return false;
}

function resolveRouterLlmConfigFromStore(lawMindRoot: string): OpenAiJsonClientConfig | null {
  const modelId = resolveDefaultModelId(lawMindRoot);
  const resolved = resolveAgentModelById(lawMindRoot, modelId);
  if (!resolved.model?.apiKey?.trim()) {
    return null;
  }
  const model = resolved.model;
  return {
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    model: model.model,
    temperature: process.env.LAWMIND_ROUTER_TEMPERATURE
      ? Number(process.env.LAWMIND_ROUTER_TEMPERATURE)
      : 0.1,
    timeoutMs: process.env.LAWMIND_ROUTER_TIMEOUT_MS
      ? Number(process.env.LAWMIND_ROUTER_TIMEOUT_MS)
      : 45_000,
  };
}

/** Resolve LLM for instruction routing: explicit env → desktop models.json. */
export function resolveRouterLlmConfig(lawMindRoot?: string): OpenAiJsonClientConfig | null {
  if (!isLegacyEnvRouterWithModelEnabled()) {
    return null;
  }
  const explicit = routerLlmConfigFromEnv();
  if (explicit) {
    return explicit;
  }
  if (!lawMindRoot?.trim()) {
    return null;
  }
  return resolveRouterLlmConfigFromStore(lawMindRoot);
}

/** True when routeAsync should attempt the model classifier. */
export function isModelRouterEnabled(lawMindRoot?: string): boolean {
  return resolveRouterLlmConfig(lawMindRoot) !== null;
}

export function effectiveRouterMode(lawMindRoot?: string): RouterModeLabel {
  return isModelRouterEnabled(lawMindRoot) ? "model" : "keyword";
}
