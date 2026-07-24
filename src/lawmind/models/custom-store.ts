import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CustomModelRecord, ModelsStoreFile, ModelVerificationRecord } from "./types.js";

const STORE_FILE = "models.json";
const CURRENT_SCHEMA_VERSION = 2;

function modelsStorePath(lawMindRoot: string): string {
  return path.join(lawMindRoot, STORE_FILE);
}

function emptyStore(): ModelsStoreFile {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, customModels: [], verifications: {} };
}

function sanitizeVerifications(raw: unknown): Record<string, ModelVerificationRecord> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const out: Record<string, ModelVerificationRecord> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") {
      continue;
    }
    const r = v as Partial<ModelVerificationRecord>;
    if (
      typeof r.verifiedAt === "string" &&
      typeof r.latencyMs === "number" &&
      typeof r.model === "string" &&
      typeof r.baseUrl === "string"
    ) {
      out[k] = {
        verifiedAt: r.verifiedAt,
        latencyMs: r.latencyMs,
        model: r.model,
        baseUrl: r.baseUrl,
      };
    }
  }
  return out;
}

export function readModelsStore(lawMindRoot: string): ModelsStoreFile {
  const p = modelsStorePath(lawMindRoot);
  if (!fs.existsSync(p)) {
    return emptyStore();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as ModelsStoreFile;
    if ((raw.schemaVersion !== 1 && raw.schemaVersion !== 2) || !Array.isArray(raw.customModels)) {
      return emptyStore();
    }
    const verifications = sanitizeVerifications((raw as { verifications?: unknown }).verifications);
    const workerModelId =
      typeof raw.workerModelId === "string" && raw.workerModelId.trim()
        ? raw.workerModelId.trim()
        : undefined;
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultModelId:
        typeof raw.defaultModelId === "string" && raw.defaultModelId.trim()
          ? raw.defaultModelId.trim()
          : undefined,
      draftWithModelEnabled: raw.draftWithModelEnabled === true ? true : undefined,
      ...(workerModelId ? { workerModelId } : {}),
      customModels: raw.customModels.filter(isValidCustomRecord).map(sanitizeCustomRecord),
      verifications: verifications ?? {},
    };
  } catch {
    return emptyStore();
  }
}

function isValidCustomRecord(row: unknown): row is CustomModelRecord {
  if (!row || typeof row !== "object") {
    return false;
  }
  const o = row as CustomModelRecord;
  return (
    typeof o.id === "string" &&
    o.id.startsWith("custom:") &&
    typeof o.label === "string" &&
    typeof o.baseUrl === "string" &&
    typeof o.model === "string" &&
    typeof o.apiKey === "string"
  );
}

function sanitizeStopSequences(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const stop = raw
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  return stop.length > 0 ? stop : undefined;
}

function sanitizeCustomRecord(row: CustomModelRecord): CustomModelRecord {
  const { stop: _rawStop, ...rest } = row;
  const stop = sanitizeStopSequences(row.stop);
  return stop ? { ...rest, stop } : rest;
}

export function writeModelsStore(lawMindRoot: string, store: ModelsStoreFile): void {
  fs.mkdirSync(lawMindRoot, { recursive: true });
  fs.writeFileSync(modelsStorePath(lawMindRoot), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function setDefaultModelId(
  lawMindRoot: string,
  modelId: string | undefined,
): ModelsStoreFile {
  const store = readModelsStore(lawMindRoot);
  store.defaultModelId = modelId?.trim() || undefined;
  writeModelsStore(lawMindRoot, store);
  return store;
}

export function isDraftWithModelPreferenceEnabled(lawMindRoot: string): boolean {
  return readModelsStore(lawMindRoot).draftWithModelEnabled === true;
}

export function setDraftWithModelEnabled(lawMindRoot: string, enabled: boolean): ModelsStoreFile {
  const store = readModelsStore(lawMindRoot);
  store.draftWithModelEnabled = enabled ? true : undefined;
  writeModelsStore(lawMindRoot, store);
  return store;
}

/** E7: optional worker model id for tool-loop rounds. */
export function setWorkerModelId(
  lawMindRoot: string,
  modelId: string | undefined,
): ModelsStoreFile {
  const store = readModelsStore(lawMindRoot);
  const id = modelId?.trim();
  store.workerModelId = id || undefined;
  writeModelsStore(lawMindRoot, store);
  return store;
}

export type UpsertCustomModelInput = {
  label: string;
  baseUrl: string;
  model: string;
  /**
   * When empty: the key is expected to live in the OS keychain and be injected
   * via `process.env[LAWMIND_CUSTOM_<UUID>_API_KEY]` by the Electron main
   * process. Set `allowKeylessIfKeychain: true` to accept this.
   */
  apiKey: string;
  /** Allow `apiKey: ""` when keychain integration is expected. */
  allowKeylessIfKeychain?: boolean;
  /** Optional stop sequences for chat/completions (E3). */
  stop?: string[];
};

export function addCustomModel(
  lawMindRoot: string,
  input: UpsertCustomModelInput,
): CustomModelRecord {
  const label = input.label.trim();
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  const model = input.model.trim();
  const apiKey = input.apiKey.trim();
  if (!label || !baseUrl || !model) {
    throw new Error("custom_model_fields_required");
  }
  if (!apiKey && !input.allowKeylessIfKeychain) {
    throw new Error("custom_model_fields_required");
  }
  // Guard against accidentally using a LawMind internal catalog id or a raw UUID as the upstream model name.
  if (/^(custom|builtin|platform|env):/i.test(model)) {
    throw new Error("custom_model_invalid_model_name");
  }
  // Catch bare UUIDs or long hex strings that are clearly not model names (e.g. from copy-paste of internal ids).
  const hexOnly = /^[0-9a-f]+$/i;
  const dashedUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ((hexOnly.test(model) && model.length >= 20) || dashedUuid.test(model)) {
    throw new Error("custom_model_invalid_model_name");
  }
  const now = new Date().toISOString();
  const stop = sanitizeStopSequences(input.stop);
  const row: CustomModelRecord = {
    id: `custom:${randomUUID()}`,
    kind: "custom",
    label,
    baseUrl,
    model,
    apiKey,
    ...(stop ? { stop } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const store = readModelsStore(lawMindRoot);
  store.customModels.push(row);
  writeModelsStore(lawMindRoot, store);
  return row;
}

export function removeCustomModel(lawMindRoot: string, modelId: string): boolean {
  const id = modelId.trim();
  if (!id.startsWith("custom:")) {
    return false;
  }
  const store = readModelsStore(lawMindRoot);
  const before = store.customModels.length;
  store.customModels = store.customModels.filter((m) => m.id !== id);
  if (store.defaultModelId === id) {
    store.defaultModelId = undefined;
  }
  if (store.verifications && store.verifications[id]) {
    const { [id]: _removed, ...rest } = store.verifications;
    store.verifications = rest;
  }
  if (store.customModels.length === before) {
    return false;
  }
  writeModelsStore(lawMindRoot, store);
  return true;
}

export function getCustomModelById(
  lawMindRoot: string,
  modelId: string,
): CustomModelRecord | undefined {
  const store = readModelsStore(lawMindRoot);
  return store.customModels.find((m) => m.id === modelId);
}

/**
 * Persist a successful model verification (POST /api/models/test) for `modelId`.
 *
 * Persists under `verifications[modelId]` and bumps `schemaVersion` to 2.
 */
export function recordVerification(
  lawMindRoot: string,
  modelId: string,
  payload: Omit<ModelVerificationRecord, "verifiedAt"> & { verifiedAt?: string },
): ModelsStoreFile {
  const id = modelId.trim();
  if (!id) {
    throw new Error("model_id_required");
  }
  const store = readModelsStore(lawMindRoot);
  store.verifications = store.verifications ?? {};
  store.verifications[id] = {
    verifiedAt: payload.verifiedAt ?? new Date().toISOString(),
    latencyMs: payload.latencyMs,
    model: payload.model,
    baseUrl: payload.baseUrl,
  };
  writeModelsStore(lawMindRoot, store);
  return store;
}

/** Remove a single verification record. Returns true if something was deleted. */
export function clearVerification(lawMindRoot: string, modelId: string): boolean {
  const id = modelId.trim();
  if (!id) {
    return false;
  }
  const store = readModelsStore(lawMindRoot);
  if (!store.verifications || !store.verifications[id]) {
    return false;
  }
  const { [id]: _removed, ...rest } = store.verifications;
  store.verifications = rest;
  writeModelsStore(lawMindRoot, store);
  return true;
}

/** Return all verifications, sanitized. Never throws. */
export function listVerifications(lawMindRoot: string): Record<string, ModelVerificationRecord> {
  const store = readModelsStore(lawMindRoot);
  return store.verifications ?? {};
}
