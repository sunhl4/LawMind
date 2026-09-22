export const CHART_TYPES = ["bar", "line", "pie", "stacked_bar"] as const;

export type ChartType = (typeof CHART_TYPES)[number];

export type ChartSpec = {
  title: string;
  type: ChartType;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
  unit?: string;
  source?: { path: string; sheet?: string };
  notes?: string;
};

export type ChartSpecParse = { ok: true; spec: ChartSpec } | { ok: false; error: string };

function asFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export const MAX_CHART_CATEGORIES = 24;
export const MAX_CHART_SERIES = 8;

export function parseChartSpec(raw: unknown): ChartSpecParse {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "图表规格必须是对象。" };
  }
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim().slice(0, 120) : "";
  if (!title) {
    return { ok: false, error: "图表需要 title。" };
  }
  const type = typeof o.type === "string" ? o.type.trim() : "";
  if (!CHART_TYPES.includes(type as ChartType)) {
    return { ok: false, error: "图表 type 必须是 bar、line、pie 或 stacked_bar。" };
  }
  if (!Array.isArray(o.categories) || o.categories.length === 0) {
    return { ok: false, error: "图表需要非空 categories。" };
  }
  if (o.categories.length > MAX_CHART_CATEGORIES) {
    return { ok: false, error: `categories 最多 ${MAX_CHART_CATEGORIES} 项。` };
  }
  const categories = o.categories.map((c) => String(c ?? "").slice(0, 40));
  if (!Array.isArray(o.series) || o.series.length === 0) {
    return { ok: false, error: "图表需要至少一条 series。" };
  }
  if (o.series.length > MAX_CHART_SERIES) {
    return { ok: false, error: `series 最多 ${MAX_CHART_SERIES} 条。` };
  }
  const series: ChartSpec["series"] = [];
  for (const row of o.series) {
    if (!row || typeof row !== "object") {
      return { ok: false, error: "series 项必须是对象。" };
    }
    const s = row as Record<string, unknown>;
    const name = typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 40) : "系列";
    if (!Array.isArray(s.values)) {
      return { ok: false, error: "series.values 必须是数组。" };
    }
    if (s.values.length !== categories.length) {
      return { ok: false, error: `系列「${name}」的数值个数与 categories 不一致。` };
    }
    const values: number[] = [];
    for (const v of s.values) {
      const n = asFiniteNumber(v);
      if (n === undefined) {
        return { ok: false, error: `系列「${name}」含有非数值。` };
      }
      values.push(n);
    }
    series.push({ name, values });
  }
  const spec: ChartSpec = {
    title,
    type: type as ChartType,
    categories,
    series,
  };
  if (typeof o.unit === "string" && o.unit.trim()) {
    spec.unit = o.unit.trim().slice(0, 32);
  }
  if (typeof o.notes === "string" && o.notes.trim()) {
    spec.notes = o.notes.trim().slice(0, 400);
  }
  if (o.source && typeof o.source === "object") {
    const src = o.source as Record<string, unknown>;
    if (typeof src.path === "string" && src.path.trim()) {
      spec.source = {
        path: src.path.trim().slice(0, 200),
        ...(typeof src.sheet === "string" && src.sheet.trim()
          ? { sheet: src.sheet.trim().slice(0, 31) }
          : {}),
      };
    }
  }
  return { ok: true, spec };
}

export function isEmptyChartSpec(spec: ChartSpec): boolean {
  return spec.categories.length === 0 || spec.series.every((s) => s.values.every((v) => v === 0));
}
