import {
  reasoningLlmConfigExplicitFromEnv,
  type OpenAiJsonClientConfig,
} from "../llm/openai-json.js";
import { isDraftWithModelPreferenceEnabled, readModelsStore } from "./custom-store.js";
import { resolveAgentModelById, resolveDefaultModelId } from "./resolve.js";

/**
 * Legacy env gate for model drafting (E6).
 * - `model` / unset：在具备 LLM 凭据时启用
 * - `keyword` / `off` / `0` / `false`：强制关闭
 */
export function isLegacyEnvDraftWithModelEnabled(): boolean {
  const mode = (process.env.LAWMIND_REASONING_MODE ?? "").trim().toLowerCase();
  if (mode === "keyword" || mode === "off" || mode === "0" || mode === "false" || mode === "no") {
    return false;
  }
  if (mode === "model" || mode === "") {
    return true;
  }
  return false;
}

/** User preference from models.json (desktop settings toggle). */
export function readDraftWithModelPreference(lawMindRoot: string): boolean {
  return isDraftWithModelPreferenceEnabled(lawMindRoot);
}

/** Whether drafting should attempt model-assisted expansion. */
export function isDraftWithModelEffective(lawMindRoot: string): boolean {
  if (readDraftWithModelPreference(lawMindRoot)) {
    return true;
  }
  if (!isLegacyEnvDraftWithModelEnabled()) {
    return false;
  }
  // Unset / model：仅当能解析到凭据时才算开启（避免空开）。
  return resolveDraftReasoningLlmConfigUnlocked(lawMindRoot) !== null;
}

/** Resolve LLM without the effective gate (used by the gate itself). */
function resolveDraftReasoningLlmConfigUnlocked(
  lawMindRoot: string,
): OpenAiJsonClientConfig | null {
  const explicit = reasoningLlmConfigExplicitFromEnv();
  if (explicit) {
    return explicit;
  }
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
    temperature: 0.2,
    timeoutMs: model.timeoutMs ?? 90_000,
  };
}

/**
 * Resolve LLM config for draft expansion.
 * Priority: explicit LAWMIND_REASONING_* env (separate drafting model) → current chat model.
 */
export function resolveDraftReasoningLlmConfig(lawMindRoot: string): OpenAiJsonClientConfig | null {
  if (readDraftWithModelPreference(lawMindRoot)) {
    return resolveDraftReasoningLlmConfigUnlocked(lawMindRoot);
  }
  if (!isLegacyEnvDraftWithModelEnabled()) {
    return null;
  }
  return resolveDraftReasoningLlmConfigUnlocked(lawMindRoot);
}

export function readDraftWithModelStoreFlag(lawMindRoot: string): boolean {
  return readModelsStore(lawMindRoot).draftWithModelEnabled === true;
}
