/**
 * 对话中栏的采信纸。
 *
 * 只收已经能指回来源的结论、缺口、风险标记和审查宽表。
 * 没有出处的句子不进入可采信列表。律师的采信 / 太满 / 拿掉记在 sidecar，不改稿子正文。
 */

import { parseChartSpec } from "../agent/tools/legal/chart-spec.js";
import type { ReviewTable } from "../deliverables/review-table.js";
import type { ArtifactDraft, ResearchBundle, ResearchClaim, ResearchSource } from "../types.js";

export type AcceptanceMark = "accepted" | "too_strong" | "removed";

export type AcceptanceOpenKind = "pdf" | "word" | "file" | "citation";

export type AcceptanceSourceView = {
  id: string;
  title: string;
  citation?: string;
  excerpt?: string;
  /** 工作区或本机文件夹内的相对路径。绝对路径与网址不在这里打开。 */
  relPath?: string;
  /** 1-based page when the source is a PDF and the pin names a page. */
  page?: number;
  pageLabel?: string;
  openKind: AcceptanceOpenKind;
  demo?: boolean;
};

export type AcceptanceClaimView = {
  id: string;
  text: string;
  /** 只有检索结论自带的把握才显示。稿子段落没有评分，不编一个。 */
  confidenceLabel?: "高" | "中" | "低";
  locator?: string;
  quote?: string;
  sources: AcceptanceSourceView[];
  mark: AcceptanceMark | null;
  demo: boolean;
};

export type AcceptanceGapView = {
  id: string;
  text: string;
};

export type AcceptanceTableView = {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<{
    id: string;
    cells: Record<string, string>;
    sourceLabel: string;
    sourced: boolean;
  }>;
};

/** 带来源文件的图。没有出处的图不进核对纸，只留在对话里。 */
export type AcceptanceChartView = {
  id: string;
  title: string;
  specText: string;
  sourcePath: string;
  sourceSheet?: string;
};

export type AcceptanceSheet = {
  taskId: string;
  title: string;
  matterId?: string;
  /** 执行摘要只作导语，不提供采信。没有逐句出处。 */
  summary?: string;
  hasDraft: boolean;
  claims: AcceptanceClaimView[];
  gaps: AcceptanceGapView[];
  risks: string[];
  table?: AcceptanceTableView;
  /** 本轮带来源的图。只读，不能在纸上改数。 */
  charts?: AcceptanceChartView[];
  removedCount: number;
  /** 有东西值得律师看时才打开中栏。 */
  open: boolean;
};

export type AcceptanceMarksFile = {
  taskId: string;
  marks: Record<string, AcceptanceMark>;
  updatedAt: string;
};

const TASK_ID_RE = /^[a-zA-Z0-9._-]{1,200}$/;

export function isAcceptanceTaskId(id: string): boolean {
  return TASK_ID_RE.test(id) && !id.includes("..");
}

export function acceptanceClaimId(text: string, sourceIds: readonly string[]): string {
  const basis = `${text.trim()}\n${[...sourceIds]
    .map((id) => id.trim())
    .filter(Boolean)
    .toSorted()
    .join(",")}`;
  let hash = 2166136261;
  for (let i = 0; i < basis.length; i += 1) {
    hash ^= basis.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `c${(hash >>> 0).toString(16)}`;
}

function confidenceLabel(confidence: number): "高" | "中" | "低" {
  if (confidence >= 0.75) {
    return "高";
  }
  if (confidence >= 0.45) {
    return "中";
  }
  return "低";
}

function pageLabel(page: string | undefined): string | undefined {
  const trimmed = page?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.includes("页")) {
    return trimmed;
  }
  if (/^\d+$/.test(trimmed)) {
    return `第 ${trimmed} 页`;
  }
  return trimmed;
}

/** 只接受相对路径。网址和绝对路径留给引用文字，不在应用里打开。 */
export function relativeMaterialPath(url: string | undefined): string | undefined {
  const raw = url?.trim();
  if (!raw) {
    return undefined;
  }
  const trimmed = (raw.split("#")[0] ?? raw).split("?")[0] ?? raw;
  if (!trimmed || trimmed.includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return undefined;
  }
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return undefined;
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/^[/\\]+/, "");
  if (!normalized || normalized.split("/").some((part) => part === "..")) {
    return undefined;
  }
  return normalized;
}

/** 从「12」「第 12 页」或 `page=12` 取出页码。没有明确页码时不猜。 */
export function acceptancePageNumber(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  const labeled = trimmed.match(/(\d{1,4})(?:\s*[-–~～至到]\s*\d{1,4})?\s*页/)?.[1];
  const pageEq = trimmed.match(/page=(\d{1,4})/i)?.[1];
  const pure = /^\d{1,4}$/.test(trimmed) ? trimmed : undefined;
  const token = labeled ?? pageEq ?? pure;
  if (!token) {
    return undefined;
  }
  const page = Number(token);
  if (!Number.isInteger(page) || page < 1 || page > 500) {
    return undefined;
  }
  return page;
}

function pageFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const match = /(?:#|\?|&)page=(\d+)/i.exec(url);
  return match?.[1];
}

function openKindForPath(relPath: string | undefined): AcceptanceOpenKind {
  if (!relPath) {
    return "citation";
  }
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) {
    return "word";
  }
  if (/\.(xlsx?|pptx?|txt|md)$/i.test(lower)) {
    return "file";
  }
  return "citation";
}

export function sourceView(source: ResearchSource, pinPage?: string): AcceptanceSourceView {
  const relPath = relativeMaterialPath(source.url);
  const pageText = pinPage || pageFromUrl(source.url);
  const page = acceptancePageNumber(pageText);
  return {
    id: source.id,
    title: source.title.trim() || source.citation?.trim() || source.id,
    citation: source.citation?.trim() || undefined,
    excerpt: source.excerpt?.trim() || undefined,
    relPath,
    page,
    pageLabel: pageLabel(pageText),
    openKind: openKindForPath(relPath),
    demo: source.demo === true,
  };
}

function compactPassage(value: string): string {
  return value.replace(/\s+/g, "").replace(/[，。；、：:（）()《》「」""''、]/g, "");
}

/** 两段话是不是同一段。短引文嵌在长结论里不算重复。 */
export function samePassage(left: string, right: string): boolean {
  const a = compactPassage(left);
  const b = compactPassage(right);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  if (shorter.length < 12) {
    return false;
  }
  return longer.includes(shorter) && shorter.length / longer.length >= 0.85;
}

/** 章节名，或没有更短的不同原文时，不拿来让律师采信。 */
export function showAcceptanceClaim(claim: Pick<AcceptanceClaimView, "text" | "quote">): boolean {
  if (isTitleNotConclusion(claim.text) || isPlaceholderConclusion(claim.text)) {
    return false;
  }
  const quote = claim.quote?.trim();
  if (quote && samePassage(claim.text, quote)) {
    return false;
  }
  return true;
}

const GENERIC_LOCATOR = /^(结论|意见|分析|法律分析|摘要|概述|说明|要点|综述)$/;

function usableLocator(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text || GENERIC_LOCATOR.test(text)) {
    return undefined;
  }
  return text;
}

/** 章节名、节名，不是要律师采信的判断。 */
function isTitleNotConclusion(text: string): boolean {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line || line.length > 80 || /[。！？]/.test(line)) {
    return false;
  }
  return /^第[0-9０-９一二三四五六七八九十百千]+[章节]/.test(line);
}

function isPlaceholderConclusion(text: string): boolean {
  const line = text.replace(/\s+/g, "");
  return /^(见检索|见上|见下文|同上|略|待补充|暂无)/.test(line);
}

/** 会铺开中间栏的判断。顺序上先是会写进稿子的句子。 */
export function acceptanceDecisionClaims(
  sheet: Pick<AcceptanceSheet, "claims">,
): AcceptanceClaimView[] {
  return sheet.claims.filter((claim) => claim.mark !== "removed" && showAcceptanceClaim(claim));
}

/** 缺口、风险、表、图。没有判断时不铺开，只在对话里留一行。 */
export function acceptanceAsideCount(
  sheet: Pick<AcceptanceSheet, "gaps" | "risks" | "table" | "charts">,
): number {
  return (
    sheet.gaps.length +
    sheet.risks.length +
    (sheet.table && sheet.table.rows.length > 0 ? 1 : 0) +
    (sheet.charts?.length ?? 0)
  );
}

function locatorLine(claim: ResearchClaim, sources: AcceptanceSourceView[]): string | undefined {
  const pin = claim.pin;
  const parts = [pin?.article, pin?.clause, pageLabel(pin?.page)]
    .map((part) => part?.trim())
    .filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  const citation = sources.map((source) => source.citation).find(Boolean);
  return citation;
}

function claimView(
  claim: ResearchClaim,
  sourcesById: Map<string, ResearchSource>,
  marks: Record<string, AcceptanceMark>,
  assessed: boolean,
): AcceptanceClaimView | undefined {
  const text = claim.text.trim();
  const sourceIds = (claim.sourceIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (!text || sourceIds.length === 0) {
    return undefined;
  }
  const resolved = sourceIds
    .map((id) => sourcesById.get(id))
    .filter((source): source is ResearchSource => Boolean(source));
  if (resolved.length === 0) {
    return undefined;
  }
  let pinPageLeft = claim.pin?.page;
  const views = resolved.map((source) => {
    const ownPage = pageFromUrl(source.url);
    const rel = relativeMaterialPath(source.url);
    const pdf = Boolean(rel?.toLowerCase().endsWith(".pdf"));
    let pin: string | undefined;
    if (!ownPage && pdf && pinPageLeft) {
      pin = pinPageLeft;
      pinPageLeft = undefined;
    }
    return sourceView(source, pin);
  });
  const id = acceptanceClaimId(text, sourceIds);
  const excerpt = views.find((source) => source.excerpt)?.excerpt?.trim();
  if (
    isTitleNotConclusion(text) ||
    isPlaceholderConclusion(text) ||
    (excerpt && samePassage(excerpt, text))
  ) {
    return undefined;
  }
  const pinQuote = claim.pin?.quote?.trim();
  const quote =
    (pinQuote && !samePassage(pinQuote, text) ? pinQuote : undefined) ||
    (excerpt && !samePassage(excerpt, text) ? excerpt : undefined);
  return {
    id,
    text,
    ...(assessed ? { confidenceLabel: confidenceLabel(claim.confidence) } : {}),
    locator: usableLocator(locatorLine(claim, views)),
    quote: quote?.trim() || undefined,
    sources: views,
    mark: marks[id] ?? null,
    demo: claim.demo === true || views.some((source) => source.demo),
  };
}

function sectionClaims(
  draft: ArtifactDraft,
  sourcesById: Map<string, ResearchSource>,
  marks: Record<string, AcceptanceMark>,
): AcceptanceClaimView[] {
  const out: AcceptanceClaimView[] = [];
  for (const section of draft.sections) {
    const text = section.body.trim();
    const sourceIds = (section.citations ?? []).map((id) => id.trim()).filter(Boolean);
    const view = claimView(
      {
        text,
        sourceIds,
        confidence: 0.5,
        model: "legal",
      },
      sourcesById,
      marks,
      false,
    );
    if (view && !out.some((claim) => claim.id === view.id)) {
      const locator = usableLocator(section.heading) || view.locator;
      out.push(locator ? { ...view, locator } : view);
    }
  }
  return out;
}

function tableView(table: ReviewTable | undefined): AcceptanceTableView | undefined {
  if (!table || table.rows.length === 0 || table.columns.length === 0) {
    return undefined;
  }
  return {
    title: table.title.trim() || "审查表",
    columns: table.columns.map((column) => ({ key: column.key, label: column.label })),
    rows: table.rows.map((row) => {
      const source = row.source?.trim();
      return {
        id: row.id,
        cells: row.cells,
        sourceLabel: source || "未标明出处",
        sourced: Boolean(source),
      };
    }),
  };
}

export function acceptanceChartFromSpec(
  spec: unknown,
  artifactPath?: string,
): AcceptanceChartView | undefined {
  const parsed = parseChartSpec(spec);
  if (!parsed.ok) {
    return undefined;
  }
  const sourcePath = relativeMaterialPath(parsed.spec.source?.path);
  if (!sourcePath) {
    return undefined;
  }
  const artifact = artifactPath?.trim();
  const id =
    artifact && !artifact.includes("..") && !artifact.startsWith("/")
      ? artifact
      : acceptanceClaimId(parsed.spec.title, [sourcePath]);
  return {
    id,
    title: parsed.spec.title,
    specText: JSON.stringify(parsed.spec),
    sourcePath,
    sourceSheet: parsed.spec.source?.sheet,
  };
}

export function acceptanceChartsFromToolData(name: string, data: unknown): AcceptanceChartView[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const record = data as { spec?: unknown; path?: unknown; charts?: unknown };
  const rows =
    name === "render_chart"
      ? [{ spec: record.spec, path: record.path }]
      : name === "run_compute" && Array.isArray(record.charts)
        ? record.charts
        : [];
  const out: AcceptanceChartView[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const item = row as { spec?: unknown; path?: unknown };
    const chart = acceptanceChartFromSpec(
      item.spec,
      typeof item.path === "string" ? item.path : undefined,
    );
    if (chart && !out.some((existing) => existing.id === chart.id)) {
      out.push(chart);
    }
  }
  return out.slice(0, 4);
}

export function buildAcceptanceSheet(input: {
  taskId: string;
  bundle?: ResearchBundle;
  draft?: ArtifactDraft;
  table?: ReviewTable;
  charts?: AcceptanceChartView[];
  marks?: Record<string, AcceptanceMark>;
}): AcceptanceSheet | null {
  const taskId = input.taskId.trim();
  if (!isAcceptanceTaskId(taskId)) {
    return null;
  }
  const charts = input.charts ?? [];
  if (!input.bundle && !input.draft && !input.table && charts.length === 0) {
    return null;
  }
  const marks = input.marks ?? {};
  const sources = input.bundle?.sources ?? [];
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const fromSections = input.draft ? sectionClaims(input.draft, sourcesById, marks) : [];
  const fromBundle = (input.bundle?.claims ?? [])
    .map((claim) => claimView(claim, sourcesById, marks, true))
    .filter((claim): claim is AcceptanceClaimView => Boolean(claim));
  const claims = [...fromSections];
  for (const claim of fromBundle) {
    if (!claims.some((existing) => existing.id === claim.id)) {
      claims.push(claim);
    }
  }
  const gaps = (input.bundle?.missingItems ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .map((text) => ({ id: acceptanceClaimId(text, ["gap"]), text }));
  const risks = (input.bundle?.riskFlags ?? []).map((item) => item.trim()).filter(Boolean);
  const table = tableView(input.table);
  const removedCount = claims.filter((claim) => claim.mark === "removed").length;
  const visibleClaims = claims.filter((claim) => claim.mark !== "removed");
  const summary = input.draft?.summary.trim() || undefined;
  const title =
    input.draft?.title.trim() ||
    table?.title ||
    input.bundle?.query.trim() ||
    charts[0]?.title ||
    "本轮核对";
  const open =
    visibleClaims.length > 0 ||
    removedCount > 0 ||
    gaps.length > 0 ||
    risks.length > 0 ||
    (table?.rows.length ?? 0) > 0 ||
    charts.length > 0;
  if (!open) {
    return null;
  }
  return {
    taskId,
    title,
    matterId: input.draft?.matterId?.trim() || undefined,
    summary,
    hasDraft: Boolean(input.draft),
    claims,
    gaps,
    risks,
    table,
    ...(charts.length > 0 ? { charts } : {}),
    removedCount,
    open,
  };
}

export function tooStrongInstruction(
  claim: Pick<AcceptanceClaimView, "text" | "quote" | "locator">,
): string {
  const where = claim.locator?.trim();
  const quote = claim.quote?.trim();
  const lines = [
    "这句写得太满。请改弱，保留原有出处，不要补充没有依据的话。",
    where ? `位置：${where}` : "",
    `原句：「${claim.text.trim()}」`,
    quote ? `依据原文：「${quote}」` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
