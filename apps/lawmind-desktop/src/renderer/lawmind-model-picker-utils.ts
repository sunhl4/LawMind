import type { ModelCatalogEntry } from "./lawmind-models-api";

/**
 * Group model catalog rows by `group` field, keeping a stable display order.
 *
 * Mirrors the legacy `<select>` grouping used by `lawmind-chat-shell.tsx`.
 */
export function groupModelCatalog(
  catalog: ModelCatalogEntry[],
): Array<[string, ModelCatalogEntry[]]> {
  const map = new Map<string, ModelCatalogEntry[]>();
  for (const row of catalog) {
    const g = row.group || "其他";
    const list = map.get(g) ?? [];
    list.push(row);
    map.set(g, list);
  }
  // Display order: pinned-front → builtins (alphabetical) → pinned-tail
  const PINNED_FRONT = ["平台模型", "当前配置"];
  const PINNED_TAIL = ["自定义模型"];
  const entries = [...map.entries()];
  const rank = (g: string): number => {
    const fi = PINNED_FRONT.indexOf(g);
    if (fi !== -1) {return fi;}
    const ti = PINNED_TAIL.indexOf(g);
    if (ti !== -1) {return 1000 + ti;}
    return 500;
  };
  entries.sort(([a], [b]) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) {return ra - rb;}
    return a.localeCompare(b, "zh-CN");
  });
  return entries;
}

/**
 * Pick the actual `<select>` / picker value: prefer the user's selection when
 * it is configured; otherwise fall back to the first configured row.
 */
export function resolveComposeModelSelectValue(
  catalog: ModelCatalogEntry[],
  selectedModelId: string,
): string {
  if (selectedModelId && catalog.some((m) => m.id === selectedModelId && m.configured)) {
    return selectedModelId;
  }
  const configured = catalog.find((m) => m.configured);
  if (configured) {return configured.id;}
  if (selectedModelId) {return selectedModelId;}
  if (catalog.length > 0) {return catalog[0].id;}
  return "builtin:qwen-plus";
}

/**
 * Filter catalog rows by a free-text query (matches label / model / provider /
 * description — not `group`, so group titles like 「通义千问」 don't over-match).
 */
export function filterModelCatalog(
  catalog: ModelCatalogEntry[],
  query: string,
): ModelCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) {return catalog;}
  return catalog.filter((m) => {
    const haystack = `${m.label} ${m.model} ${m.provider} ${m.description ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * Build a flat, group-ordered list of rows for keyboard navigation. Returns
 * `[items, indices]` where `indices[i]` is the absolute catalog index of
 * `items[i]`.
 */
export function flattenGroupedCatalog(
  groups: Array<[string, ModelCatalogEntry[]]>,
): Array<{ group: string; row: ModelCatalogEntry }> {
  const out: Array<{ group: string; row: ModelCatalogEntry }> = [];
  for (const [group, rows] of groups) {
    for (const row of rows) {
      out.push({ group, row });
    }
  }
  return out;
}

/** Next focusable row in the flat list, skipping unconfigured rows. */
export function nextSelectableIndex(
  rows: Array<{ row: ModelCatalogEntry }>,
  from: number,
  direction: 1 | -1,
): number {
  if (rows.length === 0) {return -1;}
  const n = rows.length;
  let i = from;
  for (let step = 0; step < n; step += 1) {
    i = (i + direction + n) % n;
    if (rows[i].row.configured) {
      return i;
    }
  }
  // No configured row; just wrap from current.
  return (from + direction + n) % n;
}

export type ProviderIconKey =
  | "dashscope"
  | "openai"
  | "deepseek"
  | "moonshot"
  | "zhipu"
  | "platform"
  | "custom";

export function providerIconKey(row: ModelCatalogEntry): ProviderIconKey {
  if (row.kind === "platform") {return "platform";}
  if (row.kind === "custom") {return "custom";}
  switch (row.provider) {
    case "dashscope":
    case "openai":
    case "deepseek":
    case "moonshot":
    case "zhipu":
      return row.provider;
    default:
      return "custom";
  }
}

/** Human label for the provider icon (used for `aria-label`). */
export function providerIconLabel(key: ProviderIconKey): string {
  switch (key) {
    case "dashscope":
      return "Qwen";
    case "openai":
      return "OpenAI";
    case "deepseek":
      return "DeepSeek";
    case "moonshot":
      return "Moonshot";
    case "zhipu":
      return "Zhipu";
    case "platform":
      return "Platform";
    case "custom":
      return "Custom";
  }
}

/**
 * Cursor-style display name: prefer the English model id (`qwen-max`, `gpt-4o`).
 */
export function modelPickerDisplayName(
  entry: Pick<ModelCatalogEntry, "label" | "model" | "id">,
): string {
  const model = entry.model?.trim();
  if (model) {
    return model;
  }
  const raw = entry.label?.trim() || "";
  if (!raw || entry.id === "env:current" || /^API\s*向导/.test(raw) || raw.startsWith('主模型')) {
    return "Current";
  }
  return raw;
}

/** @deprecated Prefer {@link modelPickerDisplayName}. */
export function lawyerFacingModelLabel(
  entry: Pick<ModelCatalogEntry, "label" | "model" | "id">,
): string {
  return modelPickerDisplayName(entry);
}

/** English section titles for catalog `group` values from the API. */
export function modelPickerGroupTitle(group: string): string {
  switch (group) {
    case "平台模型":
      return "Platform";
    case "当前配置":
      return "Current";
    case "自定义模型":
      return "Custom";
    case "通义千问":
      return "Qwen";
    case "智谱":
      return "Zhipu";
    case "其他":
      return "Other";
    default:
      return group;
  }
}

/** Format `verifiedAt` ISO into Chinese short form. */
export function formatVerifiedAt(iso: string | undefined): string {
  if (!iso) {return "";}
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {return "";}
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return "";
  }
}
