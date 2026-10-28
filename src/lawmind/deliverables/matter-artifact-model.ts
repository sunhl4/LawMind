/**
 * 案件成果物：时间线 / 大事记 / 思维导图 —— 纯模型（无 fs/path）。
 *
 * 供桌面渲染层直接引用；磁盘读写见 `matter-artifact.ts`。
 * 包含：类型、宽容归一化、归纳、按年分组、思维导图布局。
 */

import { MATTER_ARTIFACT_EXTENSIONS } from "../drafts/matter-artifact-regen.js";

/** 成果物类型 = skill 名，也是 JSON 里的 `kind`。 */
export type MatterArtifactKind = "case-timeline" | "case-chronology" | "case-mindmap";

export type MatterArtifactIssue = { path: string; reasonZh: string };

export type MatterArtifactEvidence = {
  /** 材料相对路径（相对工作区根，如 `cases/m/materials/合同.pdf`）。 */
  filePath: string;
  /** `L3` / `P2` / `S1!A1`。 */
  lineRef?: string;
  quote?: string;
};

export type MatterTimelineEvent = {
  id: string;
  /** 原始日期串（保留律师写法）；排序用 `sortKey`。 */
  date: string;
  sortKey: string;
  endDate?: string;
  title: string;
  summary?: string;
  kind?: "fact" | "procedure" | "dispute" | "evidence" | "other";
  evidence: MatterArtifactEvidence[];
};

export type MatterChronologyEntry = {
  id: string;
  date: string;
  sortKey: string;
  fact: string;
  people: string[];
  evidence: MatterArtifactEvidence[];
};

export type MatterMindmapNode = {
  id: string;
  label: string;
  kind?: "issue" | "fact" | "party" | "evidence" | "other";
  children: MatterMindmapNode[];
};

export type MatterTimelineArtifact = {
  schemaVersion: 1;
  kind: "case-timeline";
  title?: string;
  events: MatterTimelineEvent[];
};

export type MatterChronologyArtifact = {
  schemaVersion: 1;
  kind: "case-chronology";
  title?: string;
  entries: MatterChronologyEntry[];
};

export type MatterMindmapArtifact = {
  schemaVersion: 1;
  kind: "case-mindmap";
  title?: string;
  root: MatterMindmapNode;
};

export type MatterArtifact =
  | MatterTimelineArtifact
  | MatterChronologyArtifact
  | MatterMindmapArtifact;

export type MatterArtifactReadResult =
  | { status: "missing" }
  | { status: "invalid"; issues: MatterArtifactIssue[] }
  | { status: "ok"; artifact: MatterArtifact; issues: MatterArtifactIssue[] };

const EXTENSION_BY_SKILL = new Map(MATTER_ARTIFACT_EXTENSIONS.map((e) => [e.skill, e]));

function extensionFor(kind: MatterArtifactKind) {
  const ext = EXTENSION_BY_SKILL.get(kind);
  if (!ext) {
    throw new Error(`unknown matter artifact kind: ${kind}`);
  }
  return ext;
}

const DATE_PATTERNS: Array<{
  re: RegExp;
  parts: (m: RegExpExecArray) => [string, string, string];
}> = [
  {
    re: /^(\d{4})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})\s*日?$/,
    parts: (m) => [m[1], m[2], m[3]],
  },
  { re: /^(\d{4})[-/.年]\s*(\d{1,2})\s*月?$/, parts: (m) => [m[1], m[2], "00"] },
  { re: /^(\d{4})\s*年?$/, parts: (m) => [m[1], "00", "00"] },
];

/**
 * 把律师常见日期写法归一成 `{ sortKey, year, displayDate }`。
 * 认不出返回 null（调用方记 issue，不猜）。
 */
export function normalizeMatterDate(
  raw: string,
): { sortKey: string; year: string; displayDate: string } | null {
  const s = (raw ?? "").trim();
  if (!s) {
    return null;
  }
  for (const { re, parts } of DATE_PATTERNS) {
    const m = re.exec(s);
    if (!m) {
      continue;
    }
    const [y, mo, d] = parts(m);
    const month = mo.padStart(2, "0");
    const day = d.padStart(2, "0");
    if (Number(month) > 12 || Number(day) > 31) {
      return null;
    }
    const sortKey = `${y}${month}${day}`;
    const displayDate =
      day === "00" ? (month === "00" ? y : `${y}-${month}`) : `${y}-${month}-${day}`;
    return { sortKey, year: y, displayDate };
  }
  return null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeEvidence(
  raw: unknown,
  at: string,
  issues: MatterArtifactIssue[],
): MatterArtifactEvidence[] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    issues.push({ path: at, reasonZh: "evidence 必须是数组" });
    return [];
  }
  const out: MatterArtifactEvidence[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      issues.push({ path: `${at}[${i}]`, reasonZh: "evidence 条目必须是对象" });
      return;
    }
    const rec = item as Record<string, unknown>;
    const filePath = asString(rec.filePath ?? rec.path);
    if (!filePath) {
      issues.push({ path: `${at}[${i}]`, reasonZh: "evidence 缺少 filePath" });
      return;
    }
    const lineRef = asString(rec.lineRef);
    const quote = asString(rec.quote);
    out.push({
      filePath,
      ...(lineRef ? { lineRef } : {}),
      ...(quote ? { quote } : {}),
    });
  });
  return out;
}

function normalizeTimeline(
  raw: Record<string, unknown>,
  issues: MatterArtifactIssue[],
): MatterTimelineArtifact {
  const eventsRaw = Array.isArray(raw.events) ? raw.events : [];
  if (!Array.isArray(raw.events)) {
    issues.push({ path: "events", reasonZh: "events 必须是数组" });
  }
  const events: MatterTimelineEvent[] = [];
  const seen = new Set<string>();
  eventsRaw.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      issues.push({ path: `events[${i}]`, reasonZh: "条目必须是对象" });
      return;
    }
    const rec = item as Record<string, unknown>;
    const title = asString(rec.title);
    const dateRaw = asString(rec.date);
    const parsed = normalizeMatterDate(dateRaw);
    if (!title) {
      issues.push({ path: `events[${i}]`, reasonZh: "缺少 title，已跳过" });
      return;
    }
    if (!parsed) {
      issues.push({ path: `events[${i}]`, reasonZh: `日期无法识别「${dateRaw}」，已跳过` });
      return;
    }
    let id = asString(rec.id) || `ev-${i + 1}`;
    if (seen.has(id)) {
      id = `${id}-${i + 1}`;
    }
    seen.add(id);
    const kindRaw = asString(rec.kind);
    const kind =
      kindRaw === "fact" ||
      kindRaw === "procedure" ||
      kindRaw === "dispute" ||
      kindRaw === "evidence"
        ? kindRaw
        : kindRaw === "other"
          ? "other"
          : undefined;
    events.push({
      id,
      date: dateRaw,
      sortKey: parsed.sortKey,
      title,
      ...(asString(rec.summary) ? { summary: asString(rec.summary) } : {}),
      ...(kind ? { kind } : {}),
      evidence: normalizeEvidence(rec.evidence, `events[${i}].evidence`, issues),
    });
  });
  events.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    kind: "case-timeline",
    ...(asString(raw.title) ? { title: asString(raw.title) } : {}),
    events,
  };
}

function normalizeChronology(
  raw: Record<string, unknown>,
  issues: MatterArtifactIssue[],
): MatterChronologyArtifact {
  const rows = Array.isArray(raw.entries) ? raw.entries : [];
  if (!Array.isArray(raw.entries)) {
    issues.push({ path: "entries", reasonZh: "entries 必须是数组" });
  }
  const entries: MatterChronologyEntry[] = [];
  const seen = new Set<string>();
  rows.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      issues.push({ path: `entries[${i}]`, reasonZh: "条目必须是对象" });
      return;
    }
    const rec = item as Record<string, unknown>;
    const fact = asString(rec.fact ?? rec.text);
    const dateRaw = asString(rec.date);
    const parsed = normalizeMatterDate(dateRaw);
    if (!fact) {
      issues.push({ path: `entries[${i}]`, reasonZh: "缺少 fact，已跳过" });
      return;
    }
    if (!parsed) {
      issues.push({ path: `entries[${i}]`, reasonZh: `日期无法识别「${dateRaw}」，已跳过` });
      return;
    }
    let id = asString(rec.id) || `ch-${i + 1}`;
    if (seen.has(id)) {
      id = `${id}-${i + 1}`;
    }
    seen.add(id);
    const people = Array.isArray(rec.people)
      ? rec.people.map((p) => asString(p)).filter(Boolean)
      : [];
    entries.push({
      id,
      date: dateRaw,
      sortKey: parsed.sortKey,
      fact,
      people,
      evidence: normalizeEvidence(rec.evidence, `entries[${i}].evidence`, issues),
    });
  });
  entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    kind: "case-chronology",
    ...(asString(raw.title) ? { title: asString(raw.title) } : {}),
    entries,
  };
}

const MINDMAP_MAX_DEPTH = 6;

function normalizeMindmapNode(
  raw: unknown,
  at: string,
  depth: number,
  issues: MatterArtifactIssue[],
  seq: { n: number },
): MatterMindmapNode | null {
  if (!raw || typeof raw !== "object") {
    issues.push({ path: at, reasonZh: "节点必须是对象" });
    return null;
  }
  if (depth > MINDMAP_MAX_DEPTH) {
    issues.push({ path: at, reasonZh: `超过 ${MINDMAP_MAX_DEPTH} 层，已截断` });
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const label = asString(rec.label ?? rec.title);
  if (!label) {
    issues.push({ path: at, reasonZh: "节点缺少 label，已跳过" });
    return null;
  }
  seq.n += 1;
  const kindRaw = asString(rec.kind);
  const kind =
    kindRaw === "issue" || kindRaw === "fact" || kindRaw === "party" || kindRaw === "evidence"
      ? kindRaw
      : kindRaw === "other"
        ? "other"
        : undefined;
  const childrenRaw = Array.isArray(rec.children) ? rec.children : [];
  const children: MatterMindmapNode[] = [];
  childrenRaw.forEach((child, i) => {
    const normalized = normalizeMindmapNode(child, `${at}.children[${i}]`, depth + 1, issues, seq);
    if (normalized) {
      children.push(normalized);
    }
  });
  return {
    id: asString(rec.id) || `node-${seq.n}`,
    label,
    ...(kind ? { kind } : {}),
    children,
  };
}

function normalizeMindmap(
  raw: Record<string, unknown>,
  issues: MatterArtifactIssue[],
): MatterMindmapArtifact {
  const root = normalizeMindmapNode(raw.root, "root", 0, issues, { n: 0 });
  if (!root) {
    issues.push({ path: "root", reasonZh: "缺少可用的根节点" });
    return {
      schemaVersion: 1,
      kind: "case-mindmap",
      ...(asString(raw.title) ? { title: asString(raw.title) } : {}),
      root: { id: "root", label: "思维导图", children: [] },
    };
  }
  return {
    schemaVersion: 1,
    kind: "case-mindmap",
    ...(asString(raw.title) ? { title: asString(raw.title) } : {}),
    root,
  };
}

/** 宽容归一化：坏条目记录 issue 并丢弃，不让一处脏数据拖垮整张图。 */
export function normalizeMatterArtifact(
  kind: MatterArtifactKind,
  raw: unknown,
): { artifact: MatterArtifact; issues: MatterArtifactIssue[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    const empty: MatterArtifact =
      kind === "case-mindmap"
        ? { schemaVersion: 1, kind, root: { id: "root", label: "思维导图", children: [] } }
        : kind === "case-chronology"
          ? { schemaVersion: 1, kind, entries: [] }
          : { schemaVersion: 1, kind, events: [] };
    return { artifact: empty, issues: [{ path: "/", reasonZh: "文件不是 JSON 对象" }] };
  }
  const rec = raw as Record<string, unknown>;
  const issues: MatterArtifactIssue[] = [];
  if (rec.schemaVersion !== undefined && rec.schemaVersion !== 1) {
    issues.push({ path: "schemaVersion", reasonZh: "只支持 schemaVersion 1" });
  }
  if (rec.kind !== undefined && rec.kind !== kind) {
    const renderedKind = typeof rec.kind === "string" ? rec.kind : JSON.stringify(rec.kind);
    issues.push({ path: "kind", reasonZh: `kind 与文件名不一致（${renderedKind}）` });
  }
  const artifact =
    kind === "case-timeline"
      ? normalizeTimeline(rec, issues)
      : kind === "case-chronology"
        ? normalizeChronology(rec, issues)
        : normalizeMindmap(rec, issues);
  return { artifact, issues };
}

export type MatterArtifactSummary = {
  itemCount: number;
  anchoredCount: number;
  unanchoredCount: number;
  /** 有日期的条目才进年份区间。 */
  yearFrom?: string;
  yearTo?: string;
};

function countEvidence(items: Array<{ evidence: MatterArtifactEvidence[] }>): {
  anchored: number;
  unanchored: number;
} {
  let anchored = 0;
  let unanchored = 0;
  for (const item of items) {
    if (item.evidence.length > 0) {
      anchored += 1;
    } else {
      unanchored += 1;
    }
  }
  return { anchored, unanchored };
}

function countMindmapNodes(node: MatterMindmapNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countMindmapNodes(child), 0);
}

export function summarizeMatterArtifact(artifact: MatterArtifact): MatterArtifactSummary {
  if (artifact.kind === "case-mindmap") {
    const itemCount = countMindmapNodes(artifact.root);
    return { itemCount, anchoredCount: 0, unanchoredCount: 0 };
  }
  const items = artifact.kind === "case-timeline" ? artifact.events : artifact.entries;
  const { anchored, unanchored } = countEvidence(items);
  const dated = items.filter((i) => i.sortKey.slice(4) !== "0000");
  return {
    itemCount: items.length,
    anchoredCount: anchored,
    unanchoredCount: unanchored,
    ...(dated.length > 0
      ? {
          yearFrom: dated[0].sortKey.slice(0, 4),
          yearTo: dated[dated.length - 1].sortKey.slice(0, 4),
        }
      : {}),
  };
}

export type MatterTimelineGroup = {
  year: string;
  items: Array<{
    id: string;
    /** `MM-DD`（无日则 `MM`，无月则空串）。 */
    shortDate: string;
    displayDate: string;
    title: string;
    summary?: string;
    evidence: MatterArtifactEvidence[];
  }>;
};

/** 按年分组，供时间线渲染（黑底不参与；UI 用 `.lm-timeline`）。 */
export function groupTimelineByYear(
  artifact: MatterTimelineArtifact | MatterChronologyArtifact,
): MatterTimelineGroup[] {
  const rows =
    artifact.kind === "case-timeline"
      ? artifact.events.map((e) => ({
          id: e.id,
          sortKey: e.sortKey,
          date: e.date,
          title: e.title,
          summary: e.summary,
          evidence: e.evidence,
        }))
      : artifact.entries.map((e) => ({
          id: e.id,
          sortKey: e.sortKey,
          date: e.date,
          title: e.fact,
          summary: e.people.length > 0 ? `涉及：${e.people.join("、")}` : undefined,
          evidence: e.evidence,
        }));
  const groups = new Map<string, MatterTimelineGroup>();
  for (const row of rows) {
    const year = row.sortKey.slice(0, 4);
    const mm = row.sortKey.slice(4, 6);
    const dd = row.sortKey.slice(6, 8);
    const shortDate = dd !== "00" ? `${mm}-${dd}` : mm !== "00" ? mm : "";
    let group = groups.get(year);
    if (!group) {
      group = { year, items: [] };
      groups.set(year, group);
    }
    group.items.push({
      id: row.id,
      shortDate,
      displayDate: dd !== "00" ? `${year}-${mm}-${dd}` : mm !== "00" ? `${year}-${mm}` : year,
      title: row.title,
      ...(row.summary ? { summary: row.summary } : {}),
      evidence: row.evidence,
    });
  }
  return [...groups.values()].toSorted((a, b) => a.year.localeCompare(b.year));
}

/* ── 思维导图布局（纯函数，渲染层只画） ───────────────────────── */

export type MatterMindmapLayoutNode = {
  id: string;
  label: string;
  kind?: MatterMindmapNode["kind"];
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MatterMindmapLayoutEdge = {
  from: string;
  to: string;
};

export type MatterMindmapLayout = {
  width: number;
  height: number;
  nodes: MatterMindmapLayoutNode[];
  edges: MatterMindmapLayoutEdge[];
};

const NODE_HEIGHT = 30;
const ROW_GAP = 10;
const COL_GAP = 32;
const NODE_PAD_X = 12;
const CHAR_UNIT = 6.6;
const MIN_NODE_WIDTH = 72;
const MAX_NODE_WIDTH = 220;

/** 估算单行标签宽度：CJK 按两格，ASCII 按一格。不引测量库。 */
export function estimateMindmapLabelWidth(label: string): number {
  let units = 0;
  for (const ch of label) {
    units += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  const raw = units * (CHAR_UNIT / 2) + NODE_PAD_X * 2;
  return Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, Math.round(raw)));
}

/**
 * 左→右层级布局：列宽取该层最宽节点，y 由先序遍历确定，父节点居中于子节点。
 * 结果确定（同样输入 → 同样坐标），便于快照与测试。
 */
export function layoutMatterMindmap(root: MatterMindmapNode): MatterMindmapLayout {
  const depthWidth: number[] = [];
  const measure = (node: MatterMindmapNode, depth: number): void => {
    const w = estimateMindmapLabelWidth(node.label);
    depthWidth[depth] = Math.max(depthWidth[depth] ?? 0, w);
    for (const child of node.children) {
      measure(child, depth + 1);
    }
  };
  measure(root, 0);

  const colX: number[] = [];
  let cursorX = 0;
  for (let d = 0; d < depthWidth.length; d += 1) {
    colX[d] = cursorX;
    cursorX += (depthWidth[d] ?? MIN_NODE_WIDTH) + COL_GAP;
  }

  const nodes: MatterMindmapLayoutNode[] = [];
  const edges: MatterMindmapLayoutEdge[] = [];
  let rowCursor = 0;

  const place = (node: MatterMindmapNode, depth: number): MatterMindmapLayoutNode => {
    const width = depthWidth[depth] ?? MIN_NODE_WIDTH;
    const childNodes = node.children.map((child) => {
      edges.push({ from: node.id, to: child.id });
      return place(child, depth + 1);
    });
    let y: number;
    if (childNodes.length === 0) {
      y = rowCursor;
      rowCursor += NODE_HEIGHT + ROW_GAP;
    } else {
      const first = childNodes[0];
      const last = childNodes[childNodes.length - 1];
      y = (first.y + last.y) / 2;
    }
    const placed: MatterMindmapLayoutNode = {
      id: node.id,
      label: node.label,
      ...(node.kind ? { kind: node.kind } : {}),
      depth,
      x: colX[depth] ?? 0,
      y,
      width,
      height: NODE_HEIGHT,
    };
    nodes.push(placed);
    return placed;
  };

  const rootNode = place(root, 0);
  const width = Math.max(cursorX - COL_GAP, ...nodes.map((n) => n.x + n.width), rootNode.width);
  const height = Math.max(rowCursor - ROW_GAP, NODE_HEIGHT);
  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
    nodes: nodes.toSorted((a, b) => a.depth - b.depth || a.y - b.y),
    edges,
  };
}

export function matterArtifactFileName(kind: MatterArtifactKind): string {
  return extensionFor(kind).file;
}

export function matterArtifactLabel(kind: MatterArtifactKind): string {
  return extensionFor(kind).nameZh;
}

export function matterArtifactEmptyDescription(kind: MatterArtifactKind): string {
  return extensionFor(kind).emptyDescriptionZh;
}
