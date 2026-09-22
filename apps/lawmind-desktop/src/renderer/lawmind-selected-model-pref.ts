const STORAGE_KEY = "lawmind.selectedModelId";
const BY_ASSISTANT_KEY = "lawmind.selectedModelId.byAssistant";

type ByAssistantMap = Record<string, string>;

function readByAssistantMap(): ByAssistantMap {
  try {
    const raw = localStorage.getItem(BY_ASSISTANT_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const out: ByAssistantMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "string" && v.trim()) {
        out[k] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeByAssistantMap(map: ByAssistantMap): void {
  try {
    localStorage.setItem(BY_ASSISTANT_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function readSelectedModelId(assistantId?: string | null): string | null {
  const aid = assistantId?.trim();
  if (aid) {
    const mapped = readByAssistantMap()[aid];
    if (mapped) {
      return mapped;
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)?.trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function writeSelectedModelId(modelId: string, assistantId?: string | null): void {
  const id = modelId.trim();
  if (!id) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  const aid = assistantId?.trim();
  if (!aid) {
    return;
  }
  const map = readByAssistantMap();
  map[aid] = id;
  writeByAssistantMap(map);
}
