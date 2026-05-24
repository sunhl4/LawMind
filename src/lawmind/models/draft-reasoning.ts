import {
  reasoningLlmConfigExplicitFromEnv,
  type OpenAiJsonClientConfig,
} from "../llm/openai-json.js";
import { isDraftWithModelPreferenceEnabled, readModelsStore } from "./custom-store.js";
import { resolveAgentModelById, resolveDefaultModelId } from "./resolve.js";

/** Legacy env gate: LAWMIND_REASONING_MODE=model with LLM credentials. */
export function isLegacyEnvDraftWithModelEnabled(): boolean {
  const mode = (process.env.LAWMIND_REASONING_MODE ?? "").trim().toLowerCase();
  return mode === "model";
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
  return isLegacyEnvDraftWithModelEnabled();
}

/**
 * Resolve LLM config for draft expansion.
 * Priority: explicit LAWMIND_REASONING_* env (separate drafting model) → current chat model.
 */
export function resolveDraftReasoningLlmConfig(lawMindRoot: string): OpenAiJsonClientConfig | null {
  if (!isDraftWithModelEffective(lawMindRoot)) {
    return null;
  }

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

export function readDraftWithModelStoreFlag(lawMindRoot: string): boolean {
  return readModelsStore(lawMindRoot).draftWithModelEnabled === true;
}
