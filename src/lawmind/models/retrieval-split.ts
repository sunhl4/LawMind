/**
 * Split vs shared retrieval: one general chat model, or a dedicated legal-retrieval model.
 */

import { readModelsStore } from "./custom-store.js";
import { resolveAgentModelById } from "./resolve.js";

export type LegalRetrievalModelConfig = {
  catalogId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

export function retrievalModeIsDual(raw?: string): boolean {
  const mode = (raw ?? process.env.LAWMIND_RETRIEVAL_MODE ?? "single").trim().toLowerCase();
  return mode === "dual";
}

export function resolveLegalRetrievalModelFromStore(
  lawMindRoot: string,
): LegalRetrievalModelConfig | null {
  const id = readModelsStore(lawMindRoot).retrievalModelId?.trim();
  if (!id) {
    return null;
  }
  const resolved = resolveAgentModelById(lawMindRoot, id);
  const model = resolved.model;
  if (!model?.apiKey?.trim() || !model.baseUrl?.trim() || !model.model?.trim()) {
    return null;
  }
  return {
    catalogId: resolved.resolvedModelId,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    model: model.model,
    timeoutMs: model.timeoutMs ?? 120_000,
  };
}
