/** OpenAI-compatible upstream families supported by built-in catalog entries. */
export type LawMindModelProviderId =
  | "dashscope"
  | "openai"
  | "deepseek"
  | "moonshot"
  | "zhipu"
  | "custom"
  | "platform";

export type LawMindModelKind = "builtin" | "custom" | "platform";

/** Stable id: `builtin:qwen-plus` or `custom:<uuid>`. */
export type LawMindModelId = string;

export type BuiltinModelDefinition = {
  id: LawMindModelId;
  kind: "builtin";
  label: string;
  description?: string;
  provider: Exclude<LawMindModelProviderId, "custom">;
  baseUrl: string;
  /** Upstream model id sent to chat/completions. */
  model: string;
  /** Optional grouping in UI (e.g. 通义千问, OpenAI). */
  group: string;
  /** Optional context window in tokens (UI tag). */
  contextTokens?: number;
  /** Optional UI tags (e.g. "推理", "OCR"). */
  tags?: string[];
};

export type CustomModelRecord = {
  id: LawMindModelId;
  kind: "custom";
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Persisted verification result from a successful `POST /api/models/test`.
 *
 * Keyed by model id (e.g. `builtin:qwen-plus`, `custom:<uuid>`, `platform:qwen-plus`).
 */
export type ModelVerificationRecord = {
  verifiedAt: string;
  latencyMs: number;
  model: string;
  baseUrl: string;
};

export type ModelsStoreFile = {
  schemaVersion: 1 | 2;
  /** Last selected model in desktop UI; falls back to env when unset. */
  defaultModelId?: string;
  /** When true, workflow drafting uses the configured chat model (same API key). */
  draftWithModelEnabled?: boolean;
  customModels: CustomModelRecord[];
  /** v2: keyed by model id (built-in/custom/platform). Optional for back-compat. */
  verifications?: Record<string, ModelVerificationRecord>;
};

/** API list row (no secrets). */
export type ModelCatalogEntry = {
  id: LawMindModelId;
  kind: LawMindModelKind;
  label: string;
  description?: string;
  group: string;
  provider: LawMindModelProviderId;
  model: string;
  baseUrl: string;
  /** True when this row can be invoked (provider key or custom key present). */
  configured: boolean;
  /** Shown in UI when built-in row needs a provider key. */
  providerKeyHint?: string;
  /** Optional context window in tokens. */
  contextTokens?: number;
  /** Optional UI tags. */
  tags?: string[];
  /** ISO timestamp of last successful POST /api/models/test against this id. */
  verifiedAt?: string;
  /** Round-trip latency of the last successful verification. */
  verifiedLatencyMs?: number;
};

export type ProviderKeyStatus = {
  provider: LawMindModelProviderId;
  label: string;
  configured: boolean;
  envKeys: string[];
};
