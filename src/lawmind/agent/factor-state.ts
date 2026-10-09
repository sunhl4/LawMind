/**
 * Diagonal factor state for a turn.
 *
 * The engine owns anchors, masses, and read-only stabilizers.
 * The model only samples. No phases, no quantum circuits, no qubit kernel.
 *
 * Purity γ = Σ p². A binary reading is definite only when γ ≥ 0.75
 * and the winning outcome has grounded === true (independent span or tool).
 * Missing grounded is mixed, same as grounded:false. No argmax.
 */

import { CONTRACT_ROLE_WORDS, extractDefinedTermsFromText } from "../drafts/terminology-adapt.js";
import { CONFORMAL_ALPHA, conformalProject, conformalQuantile } from "./factor-conformal.js";
import { builtinTemplateHeadings, parseOoxmlHeadingForest } from "./ooxml-skeleton.js";
import {
  cloneSkeleton,
  flattenSkeleton,
  parseSkeletonForest,
  type SkeletonNode,
} from "./skeleton-tree.js";

export type { SkeletonNode } from "./skeleton-tree.js";

export const GAMMA_STAR = 0.75;
/** Split conformal stays off until this many calibration scores exist. */
export const MIN_CONFORMAL_CALIBRATION = 8;
export const MASS_EPSILON = 0.25;
export const MAX_FACTOR_REPAIRS = 2;
export const ADIABATIC_MAX_STEPS = 6;
export const MAX_FACTORS = 64;
export const FACTOR_REPAIR_MARKER = "【因子修复】";
export const REJECTED_PROSE_MARKER = "【未采纳】该稿未通过稳定子，不得当作事实。";
export const ENGINE_READINGS_HEADER = "【引擎核定】";
export const FREE_SKELETON_HEADER = "未从已验证骨架变形";

const XML_QA_CODES = new Set(["xml_qa_no_tracks", "xml_qa_non_minimal_edits"]);
const SOURCE_TOOLS = new Set([
  "search_statute",
  "search_case_law",
  "search_matter",
  "research_task",
]);

export type FactorKind = "citation" | "amount" | "redline" | "clause";
export type FactorFlag = "ok" | "mixed" | "conflict" | "uncorrectable";
export type StabilizerId = "S1" | "S2" | "S3" | "S4";

export type FactorOutcome = {
  id: string;
  mass: number;
  /** True only with an independent span or tool result. Missing is mixed. */
  grounded?: boolean;
  /** Material quote that grounds this reading. Survives compaction. */
  span?: string;
};

export type Factor = {
  anchor: string;
  kind: FactorKind;
  outcomes: FactorOutcome[];
  repairs: number;
  flag: FactorFlag;
  neighbors: string[];
  /** Model proposal that is not independent evidence. */
  proposalId?: string;
  /** Outcomes from before the first proposal, so a correction can invert it. */
  priorOutcomes?: FactorOutcome[];
};

export type CalculatedSlot = {
  anchor: string;
  value: string;
};

export type FactorState = {
  factors: Factor[];
  sourcePack: string[];
  demoCorpusIds: string[];
  calculatedSlots: CalculatedSlot[];
  redlineFailures: string[];
  lastSurgicalAnchors: string[];
  /**
   * 1-hop closed after 「不对」. Later surgical writes outside this set are zero.
   * Empty means no held cone (the current batch is unconstrained).
   */
  correctionLightCone?: string[];
  adiabaticStep: number;
  /** Canonical terms extracted from the document. Empty means the party check stays off. */
  definedTerms?: string[];
  /** Alias → canonical term. The engine does not guess which role a word names. */
  termAliases?: Record<string, string>;
  /** Inverse find/replace pairs for edits already written. A correction reapplies them. */
  inverseEdits?: InverseEdit[];
  /**
   * Role words that already occur in ingested document text.
   * They are this draft's support, not a foreign proposal.
   */
  documentRoles?: string[];
  /** Section bodies from before the last surgical write, keyed by draft id. */
  bodySnapshots?: Array<{ taskId: string; bodies: string[] }>;
  /** Existing headings. A starting point the model may change, not a sentence script. */
  skeletonHeadings?: string[];
  /** Nested outline parsed from those headings. */
  skeletonTree?: SkeletonNode[];
  /** Last outline that passed the mechanical syndrome. Next draft may start from it. */
  lastPassedSkeleton?: SkeletonNode[];
  /** Anchors already bound while walking the skeleton this session. */
  skeletonBoundAnchors?: string[];
  /** Held-out nonconformity scores. Empty means live projection stays on γ. */
  conformalScores?: number[];
  /**
   * Model judgment sentences kept across compaction. Not evidence, not a factor.
   * The engine does not write or choose them.
   */
  keptJudgments?: string[];
  /** Statute or contract text copied at retrieval time. Survives compaction. */
  citationSpans?: Array<{ id: string; text: string }>;
  /** Equality cycles whose party definitions disagree. The model writes them; the engine does not pick. */
  definitionCycles?: Array<{ names: string[]; definitions: string[] }>;
  /** Span ids copied from demo-corpus hits. */
  demoSpanIds?: string[];
  /** Worker patches that passed span checks. Surgical apply uses these on matching finds. */
  pendingPatches?: WorkerPatch[];
};

export type InverseEdit = {
  find: string;
  replace: string;
  count?: number;
  /** Factor anchors this patch touched. Empty means map from find/replace at revert time. */
  anchors?: string[];
};

export type WorkerPatch = {
  anchor?: string;
  find: string;
  replace: string;
  span?: string;
};

export type SyndromeHit = {
  stabilizer: StabilizerId;
  anchor: string;
};

export type SkeletonChoice = {
  kind: "document" | "template" | "free";
  header?: string;
};

export type ProseSyndromeDecision =
  | { action: "none" }
  | { action: "bounce"; note: string }
  | { action: "deliver"; pending: string };

export function emptyFactorState(): FactorState {
  return {
    factors: [],
    sourcePack: [],
    demoCorpusIds: [],
    calculatedSlots: [],
    redlineFailures: [],
    lastSurgicalAnchors: [],
    correctionLightCone: [],
    adiabaticStep: 0,
    definedTerms: [],
    termAliases: {},
    inverseEdits: [],
    documentRoles: [],
    bodySnapshots: [],
    skeletonHeadings: [],
    skeletonTree: [],
    lastPassedSkeleton: [],
    skeletonBoundAnchors: [],
    conformalScores: [],
    keptJudgments: [],
    citationSpans: [],
    definitionCycles: [],
    demoSpanIds: [],
    pendingPatches: [],
  };
}

/** Amounts copied from the lawyer's own text this turn. Not a legal conclusion. */
export const STATED_AMOUNT_PREFIX = "amount:stated:";

const STATED_AMOUNT_CAP = 24;

/** Amounts and redlines are turn-local. Anchors from earlier turns stay for the light cone. */
export function beginTurnFactors(state: FactorState): FactorState {
  state.calculatedSlots = [];
  state.redlineFailures = [];
  state.adiabaticStep = 0;
  state.factors = state.factors.filter((factor) => !factor.anchor.startsWith(STATED_AMOUNT_PREFIX));
  for (const factor of state.factors) {
    factor.repairs = 0;
    if (factor.flag === "uncorrectable") {
      factor.flag = "ok";
    }
  }
  return state;
}

export function purity(outcomes: readonly FactorOutcome[]): number {
  return outcomes.reduce((sum, outcome) => sum + outcome.mass * outcome.mass, 0);
}

export function normalizeOutcomes(outcomes: readonly FactorOutcome[]): FactorOutcome[] {
  const positive = outcomes.filter((outcome) => outcome.id.trim() && outcome.mass > 0).slice(0, 4);
  const total = positive.reduce((sum, outcome) => sum + outcome.mass, 0);
  if (total <= 0) {
    return [];
  }
  return positive.map((outcome) => ({
    id: outcome.id.trim(),
    mass: outcome.mass / total,
    grounded: outcome.grounded === true,
    ...(outcome.span?.trim() ? { span: outcome.span.trim() } : {}),
  }));
}

export function projectReading(
  outcomes: readonly FactorOutcome[],
): { kind: "definite"; id: string } | { kind: "mixed"; ids: string[] } {
  const normalized = normalizeOutcomes(outcomes);
  if (normalized.length === 0) {
    return { kind: "mixed", ids: [] };
  }
  if (purity(normalized) >= GAMMA_STAR) {
    const top = normalized.toSorted((a, b) => b.mass - a.mass)[0];
    if (!top || top.grounded !== true) {
      return {
        kind: "mixed",
        ids: normalized
          .filter((outcome) => outcome.mass >= MASS_EPSILON)
          .map((outcome) => outcome.id),
      };
    }
    return { kind: "definite", id: top.id };
  }
  return {
    kind: "mixed",
    ids: normalized.filter((outcome) => outcome.mass >= MASS_EPSILON).map((outcome) => outcome.id),
  };
}

export function setConformalCalibration(state: FactorState, scores: readonly number[]): void {
  state.conformalScores = scores.filter((score) => Number.isFinite(score));
}

export function conformalQhatFor(state: FactorState | undefined): number | undefined {
  const scores = state?.conformalScores ?? [];
  if (scores.length < MIN_CONFORMAL_CALIBRATION) {
    return undefined;
  }
  return conformalQuantile(scores, CONFORMAL_ALPHA);
}

/**
 * Calibrated overlay: never upgrades a mixed γ reading. A definite γ reading
 * stays definite only when the conformal set is a singleton. No qhat → γ.
 */
export function projectReadingGated(
  outcomes: readonly FactorOutcome[],
  qhat?: number,
): { kind: "definite"; id: string } | { kind: "mixed"; ids: string[] } {
  const base = projectReading(outcomes);
  if (qhat === undefined || !Number.isFinite(qhat)) {
    return base;
  }
  const projected = conformalProject(
    normalizeOutcomes(outcomes).map((row) => ({
      id: row.id,
      purity: row.mass,
      grounded: row.grounded === true,
    })),
    qhat,
  );
  if (base.kind === "definite" && projected.kind === "definite") {
    return { kind: "definite", id: projected.id };
  }
  if (base.kind === "definite") {
    return {
      kind: "mixed",
      ids: projected.ids.length > 0 ? projected.ids : [base.id],
    };
  }
  return base;
}

/** Independent evidence on one anchor. Disjoint support is conflict, not a picked side. */
export function productMerge(
  left: readonly FactorOutcome[],
  right: readonly FactorOutcome[],
): { outcomes: FactorOutcome[]; conflict: boolean } {
  const ids = new Set<string>([
    ...left.map((outcome) => outcome.id),
    ...right.map((outcome) => outcome.id),
  ]);
  const raw: FactorOutcome[] = [];
  for (const id of ids) {
    const a = left.find((outcome) => outcome.id === id);
    const b = right.find((outcome) => outcome.id === id);
    const span = a?.span?.trim() || b?.span?.trim() || "";
    raw.push({
      id,
      mass: (a?.mass ?? 0) * (b?.mass ?? 0),
      grounded: a?.grounded === true && b?.grounded === true,
      ...(span ? { span } : {}),
    });
  }
  const normalized = normalizeOutcomes(raw);
  if (normalized.length === 0) {
    return { outcomes: [], conflict: true };
  }
  return { outcomes: normalized, conflict: false };
}

export function anchorsMentionedInParts(state: FactorState, parts: readonly string[]): string[] {
  const blob = parts.join("\n");
  if (!blob.trim()) {
    return [];
  }
  const named = new Set<string>();
  for (const factor of state.factors) {
    if (!factor.anchor) {
      continue;
    }
    if (blob.includes(factor.anchor)) {
      named.add(factor.anchor);
      continue;
    }
    for (const outcome of factor.outcomes) {
      if (outcome.id && blob.includes(outcome.id)) {
        named.add(factor.anchor);
        break;
      }
    }
  }
  return [...named];
}

function undirectedNeighbors(state: FactorState, anchor: string): string[] {
  const found = new Set<string>();
  const factor = state.factors.find((item) => item.anchor === anchor);
  for (const neighbor of factor?.neighbors ?? []) {
    if (neighbor.trim()) {
      found.add(neighbor);
    }
  }
  for (const other of state.factors) {
    if (other.anchor !== anchor && other.neighbors.includes(anchor)) {
      found.add(other.anchor);
    }
  }
  return [...found];
}

/** Graph distance from the seeds. Missing seeds are ignored. */
export function hopDistanceMap(state: FactorState, seeds: readonly string[]): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const seed of seeds) {
    const id = seed.trim();
    if (!id || dist.has(id) || !state.factors.some((factor) => factor.anchor === id)) {
      continue;
    }
    dist.set(id, 0);
    queue.push(id);
  }
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) {
      continue;
    }
    const here = dist.get(current) ?? 0;
    for (const neighbor of undirectedNeighbors(state, current)) {
      if (dist.has(neighbor)) {
        continue;
      }
      dist.set(neighbor, here + 1);
      queue.push(neighbor);
    }
  }
  return dist;
}

export type HopTruncationReport = {
  hop1: string[];
  /** Path length ≥ 2 from the seed. */
  longRange: string[];
  /** No path to the seed. Isolation, not truncation error. */
  isolated: string[];
  /** amount / citation / defined / redline in longRange — 1-hop approximation error. */
  mechanicalDropped: string[];
};

const MECHANICAL_HOP_RE = /^(?:amount|citation|defined|redline):/;

/** Measure what 1-hop drops. Does not widen the worker marginal. */
export function hopTruncation(state: FactorState, seeds: readonly string[]): HopTruncationReport {
  const dist = hopDistanceMap(state, seeds);
  const hop1: string[] = [];
  const longRange: string[] = [];
  const isolated: string[] = [];
  for (const factor of state.factors) {
    const distance = dist.get(factor.anchor);
    if (distance === undefined) {
      isolated.push(factor.anchor);
    } else if (distance <= 1) {
      hop1.push(factor.anchor);
    } else {
      longRange.push(factor.anchor);
    }
  }
  return {
    hop1,
    longRange,
    isolated,
    mechanicalDropped: longRange.filter((anchor) => MECHANICAL_HOP_RE.test(anchor)),
  };
}

const TERM_ANCHOR_RE = /生效日|到期日|续期|通知期/;

export function isTermAnchor(anchor: string): boolean {
  return TERM_ANCHOR_RE.test(anchor);
}

export function marginalFactors(state: FactorState, anchors: readonly string[]): Factor[] {
  const dist = hopDistanceMap(state, anchors);
  const selected = state.factors.filter((factor) => {
    const distance = dist.get(factor.anchor);
    return distance !== undefined && distance <= 1;
  });
  if (!anchors.some((anchor) => isTermAnchor(anchor))) {
    return selected;
  }
  const seen = new Set(selected.map((factor) => factor.anchor));
  for (const factor of state.factors) {
    if (seen.has(factor.anchor) || !isTermAnchor(factor.anchor)) {
      continue;
    }
    selected.push(factor);
    seen.add(factor.anchor);
  }
  return selected;
}

export function formatMarginalBlock(factors: readonly Factor[], qhat?: number): string {
  if (factors.length === 0) {
    return "";
  }
  const lines = factors.map((factor) => `- ${factor.anchor}：${renderFactorBody(factor, qhat)}`);
  return ["【约化因子】只使用下面这些锚，不要引用未列出的对话。", ...lines].join("\n");
}

/**
 * Sampling view only. Drops rejected amount/citation tokens from assistant
 * prose so the next prefix cannot treat them as evidence. Lawyer history stays.
 */
export function projectAssistantProseForSampling(
  content: string,
  state: FactorState | undefined,
): string {
  if (!state || !content) {
    return content;
  }
  let out = content;
  for (const factor of state.factors) {
    if (factor.flag !== "conflict" && factor.flag !== "mixed" && factor.flag !== "uncorrectable") {
      continue;
    }
    if (factor.anchor.startsWith("negation:")) {
      const token = factor.proposalId?.trim() || factor.anchor.replace(/^negation:/, "").trim();
      if (token) {
        out = unbindPolarityCollision(out, token);
      }
      continue;
    }
    if (factor.kind !== "amount" && factor.kind !== "citation") {
      continue;
    }
    if (factor.kind === "amount") {
      const proposal = factor.proposalId?.trim();
      if (proposal && out.includes(proposal)) {
        const grounded = projectReading(factor.outcomes);
        const replacement = grounded.kind === "definite" ? grounded.id : "";
        const hint = slotHint(factor.anchor);
        out = redactAmountProposal(out, proposal, replacement, hint);
      }
    }
    if (factor.kind === "citation") {
      const id = factor.anchor.replace(/^citation:/, "");
      const proposal = factor.proposalId?.trim();
      out = out
        .split("\n")
        .map((line) => {
          const touches = line.includes(id) || (proposal ? line.includes(proposal) : false);
          if (!touches) {
            return line;
          }
          let next = line;
          if (proposal === "live" && /权威|现行/.test(next) && !next.includes("演示语料")) {
            next = next
              .replaceAll("权威来源", "演示语料")
              .replaceAll("现行有效", "演示语料")
              .replaceAll("现行法", "演示语料");
          }
          if (
            proposal &&
            proposal !== "live" &&
            proposal !== "demo" &&
            !state.sourcePack.includes(proposal)
          ) {
            next = next.replaceAll(`〔${proposal}〕`, "");
            // Statute names are the model's argument. Keep them; only drop
            // a false pointer id. Mixing those two is the same as argmax.
            if (!isStatuteToken(proposal) && !isStatuteToken(id)) {
              next = next.replaceAll(proposal, "");
            } else {
              next = next
                .replaceAll("权威来源", "")
                .replaceAll("现行有效", "")
                .replaceAll("现行法", "");
            }
          }
          return next;
        })
        .join("\n");
    }
  }
  return out;
}

/** Rebuilt every sample from the factor state, so compaction cannot drop it. */
export function renderEngineReadings(state: FactorState | undefined): string {
  if (!state) {
    return "";
  }
  const qhat = conformalQhatFor(state);
  const lines = state.factors.map(
    (factor) => `- ${factor.anchor}：${renderFactorBody(factor, qhat)}`,
  );
  const spans = renderCitationSpans(state.citationSpans ?? []);
  const cycles = renderDefinitionCycles(state.definitionCycles ?? []);
  const skeleton = renderSkeletonStart(skeletonHeadingsForRender(state));
  const judgments = renderKeptJudgments(state.keptJudgments ?? []);
  if (lines.length === 0 && !spans && !cycles && !skeleton && !judgments) {
    return "";
  }
  const parts = [
    lines.length > 0
      ? [
          `${ENGINE_READINGS_HEADER}下面是工具核定的读法。整篇仍由你写。写到已核定的锚时沿用核定结果，不要把待核实改成确定句。争点、结构和其余措辞由你判断。待核实是缺口，不是禁写。你之前写过的句子不是证据。`,
          ...lines,
        ].join("\n")
      : "",
    spans,
    cycles,
    skeleton,
    judgments,
  ].filter(Boolean);
  return parts.join("\n\n");
}

const CITATION_SPAN_CAP = 24;
const CITATION_SPAN_CHARS = 240;

function renderCitationSpans(spans: readonly { id: string; text: string }[]): string {
  if (spans.length === 0) {
    return "";
  }
  return [
    "【引用原文】下面是检索时抄下的原文。压缩后仍用这段，不要另编条文。",
    ...spans.map((span) => `- ${span.id}：${span.text}`),
  ].join("\n");
}

function renderDefinitionCycles(
  cycles: readonly { names: string[]; definitions: string[] }[],
): string {
  if (cycles.length === 0) {
    return "";
  }
  return [
    "【定义环】下面几组叫法连成同一圈，但定义原文不一致。不要选边，当作待核实写明。",
    ...cycles.map((cycle) => `- ${cycle.names.join("、")}：${cycle.definitions.join("；")}`),
  ].join("\n");
}

function hitSnippet(row: Record<string, unknown>): string {
  for (const key of ["snippet", "excerpt", "quote", "span", "text"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, CITATION_SPAN_CHARS);
    }
  }
  return "";
}

function collectHitSpans(
  record: Record<string, unknown>,
): Array<{ id: string; text: string; source?: string; title?: string; url?: string }> {
  const raw = Array.isArray(record.hits) ? record.hits : [];
  const spans: Array<{ id: string; text: string; source?: string; title?: string; url?: string }> =
    [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const text = hitSnippet(row);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const source = typeof row.source === "string" ? row.source.trim() : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    spans.push({
      id: title || source || text.slice(0, 32),
      text,
      ...(source ? { source } : {}),
      ...(title ? { title } : {}),
      ...(url ? { url } : {}),
    });
    if (spans.length >= 8) {
      break;
    }
  }
  return spans;
}

/** Drop duplicate hit arrays after the quote is copied. Sampling only; history stays. */
export function projectToolResultForSampling(content: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  if (!parsed || typeof parsed !== "object") {
    return content;
  }
  const root = parsed as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  const hits = collectHitSpans(data);
  if (
    hits.length === 0 &&
    !Array.isArray(data.workspaceHits) &&
    !Array.isArray(data.authorityHits)
  ) {
    return content;
  }
  const slimHits = hits.map((hit) => ({
    ...(hit.source ? { source: hit.source } : {}),
    ...(hit.title ? { title: hit.title } : {}),
    snippet: hit.text,
    ...(hit.url ? { url: hit.url } : {}),
  }));
  const slim: Record<string, unknown> = {};
  if (typeof data.query === "string") {
    slim.query = data.query;
  }
  if (data.demoCorpus === true) {
    slim.demoCorpus = true;
  }
  if (Array.isArray(data.sourceIds)) {
    slim.sourceIds = data.sourceIds;
  }
  if (typeof data.note === "string") {
    slim.note = data.note.slice(0, CITATION_SPAN_CHARS);
  }
  if (slimHits.length > 0) {
    slim.hits = slimHits;
  }
  const next = JSON.stringify(root.data ? { ok: root.ok, data: slim } : slim);
  return next.length < content.length ? next : content;
}

function rememberCitationSpans(state: FactorState, record: Record<string, unknown>): void {
  const incoming = collectHitSpans(record);
  if (incoming.length === 0) {
    return;
  }
  state.citationSpans = state.citationSpans ?? [];
  for (const span of incoming) {
    if (state.citationSpans.some((item) => item.text === span.text)) {
      continue;
    }
    state.citationSpans.push({ id: span.id, text: span.text });
    if (record.demoCorpus === true) {
      state.demoSpanIds = state.demoSpanIds ?? [];
      pushUnique(state.demoSpanIds, span.id);
    }
  }
  if (state.citationSpans.length > CITATION_SPAN_CAP) {
    state.citationSpans.splice(0, state.citationSpans.length - CITATION_SPAN_CAP);
  }
}

function connectDefinitionAliases(state: FactorState): void {
  const aliases = state.termAliases ?? {};
  for (const factor of state.factors.slice()) {
    if (!factor.anchor.startsWith("defined:")) {
      continue;
    }
    const outcome =
      factor.outcomes.find((item) => item.grounded === true && item.mass > 0)?.id?.trim() ?? "";
    const canonical = aliases[outcome];
    if (canonical) {
      linkNeighbors(state, factor.anchor, `defined:${canonical}`);
    }
  }
}

/** Party labels tied by aliases whose definition strings disagree. */
export function refreshDefinitionCycles(state: FactorState): void {
  connectDefinitionAliases(state);
  const nodes = state.factors.filter((factor) => factor.anchor.startsWith("defined:"));
  const parent = new Map<string, string>();
  const find = (anchor: string): string => {
    let node = anchor;
    while (parent.get(node) && parent.get(node) !== node) {
      node = parent.get(node) ?? node;
    }
    return node;
  };
  const unite = (left: string, right: string) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) {
      parent.set(b, a);
    }
  };
  for (const factor of nodes) {
    parent.set(factor.anchor, factor.anchor);
  }
  for (const factor of nodes) {
    for (const neighbor of factor.neighbors) {
      if (parent.has(neighbor)) {
        unite(factor.anchor, neighbor);
      }
    }
  }
  const groups = new Map<string, Factor[]>();
  for (const factor of nodes) {
    const root = find(factor.anchor);
    const list = groups.get(root) ?? [];
    list.push(factor);
    groups.set(root, list);
  }
  const roles = new Set<string>(CONTRACT_ROLE_WORDS);
  const cycles: Array<{ names: string[]; definitions: string[] }> = [];
  for (const group of groups.values()) {
    const defs = new Map<string, string>();
    for (const factor of group) {
      const name = factor.anchor.slice("defined:".length);
      if (!roles.has(name)) {
        continue;
      }
      const outcome =
        factor.outcomes.find((item) => item.grounded === true && item.mass > 0)?.id?.trim() ?? "";
      if (!outcome || outcome === name) {
        continue;
      }
      defs.set(name, outcome);
    }
    const unique = [...new Set(defs.values())];
    if (unique.length < 2) {
      continue;
    }
    cycles.push({ names: [...defs.keys()], definitions: unique });
  }
  state.definitionCycles = cycles;
}

const SKELETON_HEADING_CAP = 24;

export function extractSkeletonHeadings(text: string): string[] {
  const headings: string[] = [];
  for (const raw of text.split(/\n/)) {
    const trimmed = raw.trim();
    const markdown = /^#{1,3}\s+(.+)$/.exec(trimmed);
    const clause = /^(第[0-9一二三四五六七八九十百]+条\s*.{0,32})/.exec(trimmed);
    const outline = /^(\d{1,2}(?:\.\d{1,2}){0,3}[ \t　]+[\u4e00-\u9fa5][^\n]{0,32})/.exec(trimmed);
    const heading = (markdown?.[1] ?? clause?.[1] ?? outline?.[1] ?? "").trim();
    if (!heading || headings.includes(heading)) {
      continue;
    }
    headings.push(heading.slice(0, 40));
    if (headings.length >= SKELETON_HEADING_CAP) {
      break;
    }
  }
  return headings;
}

/** Keep the first skeleton. A later document outline may replace it. */
export function rememberSkeleton(
  state: FactorState,
  headings: readonly string[],
  source: "instruction" | "document" = "instruction",
): void {
  const next = headings
    .map((heading) => heading.trim())
    .filter(Boolean)
    .slice(0, SKELETON_HEADING_CAP);
  if (next.length === 0) {
    return;
  }
  if (source === "instruction" && (state.skeletonHeadings ?? []).length > 0) {
    return;
  }
  state.skeletonHeadings = next;
  state.skeletonTree = parseSkeletonForest(next);
}

/** Freeze the current outline when mechanical flags are clean. */
export function commitPassedSkeleton(state: FactorState): void {
  const blocked = state.factors.some(
    (factor) => factor.flag === "conflict" || factor.flag === "uncorrectable",
  );
  if (blocked) {
    return;
  }
  const tree = state.skeletonTree ?? [];
  if (tree.length === 0) {
    return;
  }
  state.lastPassedSkeleton = cloneSkeleton(tree);
}

/** Live headings, else the last outline that passed the mechanical syndrome. */
export function skeletonHeadingsForRender(state: FactorState): string[] {
  const live = (state.skeletonHeadings ?? []).map((heading) => heading.trim()).filter(Boolean);
  if (live.length > 0) {
    return live;
  }
  return flattenSkeleton(state.lastPassedSkeleton ?? []);
}

/** Bind a new fact slot on the skeleton. Repairs do not call this. Cap is ADIABATIC_MAX_STEPS. */
export function bindSkeletonSlot(state: FactorState, anchor: string): boolean {
  const id = anchor.trim();
  if (!id) {
    return false;
  }
  // Clause presence is a checklist row, not an outline slot.
  if (id.startsWith("clause:")) {
    return true;
  }
  state.skeletonBoundAnchors = state.skeletonBoundAnchors ?? [];
  if (state.skeletonBoundAnchors.includes(id)) {
    return true;
  }
  if (!bindAdiabaticSlot(state)) {
    return false;
  }
  state.skeletonBoundAnchors.push(id);
  return true;
}

const JUDGMENT_RE = /建议|主张|倾向|宜写|继续履行|若[^。；]{0,40}则/;
const JUDGMENT_SKIP_RE =
  /(?:¥|￥|人民币)?\s*[0-9][0-9,，]*(?:\.[0-9]+)?\s*(?:万|亿)?\s*元|《[^》]+》|权威来源|现行有效|〔[^〕]+〕/;
const KEPT_JUDGMENT_CAP = 8;

/** Keep the model's own judgment sentences. They are not grounded readings. */
export function rememberJudgments(state: FactorState, prose: string): void {
  const kept = state.keptJudgments ?? [];
  for (const sentence of prose
    .split(/(?<=[。；！？\n])/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)) {
    if (sentence.length > 80 || !JUDGMENT_RE.test(sentence) || JUDGMENT_SKIP_RE.test(sentence)) {
      continue;
    }
    if (kept.includes(sentence)) {
      continue;
    }
    kept.push(sentence);
    if (kept.length >= KEPT_JUDGMENT_CAP) {
      break;
    }
  }
  state.keptJudgments = kept;
}

function renderKeptJudgments(sentences: readonly string[]): string {
  if (sentences.length === 0) {
    return "";
  }
  return [
    "【判断保留】下面是你写过的判断。压缩后仍留在这里。不是证据，可改、可删。",
    ...sentences.map((sentence) => `- ${sentence}`),
  ].join("\n");
}

/** Install a builtin template's columns when no outline is already stored. */
export function rememberBuiltinTemplateSkeleton(state: FactorState, templateId: string): void {
  if ((state.skeletonHeadings ?? []).some((heading) => heading.trim())) {
    return;
  }
  const headings = builtinTemplateHeadings(templateId);
  if (headings.length === 0) {
    return;
  }
  rememberSkeleton(state, headings, "document");
}

/** Install heading nodes parsed from word/document.xml. Body text is ignored. */
export function rememberOoxmlSkeleton(state: FactorState, documentXml: string): void {
  if ((state.skeletonHeadings ?? []).some((heading) => heading.trim())) {
    return;
  }
  const tree = parseOoxmlHeadingForest(documentXml);
  const headings = flattenSkeleton(tree);
  if (headings.length === 0) {
    return;
  }
  state.skeletonHeadings = headings.slice(0, 24);
  state.skeletonTree = cloneSkeleton(tree);
}

export function renderSkeletonStart(headings: readonly string[]): string {
  if (headings.length === 0) {
    return "";
  }
  return [
    "【骨架起点】下面是已有标题，可改、可增、可删，不要逐句照抄。",
    ...headings.map((heading) => `- ${heading}`),
  ].join("\n");
}

/** Lawyer-visible note for mixed or conflicting mechanical items. The prose stays. */
export function appendMechanicalNote(prose: string, state: FactorState | undefined): string {
  if (!state || prose.includes("【机械核定】")) {
    return prose;
  }
  const lines: string[] = [];
  for (const factor of state.factors) {
    const mechanical =
      factor.kind === "amount" ||
      factor.kind === "citation" ||
      factor.anchor.startsWith("party:") ||
      factor.anchor.startsWith("defined:") ||
      factor.anchor.startsWith("negation:");
    if (
      !mechanical ||
      (factor.flag !== "conflict" && factor.flag !== "mixed" && factor.flag !== "uncorrectable")
    ) {
      continue;
    }
    lines.push(`- ${factor.anchor}：${renderFactorBody(factor, conformalQhatFor(state))}`);
  }
  if (lines.length === 0) {
    return prose;
  }
  const note = ["【机械核定】下面几项以引擎为准，上文判断仍保留。", ...lines].join("\n");
  const body = prose.trim();
  return body ? `${body}\n\n${note}` : note;
}

export function bodiesForNextRender(
  current: readonly string[],
  snapshot: readonly string[] | undefined,
): string[] {
  if (!snapshot || snapshot.length === 0) {
    return [...current];
  }
  return restoreBodies(current, snapshot);
}

/**
 * Blocks only a substitution of a grounded amount: the find still contains
 * that number and the replace puts a different 5+ digit number in its place.
 * Other figures in the same draft stay writable.
 */
export function editContradictsGroundedAmount(
  state: FactorState | undefined,
  edits: unknown,
): string | undefined {
  if (!state || !Array.isArray(edits)) {
    return undefined;
  }
  const grounded = new Map<string, string>();
  for (const factor of state.factors) {
    if (factor.kind !== "amount") {
      continue;
    }
    for (const outcome of factor.outcomes) {
      if (outcome.grounded === false || !/^\d{5,}$/.test(outcome.id)) {
        continue;
      }
      grounded.set(outcome.id, factor.anchor);
    }
  }
  if (grounded.size === 0) {
    return undefined;
  }
  for (const edit of edits) {
    if (!edit || typeof edit !== "object") {
      continue;
    }
    const find = (edit as { find?: unknown }).find;
    const replace = (edit as { replace?: unknown }).replace;
    if (typeof find !== "string" || typeof replace !== "string") {
      continue;
    }
    for (const [value, anchor] of grounded) {
      if (!find.includes(value)) {
        continue;
      }
      const nums = replace.match(/\d{5,}/g) ?? [];
      if (nums.some((item) => item !== value)) {
        return anchor;
      }
    }
  }
  return undefined;
}

/** Drop any parent transcript. The marginal block is the only extra state. */
export function composeWorkerSystem(input: {
  instructions: string;
  marginal?: string;
  parentTranscript?: string;
}): string {
  return [input.instructions.trim(), input.marginal?.trim() ?? ""].filter(Boolean).join("\n");
}

export function lightConeAnchors(state: FactorState, named: readonly string[]): string[] {
  return marginalFactors(state, named).map((factor) => factor.anchor);
}

export function anchorsNamedInText(text: string, state: FactorState): string[] {
  return anchorsMentionedInParts(state, [text]);
}

const FACTOR_ANCHOR_RE = /^(?:clause|amount|defined|citation|party|negation|redline):/;

export function isFactorAnchor(anchor: string): boolean {
  return FACTOR_ANCHOR_RE.test(anchor.trim());
}

export function draftTaskIdFromSurgical(state: FactorState): string | undefined {
  return state.lastSurgicalAnchors.find((anchor) => anchor.trim() && !isFactorAnchor(anchor));
}

/** Named factor anchors, else last surgical factor 1-hop; task_id only when the graph has none. */
export function correctionCone(state: FactorState, named: readonly string[]): string[] {
  if (named.length > 0) {
    return lightConeAnchors(state, named);
  }
  const factorSeeds = state.lastSurgicalAnchors.filter(isFactorAnchor);
  if (factorSeeds.length > 0) {
    return lightConeAnchors(state, factorSeeds);
  }
  return [...state.lastSurgicalAnchors];
}

export function linkNeighbors(state: FactorState, left: string, right: string): void {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b || a === b) {
    return;
  }
  const leftFactor = ensureFactor(state, a, "clause");
  const rightFactor = ensureFactor(state, b, "clause");
  if (!leftFactor.neighbors.includes(b)) {
    leftFactor.neighbors.push(b);
  }
  if (!rightFactor.neighbors.includes(a)) {
    rightFactor.neighbors.push(a);
  }
}

/** Tool evidence is grounded. A reading with no attesting span stays mixed even at mass 1. */
export function recordReading(
  state: FactorState,
  anchor: string,
  kind: FactorKind,
  outcomeId: string,
  grounded: boolean,
  span?: string,
): void {
  const factor = ensureFactor(state, anchor, kind);
  factor.kind = kind;
  const quote = span?.trim() ?? "";
  const ok = grounded && (quote.length === 0 || spanAttestsOutcome(quote, outcomeId));
  factor.outcomes = normalizeOutcomes([
    {
      id: outcomeId,
      mass: 1,
      grounded: ok,
      ...(quote ? { span: quote } : {}),
    },
  ]);
  factor.flag = ok ? "ok" : "mixed";
}

export function withholdFailedProse(message: {
  content: string;
  hiddenFromLawyer?: boolean;
}): void {
  message.content = REJECTED_PROSE_MARKER;
  message.hiddenFromLawyer = true;
}

/**
 * A prose claim is not evidence. Agreement leaves the grounded reading.
 * A different id conflicts and stays reversible via priorOutcomes.
 */
export function fuseProposal(
  state: FactorState,
  anchor: string,
  kind: FactorKind,
  outcomeId: string,
): void {
  const id = outcomeId.trim();
  if (!id) {
    return;
  }
  const factor = ensureFactor(state, anchor, kind);
  factor.kind = kind;
  const grounded = factor.outcomes.filter(
    (outcome) => outcome.grounded === true && outcome.mass > 0,
  );
  if (grounded.some((outcome) => outcome.id === id)) {
    return;
  }
  if (!factor.priorOutcomes) {
    factor.priorOutcomes = factor.outcomes.map((outcome) => ({ ...outcome }));
  }
  factor.proposalId = id;
  if (grounded.length === 0) {
    factor.outcomes = normalizeOutcomes([{ id, mass: 1, grounded: false }]);
    factor.flag = "mixed";
    return;
  }
  factor.flag = "conflict";
}

/** Undo proposals on the named anchors, or on every open proposal, plus one hop. */
export function revertProposals(state: FactorState, named: readonly string[]): string[] {
  const seeds = named.map((anchor) => anchor.trim()).filter(Boolean);
  const open = state.factors.filter((factor) => factor.proposalId).map((factor) => factor.anchor);
  const base = seeds.length > 0 ? seeds : open;
  if (base.length === 0) {
    return [];
  }
  const cone = lightConeAnchors(state, base);
  for (const anchor of cone) {
    const factor = state.factors.find((item) => item.anchor === anchor);
    if (!factor?.proposalId && !factor?.priorOutcomes) {
      continue;
    }
    if (factor.priorOutcomes) {
      factor.outcomes = factor.priorOutcomes.map((outcome) => ({ ...outcome }));
    }
    factor.priorOutcomes = undefined;
    factor.proposalId = undefined;
    const reading = projectReading(factor.outcomes);
    factor.flag = reading.kind === "definite" ? "ok" : "mixed";
  }
  return cone;
}

export function recordSurgicalAnchor(state: FactorState, anchor: string): void {
  recordSurgicalAnchors(state, [anchor]);
}

export function recordSurgicalAnchors(state: FactorState, anchors: readonly string[]): void {
  const next = anchors.map((anchor) => anchor.trim()).filter(Boolean);
  if (next.length === 0) {
    return;
  }
  state.lastSurgicalAnchors = [...new Set(next)];
}

export function reconcileSurgicalEditsWithPatches(
  state: FactorState | undefined,
  edits: unknown,
): unknown {
  if (!state?.pendingPatches?.length || !Array.isArray(edits)) {
    return edits;
  }
  return edits.map((edit) => {
    if (!edit || typeof edit !== "object") {
      return edit;
    }
    const find = (edit as { find?: unknown }).find;
    if (typeof find !== "string") {
      return edit;
    }
    const patch = state.pendingPatches?.find((item) => item.find === find);
    if (!patch) {
      return edit;
    }
    return { ...edit, replace: patch.replace };
  });
}

export function mapEditsToFactorAnchors(state: FactorState | undefined, edits: unknown): string[] {
  if (!state || !Array.isArray(edits)) {
    return [];
  }
  const found = new Set<string>();
  for (const edit of edits) {
    if (!edit || typeof edit !== "object") {
      continue;
    }
    const row = edit as { find?: unknown; replace?: unknown };
    const find = typeof row.find === "string" ? row.find : "";
    const replace = typeof row.replace === "string" ? row.replace : "";
    for (const anchor of mapTextToFactorAnchors(state, `${find}\n${replace}`)) {
      found.add(anchor);
    }
  }
  return [...found];
}

export function surgicalPayloadOutsideLightCone(
  cone: readonly string[],
  params: Record<string, unknown>,
  state?: FactorState,
): boolean {
  if (cone.length === 0) {
    return false;
  }
  const factorCone = cone.filter(isFactorAnchor);
  const mapped = mapEditsToFactorAnchors(state, params.edits);
  if (factorCone.length > 0 && Array.isArray(params.edits) && params.edits.length > 0) {
    if (mapped.some((anchor) => !factorCone.includes(anchor))) {
      return true;
    }
    return mapped.length === 0;
  }
  const blob = JSON.stringify(params);
  return !cone.some((anchor) => anchor && blob.includes(anchor));
}

export function selectInverseEditsForCone(
  state: FactorState,
  cone: readonly string[],
): { apply: InverseEdit[]; keep: InverseEdit[] } {
  const edits = state.inverseEdits ?? [];
  const factorCone = cone.filter(isFactorAnchor);
  if (factorCone.length === 0) {
    return { apply: [...edits], keep: [] };
  }
  const apply: InverseEdit[] = [];
  const keep: InverseEdit[] = [];
  for (const edit of edits) {
    const anchors =
      edit.anchors && edit.anchors.length > 0
        ? edit.anchors
        : mapTextToFactorAnchors(state, `${edit.find}\n${edit.replace}`);
    if (anchors.some((anchor) => factorCone.includes(anchor))) {
      apply.push(edit);
    } else {
      keep.push(edit);
    }
  }
  return { apply, keep };
}

export function selectSkeleton(input: {
  revisingDocument?: boolean;
  templateId?: string;
}): SkeletonChoice {
  if (input.revisingDocument) {
    return { kind: "document" };
  }
  if (input.templateId?.trim()) {
    return { kind: "template" };
  }
  return { kind: "free", header: FREE_SKELETON_HEADER };
}

const KNOWN_TEMPLATE_PREFIX = /^(word|ppt|upload)\//;

/** Catalog hit only. Unknown ids fall through to a free skeleton. */
export function resolveKnownTemplateId(raw: string | undefined): string | undefined {
  const id = raw?.trim();
  if (!id) {
    return undefined;
  }
  if (id === "complaint" || id.includes("complaint-master")) {
    return "complaint";
  }
  if (KNOWN_TEMPLATE_PREFIX.test(id)) {
    return id;
  }
  return undefined;
}

/** Keyword routing is not a template chooser. Models propose templateId. */
export function templateIdForInstruction(_instruction: string): string | undefined {
  return undefined;
}

export function instructionRequestsFreeDraft(instruction: string): boolean {
  return /起草|写一份|写个备忘|备忘录|意见书/.test(instruction);
}

/** Step cap applies only when binding a new fact slot, not when recording a repair. */
export function adiabaticMaySample(step: number, bindingNewSlot: boolean): boolean {
  if (!bindingNewSlot) {
    return true;
  }
  return step < ADIABATIC_MAX_STEPS;
}

/**
 * Amounts written in the lawyer's materials become grounded factors before sampling.
 * The model still chooses the words. A later draft cannot drop the span.
 */
export function ingestMaterialAmounts(state: FactorState, text: string): void {
  for (const amount of collectStatedAmounts(text).slice(0, STATED_AMOUNT_CAP)) {
    upsertOutcome(
      state,
      `${STATED_AMOUNT_PREFIX}${amount.key}`,
      "amount",
      amount.raw,
      true,
      amount.span,
    );
  }
}

export function bindAdiabaticSlot(state: FactorState): boolean {
  if (!adiabaticMaySample(state.adiabaticStep, true)) {
    return false;
  }
  state.adiabaticStep += 1;
  return true;
}

export function ingestToolResult(state: FactorState, toolName: string, data: unknown): FactorState {
  const record = asRecord(data);
  if (!record) {
    return state;
  }
  if (toolName === "calculate") {
    const op = typeof record.op === "string" && record.op.trim() ? record.op.trim() : "value";
    const value = record.value;
    if (typeof value === "number" || (typeof value === "string" && value.trim())) {
      const text = String(value).trim();
      const anchor = `amount:${op}`;
      const existing = state.calculatedSlots.find((slot) => slot.anchor === anchor);
      if (existing) {
        existing.value = text;
      } else {
        state.calculatedSlots.push({ anchor, value: text });
      }
      upsertOutcome(state, anchor, "amount", text, true);
      bindListedAnchors(state, anchor, record);
    }
  }
  if (toolName === "draft_worker") {
    ingestWorkerRecord(state, record);
  }
  ingestDraftFields(state, record);
  rememberCitationSpans(state, record);
  if (SOURCE_TOOLS.has(toolName)) {
    const demo = record.demoCorpus === true;
    for (const id of stringList(record.sourceIds)) {
      pushUnique(state.sourcePack, id);
      if (demo) {
        pushUnique(state.demoCorpusIds, id);
      }
      const quote = spanTextForSource(state, id, record);
      const covered = Boolean(quote);
      upsertOutcome(state, `citation:${id}`, "citation", demo ? "demo" : "live", covered, quote);
      bindListedAnchors(state, `citation:${id}`, record);
    }
    bindCitationsToSoleClause(state, stringList(record.sourceIds));
  }
  const code = typeof record.code === "string" ? record.code : "";
  if (XML_QA_CODES.has(code)) {
    pushUnique(state.redlineFailures, code);
    upsertOutcome(state, `redline:${code}`, "redline", code, true);
  }
  linkDefinedTermsToSlots(state);
  const templateId =
    (typeof record.templateId === "string" && record.templateId) ||
    (typeof record.template_id === "string" && record.template_id) ||
    "";
  if (templateId.trim()) {
    rememberBuiltinTemplateSkeleton(state, templateId.trim());
  }
  const documentXml = typeof record.documentXml === "string" ? record.documentXml : "";
  if (documentXml.includes("<w:p")) {
    rememberOoxmlSkeleton(state, documentXml);
  }
  capState(state);
  commitPassedSkeleton(state);
  return state;
}

export function applyProseSyndrome(
  state: FactorState | undefined,
  prose: string,
): ProseSyndromeDecision {
  if (!state || !prose.trim()) {
    return { action: "none" };
  }
  absorbProseProposals(state, prose);
  rememberJudgments(state, prose);
  return { action: "none" };
}

export function ingestDraftBody(state: FactorState | undefined, text: string): void {
  if (!state || !text.trim()) {
    return;
  }
  absorbProseProposals(state, text);
  rememberDocumentRoles(state, text);
}

export function consumeRedlineRepair(state: FactorState | undefined): {
  note?: string;
  pending?: string;
} {
  if (!state) {
    return {};
  }
  const code = state.redlineFailures[0];
  if (!code) {
    return {};
  }
  state.redlineFailures = state.redlineFailures.filter((item) => item !== code);
  const decision = advanceHit(state, { stabilizer: "S3", anchor: `redline:${code}` });
  if (decision.action === "bounce") {
    return { note: decision.note };
  }
  if (decision.action === "deliver") {
    return { pending: decision.pending };
  }
  return {};
}

export function fuseSharedAnchorLines(
  rows: readonly {
    anchor?: string;
    conclusion?: string;
    outcomeId?: string;
    span?: string;
  }[],
): string[] {
  type Item = {
    id: string;
    label: string;
    spanned: boolean;
    hasNodeId: boolean;
    spans: string[];
    conflict: boolean;
  };
  const groups = new Map<string, { items: Item[]; rows: number }>();
  for (const row of rows) {
    const anchor = row.anchor?.trim() ?? "";
    const conclusion = row.conclusion?.replace(/\s+/g, " ").trim() ?? "";
    const outcomeId = row.outcomeId?.trim() ?? "";
    const hasNodeId = outcomeId.length > 0;
    if (!anchor || (!hasNodeId && !conclusion)) {
      continue;
    }
    const fusionId = hasNodeId ? outcomeId : `__label:${conclusion}`;
    const span = row.span?.trim() ?? "";
    const spanned = hasNodeId && spanAttestsOutcome(span, outcomeId);
    const group = groups.get(anchor) ?? { items: [], rows: 0 };
    group.rows += 1;
    const existing = group.items.find((item) => item.id === fusionId);
    if (existing) {
      if (span && existing.spans.some((prev) => spansContradict(prev, span))) {
        existing.conflict = true;
      }
      if (span) {
        existing.spans.push(span);
      }
      existing.spanned = existing.spanned && spanned;
    } else {
      group.items.push({
        id: fusionId,
        label: conclusion || outcomeId,
        spanned,
        hasNodeId,
        spans: span ? [span] : [],
        conflict: false,
      });
    }
    groups.set(anchor, group);
  }
  const lines: string[] = [];
  for (const [anchor, group] of groups) {
    if (group.rows < 2) {
      continue;
    }
    const items = group.items;
    if (items.length < 2) {
      const only = items[0];
      if (!only) {
        continue;
      }
      const shown = only.conflict ? only.label : only.hasNodeId ? only.id : only.label;
      lines.push(
        only.hasNodeId && only.spanned && !only.conflict
          ? `共享锚 ${anchor}：${only.id}`
          : `【待核实】${anchor}：${shown}`,
      );
      continue;
    }
    if (items.some((item) => item.conflict)) {
      lines.push(`【待核实】${anchor}：${items.map((item) => item.label).join("；")}`);
      continue;
    }
    if (items.some((item) => !item.hasNodeId)) {
      const labels = items.map((item) => item.label);
      const clash = labels.some((left, index) =>
        labels.slice(index + 1).some((right) => spansContradict(left, right)),
      );
      if (clash) {
        lines.push(`【待核实】${anchor}：${labels.join("；")}`);
      }
      continue;
    }
    const labels = items.map((item) => item.label);
    const merged = items.slice(1).reduce<{ outcomes: FactorOutcome[]; conflict: boolean }>(
      (acc, item) => {
        if (acc.conflict) {
          return acc;
        }
        return productMerge(acc.outcomes, [{ id: item.id, mass: 1, grounded: item.spanned }]);
      },
      {
        outcomes: [{ id: items[0]?.id ?? "", mass: 1, grounded: items[0]?.spanned }],
        conflict: false,
      },
    );
    if (merged.conflict) {
      lines.push(`【待核实】${anchor}：${labels.join("；")}`);
      continue;
    }
    const reading = projectReading(merged.outcomes);
    if (reading.kind === "definite") {
      lines.push(`共享锚 ${anchor}：${reading.id}`);
    } else {
      lines.push(`【待核实】${anchor}：${reading.ids.join("；") || labels.join("；")}`);
    }
  }
  return lines;
}

/** Short span, full sentence, or a term sentence that still needs calculate. */
export function fieldShapeHint(anchor: string): string | undefined {
  if (/当事人|签约主体|合同名称|管辖/.test(anchor)) {
    return "短片段";
  }
  if (/到期日/.test(anchor)) {
    return "整句，再用 calculate";
  }
  if (/价格限制|最低承诺|数量限制|无限责任|第三方受益|关联方许可|最惠国/.test(anchor)) {
    return "整句";
  }
  return undefined;
}

export function spanFitsFieldShape(anchor: string, text: string): boolean {
  const hint = fieldShapeHint(anchor);
  if (!hint) {
    return true;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (hint === "短片段") {
    return trimmed.length <= 48 && !/[。！？；]/.test(trimmed);
  }
  return /[。；]/.test(trimmed);
}

function otherOutcomeIds(outcomes: readonly FactorOutcome[], chosen: string): string[] {
  const ids: string[] = [];
  for (const outcome of normalizeOutcomes(outcomes)) {
    if (outcome.id !== chosen && !ids.includes(outcome.id)) {
      ids.push(outcome.id);
    }
  }
  return ids;
}

function renderDefiniteBody(factor: Factor, chosen: string): string {
  const others = otherOutcomeIds(factor.outcomes, chosen);
  const hint = fieldShapeHint(factor.anchor);
  if (hint && !spanFitsFieldShape(factor.anchor, chosen)) {
    const pending = [chosen, ...others];
    return `未核：${pending.join("；")}（要${hint}）`;
  }
  if (others.length === 0) {
    return chosen;
  }
  return `${chosen}；未核：${others.join("；")}`;
}

function renderFactorBody(factor: Factor, qhat?: number): string {
  if (factor.anchor.startsWith(STATED_AMOUNT_PREFIX)) {
    const grounded = factor.outcomes.find((outcome) => outcome.grounded === true && outcome.id);
    const id = grounded?.id ?? factor.anchor.slice(STATED_AMOUNT_PREFIX.length);
    const span = grounded?.span?.trim();
    const base = span ? `${id}（材料原句：${span}）` : id;
    if (factor.flag === "conflict" && factor.proposalId) {
      return `${base}。稿里写成了${factor.proposalId}，材料里的数仍以这里为准。`;
    }
    return base;
  }
  if ((factor.flag === "conflict" || factor.flag === "uncorrectable") && factor.proposalId) {
    const grounded = projectReadingGated(factor.outcomes, qhat);
    const left = grounded.kind === "definite" ? grounded.id : grounded.ids.join("；");
    const sides = [left, factor.proposalId].filter(Boolean);
    return `【待核实】${sides.join("；") || "未定"}`;
  }
  const reading = projectReadingGated(factor.outcomes, qhat);
  if (reading.kind !== "definite") {
    return `【待核实】${reading.ids.join("；") || "未定"}`;
  }
  return renderDefiniteBody(factor, reading.id);
}

function absorbProseProposals(state: FactorState, prose: string): void {
  absorbBracketCitations(state, prose);
  absorbStatuteCitations(state, prose);
  absorbMoneyProposals(state, prose);
  noteStatedAmountDrift(state, prose);
  absorbNegationCollisions(state, prose);
  const foreignRole = foreignRoleWord(state, prose);
  if (foreignRole) {
    fuseProposal(state, `party:${foreignRole}`, "clause", foreignRole);
  }
}

function isStatuteToken(token: string): boolean {
  return /《[^》]+》|第[0-9一二三四五六七八九十百千零〇两]+\s*条|法释〔|指导性?案例/.test(token);
}

/** Local polarity collision: two commuting signs on one span, not legal style. */
function absorbNegationCollisions(state: FactorState, prose: string): void {
  const tokens = prose.match(/方可不得|不得视为已经|不得不得/g) ?? [];
  for (const token of new Set(tokens)) {
    fuseProposal(state, `negation:${token}`, "clause", token);
  }
}

const STATUTE_CITE_RE =
  /《[^《》\n]{1,48}》(?:\s*第\s*(?:\d+|[一二三四五六七八九十百千零〇两]+)\s*条(?:之\d+)?(?:第[一二三四五六七八九十百千\d]+款)?)?|法释〔\d{4}〕\d+号|（\d{4}）[^）\n]{2,24}号|指导性?案例\s*\d{1,4}\s*号/g;

function absorbBracketCitations(state: FactorState, prose: string): void {
  const claimed = [...prose.matchAll(/〔([^〕]{1,80})〕/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  for (const id of claimed) {
    const anchor = `citation:${id}`;
    if (!state.sourcePack.includes(id)) {
      fuseProposal(state, anchor, "citation", id);
      continue;
    }
    if (
      state.demoCorpusIds.includes(id) &&
      sentenceTreatsAsAuthority(prose, id) &&
      !prose.includes("演示语料")
    ) {
      fuseProposal(state, anchor, "citation", "live");
    }
  }
}

function absorbStatuteCitations(state: FactorState, prose: string): void {
  const retrieved = state.sourcePack.length > 0 || (state.citationSpans ?? []).length > 0;
  if (!retrieved) {
    return;
  }
  STATUTE_CITE_RE.lastIndex = 0;
  for (const match of prose.matchAll(STATUTE_CITE_RE)) {
    const token = (match[0] ?? "").replace(/\s+/g, " ").trim();
    if (!token) {
      continue;
    }
    const grounded = statuteMentionGrounded(state, token);
    if (grounded === "live") {
      continue;
    }
    if (
      grounded === "demo" &&
      sentenceTreatsAsAuthority(prose, token) &&
      !sentenceHasDemoLabel(prose, token)
    ) {
      fuseProposal(state, `citation:${token}`, "citation", "live");
      continue;
    }
    if (grounded === "missing") {
      fuseProposal(state, `citation:${token}`, "citation", token);
    }
  }
}

function sentenceTreatsAsAuthority(prose: string, token: string): boolean {
  const sentence = prose
    .split(/[。！？\n]/)
    .find((part) => part.includes(token) || part.includes(token.replace(/\s+/g, "")));
  const scope = sentence ?? prose;
  return /权威|现行法|现行有效|依法/.test(scope);
}

function sentenceHasDemoLabel(prose: string, token: string): boolean {
  const sentence = prose.split(/[。！？\n]/).find((part) => part.includes(token));
  return (sentence ?? prose).includes("演示语料");
}

function statuteMentionGrounded(state: FactorState, token: string): "live" | "demo" | "missing" {
  const compact = token.replace(/\s+/g, "");
  if (state.sourcePack.some((id) => compact.includes(id) || id.includes(compact))) {
    return state.demoCorpusIds.some((id) => compact.includes(id)) ? "demo" : "live";
  }
  const name = /《([^》]{1,48})》/.exec(token)?.[1]?.replace(/\s+/g, "") ?? "";
  const article = articleNumber(token);
  for (const span of state.citationSpans ?? []) {
    const hay = `${span.id}${span.text}`.replace(/\s+/g, "");
    const nameHit = name.length > 0 && hay.includes(name.replace(/^中华人民共和国/, ""));
    if (!nameHit && !hay.includes(compact)) {
      continue;
    }
    const spanArticles = articleNumbers(span.text);
    if (article !== undefined && spanArticles.length > 0 && !spanArticles.includes(article)) {
      continue;
    }
    return (state.demoSpanIds ?? []).includes(span.id) ? "demo" : "live";
  }
  return "missing";
}

function articleNumber(token: string): number | undefined {
  const match = /第\s*(\d+|[一二三四五六七八九十百千零〇两]+)\s*条/.exec(token);
  return match?.[1] ? parseArticleToken(match[1]) : undefined;
}

function articleNumbers(text: string): number[] {
  return [...text.matchAll(/第\s*(\d+|[一二三四五六七八九十百千零〇两]+)\s*条/g)]
    .map((match) => parseArticleToken(match[1] ?? ""))
    .filter((value): value is number => value !== undefined);
}

function parseArticleToken(raw: string): number | undefined {
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  const map: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (raw === "十") {
    return 10;
  }
  const ten = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(raw);
  if (ten) {
    return (ten[1] ? (map[ten[1]] ?? 0) : 1) * 10 + (ten[2] ? (map[ten[2]] ?? 0) : 0);
  }
  const hundred =
    /^([一二三四五六七八九])百(?:零)?(?:([一二三四五六七八九])?十)?([一二三四五六七八九])?$/.exec(
      raw,
    );
  if (!hundred) {
    return undefined;
  }
  const head = (map[hundred[1] ?? ""] ?? 0) * 100;
  const tens = hundred[2] ? (map[hundred[2]] ?? 0) * 10 : raw.includes("十") ? 10 : 0;
  const ones = hundred[3] ? (map[hundred[3]] ?? 0) : 0;
  return head + tens + ones;
}

type StatedAmount = {
  key: string;
  raw: string;
  span: string;
  value: number;
  currency: "cny" | "usd";
};

function collectStatedAmounts(text: string): StatedAmount[] {
  const found: StatedAmount[] = [];
  const seen = new Set<string>();
  const patterns: Array<{ re: RegExp; currency: "cny" | "usd"; wan: boolean }> = [
    { re: /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*万\s*元/g, currency: "cny", wan: true },
    { re: /(\d+(?:\.\d+)?)\s*万(?!元)/g, currency: "cny", wan: true },
    { re: /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*美元/g, currency: "usd", wan: false },
    { re: /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*元/g, currency: "cny", wan: false },
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.re)) {
      const index = match.index ?? 0;
      if (/第\s*$/.test(text.slice(Math.max(0, index - 2), index))) {
        continue;
      }
      const digits = Number((match[1] ?? "").replace(/,/g, ""));
      if (!Number.isFinite(digits) || digits <= 0) {
        continue;
      }
      const value = pattern.wan ? Math.round(digits * 10000) : Math.round(digits);
      const key = pattern.currency === "usd" ? `usd:${value}` : String(value);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const raw = (match[0] ?? "").replace(/\s+/g, "");
      found.push({
        key,
        raw,
        span: sentenceAround(text, index, index + (match[0]?.length ?? 0)),
        value,
        currency: pattern.currency,
      });
      if (found.length >= STATED_AMOUNT_CAP) {
        return found;
      }
    }
  }
  return found;
}

function sentenceAround(text: string, start: number, end: number): string {
  const left = Math.max(
    text.lastIndexOf("\n", start),
    text.lastIndexOf("。", start),
    text.lastIndexOf("！", start),
    text.lastIndexOf("？", start),
  );
  let right = text.length;
  for (const mark of ["\n", "。", "！", "？"]) {
    const at = text.indexOf(mark, end);
    if (at >= 0 && at < right) {
      right = at;
    }
  }
  const from = left >= 0 ? left + 1 : Math.max(0, start - 40);
  return text.slice(from, right).replace(/\s+/g, " ").trim().slice(0, 160);
}

function spanHooks(span: string, raw: string): string[] {
  const rest = span.split(raw).join("");
  const runs = rest.match(/[\u4e00-\u9fff]{4,}/g) ?? [];
  const hooks = new Set<string>();
  for (const run of runs) {
    for (let i = 0; i <= run.length - 4; i += 1) {
      hooks.add(run.slice(i, i + 4));
    }
  }
  return [...hooks];
}

function proseHasStatedAmount(prose: string, amount: StatedAmount): boolean {
  if (prose.includes(amount.raw)) {
    return true;
  }
  return collectStatedAmounts(prose).some((item) => item.key === amount.key);
}

/** A draft that blanks or replaces a material amount does not erase that span. */
function noteStatedAmountDrift(state: FactorState, prose: string): void {
  const sentences = prose
    .split(/[。！？\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const factor of state.factors) {
    if (!factor.anchor.startsWith(STATED_AMOUNT_PREFIX)) {
      continue;
    }
    const grounded = factor.outcomes.find((outcome) => outcome.grounded === true && outcome.span);
    if (!grounded?.span) {
      continue;
    }
    const key = factor.anchor.slice(STATED_AMOUNT_PREFIX.length);
    const amount: StatedAmount = {
      key,
      raw: grounded.id,
      span: grounded.span,
      value: 0,
      currency: key.startsWith("usd:") ? "usd" : "cny",
    };
    if (proseHasStatedAmount(prose, amount)) {
      if (factor.flag === "conflict") {
        factor.proposalId = undefined;
        factor.flag = "ok";
      }
      continue;
    }
    const hooks = spanHooks(grounded.span, grounded.id);
    if (hooks.length === 0) {
      continue;
    }
    for (const sentence of sentences) {
      if (!hooks.some((hook) => sentence.includes(hook))) {
        continue;
      }
      const blank = /待核实|＿{2,}|_{4,}/.test(sentence);
      const replaced = collectStatedAmounts(sentence).some((item) => item.key !== key);
      if (!blank && !replaced) {
        continue;
      }
      const foreign = collectStatedAmounts(sentence).find((item) => item.key !== key);
      factor.proposalId = blank ? "待核实" : (foreign?.raw ?? "其他数额");
      factor.flag = "conflict";
      break;
    }
  }
}

function absorbMoneyProposals(state: FactorState, prose: string): void {
  const sentences = prose
    .split(/[。！？\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const slot of state.calculatedSlots) {
    const expected = slotNumber(slot.value);
    const hint = slotHint(slot.anchor);
    const relevant = sentences.filter((sentence) => hint.test(sentence));
    const figures = relevant.flatMap((sentence) => moneyFigures(sentence));
    const factor = state.factors.find((item) => item.anchor === slot.anchor);
    const explained =
      relevant.some((sentence) => sentence.includes(slot.value)) ||
      (expected !== undefined && figures.some((figure) => figure.value === expected));
    if (explained) {
      if (factor?.flag === "conflict") {
        factor.proposalId = undefined;
        factor.flag = "ok";
      }
      continue;
    }
    const foreign = figures.find((figure) => expected === undefined || figure.value !== expected);
    if (!foreign) {
      continue;
    }
    const proposal = foreign.raw.includes(String(foreign.value))
      ? String(foreign.value)
      : foreign.raw;
    fuseProposal(state, slot.anchor, "amount", proposal);
  }
}

function slotHint(anchor: string): RegExp {
  const op = anchor.replace(/^amount:/, "");
  const known: Record<string, string> = {
    economic_compensation: "经济补偿|补偿金|补偿为|补偿应",
    interest: "利息",
    wage: "工资|月薪",
    litigation_fee: "诉讼费|受理费|保全费",
    liquidated_damages: "违约金|损害赔偿|迟延履行金",
  };
  return new RegExp(known[op] ?? op.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/** Replace the proposal only on the slot's sentences. Other amounts stay in the prefix. */
function redactAmountProposal(
  text: string,
  proposal: string,
  replacement: string,
  hint: RegExp,
): string {
  const next = text.replace(/[^\n。！？]+(?:[。！？])?/g, (sentence) => {
    if (!hint.test(sentence) || !sentence.includes(proposal)) {
      return sentence;
    }
    return sentence.split(proposal).join(replacement);
  });
  const noteAt = next.search(/【机械核定】|【引擎核定】/);
  if (noteAt < 0) {
    return next;
  }
  return next.slice(0, noteAt) + redactProposalInNote(next.slice(noteAt), proposal, replacement);
}

function redactProposalInNote(note: string, proposal: string, replacement: string): string {
  if (replacement && note.includes(replacement)) {
    return note
      .split(proposal)
      .join("")
      .replace(/；{2,}/g, "；")
      .replace(/：；/g, "：")
      .replace(/；(?=\n|$)/g, "");
  }
  return note.split(proposal).join(replacement);
}

/** Mixed polarity stays mixed. Do not argmax back to either reading. */
function unbindPolarityCollision(text: string, token: string): string {
  if (!token || !text.includes(token)) {
    return text;
  }
  return text.split(token).join("【待核实】");
}

function slotNumber(value: string): number | undefined {
  const cleaned = value.replace(/,/g, "").replace(/元/g, "").trim();
  const wan = /^(\d+(?:\.\d+)?)万$/.exec(cleaned);
  if (wan?.[1]) {
    return Math.round(Number(wan[1]) * 10000);
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

function moneyFigures(prose: string): Array<{ raw: string; value: number }> {
  const figures: Array<{ raw: string; value: number }> = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(万)?\s*元/g;
  for (const match of prose.matchAll(re)) {
    const digits = (match[1] ?? "").replace(/,/g, "");
    const parsed = Number(digits);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    const value = match[2] ? Math.round(parsed * 10000) : Math.round(parsed);
    figures.push({ raw: (match[0] ?? "").replace(/\s+/g, ""), value });
  }
  return figures;
}

function advanceHit(state: FactorState, hit: SyndromeHit): ProseSyndromeDecision {
  const factor = ensureFactor(state, hit.anchor, kindFor(hit));
  const capped = factor.repairs >= MAX_FACTOR_REPAIRS;
  if (capped) {
    factor.flag = "uncorrectable";
    return { action: "deliver", pending: `【待核实】${hit.anchor}` };
  }
  factor.repairs += 1;
  return {
    action: "bounce",
    note: `${FACTOR_REPAIR_MARKER}只重做这一处：${hit.anchor}。不要改其他锚。`,
  };
}

const ROLE_SURFACE: Record<string, readonly string[]> = {
  发包人: ["发包方"],
  承包人: ["承包方"],
  出租人: ["出租方"],
  承租人: ["承租方"],
};

function textSupportsRole(text: string, word: string): boolean {
  if (text.includes(word)) {
    return true;
  }
  return (ROLE_SURFACE[word] ?? []).some((alias) => text.includes(alias));
}

function isOpenPartyProposal(state: FactorState, word: string): boolean {
  const factor = state.factors.find((item) => item.anchor === `party:${word}`);
  return Boolean(
    factor &&
    (factor.flag === "mixed" || factor.flag === "conflict" || factor.flag === "uncorrectable"),
  );
}

function rememberDocumentRoles(state: FactorState, text: string): void {
  state.documentRoles = state.documentRoles ?? [];
  for (const word of CONTRACT_ROLE_WORDS) {
    if (!textSupportsRole(text, word) || state.documentRoles.includes(word)) {
      continue;
    }
    if (isOpenPartyProposal(state, word)) {
      continue;
    }
    state.documentRoles.push(word);
  }
}

function knownTerms(state: FactorState): Set<string> {
  return new Set([
    ...(state.definedTerms ?? []),
    ...Object.keys(state.termAliases ?? {}),
    ...(state.documentRoles ?? []),
  ]);
}

/** Record explicit definitions from the document. No definition, no party check. */
export function ingestDefinedTerms(state: FactorState, text: string): void {
  rememberDocumentRoles(state, text);
  state.definedTerms = state.definedTerms ?? [];
  state.termAliases = state.termAliases ?? {};
  for (const term of extractDefinedTermsFromText(text)) {
    const outcomeId = term.definition?.trim() || term.term;
    const span = [term.term, term.definition].filter((part) => part?.trim()).join("：");
    recordReading(state, `defined:${term.term}`, "clause", outcomeId, true, span || undefined);
    if (!state.definedTerms.includes(term.term)) {
      state.definedTerms.push(term.term);
    }
    for (const alias of term.aliases) {
      const clean = alias.trim();
      if (!clean) {
        continue;
      }
      state.termAliases[clean] = term.term;
      const aliasSpan = [clean, term.term, term.definition]
        .filter((part) => part?.trim())
        .join("：");
      recordReading(state, `defined:${clean}`, "clause", term.term, true, aliasSpan);
      linkNeighbors(state, `defined:${term.term}`, `defined:${clean}`);
    }
  }
  refreshDefinitionCycles(state);
  linkDefinedTermsToSlots(state);
}

/** A structural role word that is not already a defined term or alias. */
export function foreignRoleWord(state: FactorState, prose: string): string | undefined {
  const known = knownTerms(state);
  if (known.size === 0) {
    return undefined;
  }
  for (const word of CONTRACT_ROLE_WORDS) {
    if (!prose.includes(word) || known.has(word)) {
      continue;
    }
    return word;
  }
  return undefined;
}

export function editIntroducesForeignRole(
  state: FactorState | undefined,
  edits: unknown,
): string | undefined {
  if (!state || !Array.isArray(edits)) {
    return undefined;
  }
  const replacements: string[] = [];
  for (const edit of edits) {
    if (!edit || typeof edit !== "object") {
      continue;
    }
    const replace = (edit as { replace?: unknown }).replace;
    if (typeof replace === "string") {
      replacements.push(replace);
    }
  }
  return foreignRoleWord(state, replacements.join("\n"));
}

export function recordInverseEdits(
  state: FactorState,
  edits: readonly { find?: string; replace?: string; count?: number }[],
  sourceText?: string,
  mappingEdits?: unknown,
): void {
  state.inverseEdits = state.inverseEdits ?? [];
  const shared = mappingEdits !== undefined ? mapEditsToFactorAnchors(state, mappingEdits) : [];
  for (const edit of edits) {
    const original = edit.find?.trim() ?? "";
    const written = edit.replace?.trim() ?? "";
    if (!original || !written || original === written) {
      continue;
    }
    const counted =
      edit.count ?? (sourceText && original ? sourceText.split(original).length - 1 : undefined);
    const anchors = [
      ...new Set([
        ...mapEditsToFactorAnchors(state, [{ find: original, replace: written }]),
        ...shared,
      ]),
    ];
    state.inverseEdits.push({
      find: written,
      replace: original,
      ...(counted && counted > 0 ? { count: counted } : {}),
      ...(anchors.length > 0 ? { anchors } : {}),
    });
  }
  if (state.inverseEdits.length > MAX_FACTORS) {
    state.inverseEdits.splice(0, state.inverseEdits.length - MAX_FACTORS);
  }
}

export function recordBodySnapshot(
  state: FactorState,
  taskId: string,
  bodies: readonly string[],
): void {
  const id = taskId.trim();
  if (!id) {
    return;
  }
  state.bodySnapshots = state.bodySnapshots ?? [];
  state.bodySnapshots.push({ taskId: id, bodies: bodies.map((body) => body) });
  const latest = new Map<string, { taskId: string; bodies: string[] }>();
  for (const shot of state.bodySnapshots) {
    latest.delete(shot.taskId);
    latest.set(shot.taskId, shot);
  }
  const collapsed = [...latest.values()];
  state.bodySnapshots = collapsed.length > 8 ? collapsed.slice(collapsed.length - 8) : collapsed;
}

/** Latest pre-edit bodies for this draft. Removed so a second correction does not restore twice. */
export function takeBodySnapshot(state: FactorState, taskId: string): string[] | undefined {
  const list = state.bodySnapshots ?? [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.taskId === taskId) {
      const found = list[index];
      list.splice(index, 1);
      return found?.bodies;
    }
  }
  return undefined;
}

export function restoreBodies(current: readonly string[], snapshot: readonly string[]): string[] {
  return current.map((body, index) => snapshot[index] ?? body);
}

/** Apply stored inverse pairs. Unknown multiplicity stays unique-only. */
export function applyInverseEdits(
  text: string,
  edits: readonly { find: string; replace: string; count?: number }[],
): { text: string; applied: number } {
  let out = text;
  let applied = 0;
  for (const edit of edits) {
    if (!edit.find || !out.includes(edit.find)) {
      continue;
    }
    const hits = out.split(edit.find).length - 1;
    const expected = edit.count && edit.count > 0 ? edit.count : 1;
    if (hits !== expected) {
      continue;
    }
    if (expected === 1) {
      out = out.replace(edit.find, edit.replace);
      applied += 1;
      continue;
    }
    out = out.split(edit.find).join(edit.replace);
    applied += hits;
  }
  return { text: out, applied };
}

function mapTextToFactorAnchors(state: FactorState, text: string): string[] {
  const blob = text.replace(/\s+/g, "");
  if (!blob) {
    return [];
  }
  const hits: string[] = [];
  for (const factor of state.factors) {
    if (factorTokens(factor).some((token) => blob.includes(token.replace(/\s+/g, "")))) {
      hits.push(factor.anchor);
    }
  }
  return hits;
}

function factorTokens(factor: Factor): string[] {
  const tokens: string[] = [];
  const local = factor.anchor.replace(FACTOR_ANCHOR_RE, "").trim();
  if (local.length >= 2) {
    tokens.push(local);
  }
  for (const outcome of factor.outcomes) {
    const id = outcome.id.trim();
    if (id.length >= 2) {
      tokens.push(id);
    }
    const span = outcome.span?.trim() ?? "";
    if (span.length >= 2) {
      tokens.push(span);
    }
  }
  return tokens;
}

function kindFor(hit: SyndromeHit): FactorKind {
  if (hit.stabilizer === "S2") {
    return "amount";
  }
  if (hit.stabilizer === "S3") {
    return "redline";
  }
  if (hit.stabilizer === "S4") {
    return "clause";
  }
  return "citation";
}

function ensureFactor(state: FactorState, anchor: string, kind: FactorKind): Factor {
  const found = state.factors.find((factor) => factor.anchor === anchor);
  if (found) {
    return found;
  }
  const created: Factor = {
    anchor,
    kind,
    outcomes: [],
    repairs: 0,
    flag: "ok",
    neighbors: [],
  };
  state.factors.push(created);
  capState(state);
  return state.factors.find((factor) => factor.anchor === anchor) ?? created;
}

function upsertOutcome(
  state: FactorState,
  anchor: string,
  kind: FactorKind,
  outcomeId: string,
  grounded: boolean,
  span?: string,
): void {
  recordReading(state, anchor, kind, outcomeId, grounded, span);
}

/** Independent evidence: the quote must attest the node id, not merely be non-empty. */
export function spanAttestsOutcome(span: string, outcomeId: string): boolean {
  const quote = span.trim();
  const id = outcomeId.trim();
  if (!quote || !id) {
    return false;
  }
  if (quote.includes(id)) {
    return true;
  }
  const digits = id.replace(/[^\d]/g, "");
  if (digits.length >= 2 && quote.replace(/[^\d.,，]/g, "").includes(digits)) {
    return true;
  }
  // Citation readings use the ids "live" / "demo". A statute-shaped quote
  // attests those ids only. It does not attest an unrelated clause answer.
  if (
    (id === "live" || id === "demo") &&
    (/第[0-9０-９零一二三四五六七八九十百千两]+\s*条/.test(quote) || /《[^》]{2,40}》/.test(quote))
  ) {
    return true;
  }
  if (
    /^[A-Za-z][A-Za-z0-9_:-]*$/.test(id) &&
    (/[\u4e00-\u9fff]{4,}/.test(quote) ||
      /第[0-9０-９零一二三四五六七八九十百千两]+\s*条/.test(quote))
  ) {
    return true;
  }
  return false;
}

function spansContradict(left: string, right: string): boolean {
  const a = left.replace(/\s+/g, "");
  const b = right.replace(/\s+/g, "");
  if (!a || !b) {
    return false;
  }
  if (a.includes(b) || b.includes(a)) {
    return false;
  }
  const pairs: Array<[RegExp, RegExp]> = [
    [/有权/, /无权/],
    [/有权/, /不得/],
    [/可以/, /不得/],
    [/允许/, /禁止/],
    [/应当/, /不应/],
  ];
  for (const [pos, neg] of pairs) {
    if ((pos.test(a) && neg.test(b)) || (neg.test(a) && pos.test(b))) {
      return true;
    }
  }
  const aArts = articleNumbers(left);
  const bArts = articleNumbers(right);
  return aArts.length > 0 && bArts.length > 0 && aArts.every((n) => !bArts.includes(n));
}

function spanTextForSource(
  state: FactorState,
  sourceId: string,
  record: Record<string, unknown>,
): string | undefined {
  const id = sourceId.trim();
  if (!id) {
    return undefined;
  }
  const hits = collectHitSpans(record);
  const named = hits.find(
    (hit) => hit.text.trim() && (hit.id === id || hit.source === id || hit.title === id),
  );
  if (named?.text) {
    return named.text;
  }
  const sourceIds = stringList(record.sourceIds);
  if (sourceIds.length === 1 && sourceIds[0] === id) {
    const any = hits.find((hit) => hit.text.trim());
    if (any?.text) {
      return any.text;
    }
  }
  const stored = (state.citationSpans ?? []).find((span) => span.id === id && span.text.trim());
  return stored?.text;
}

function linkDefinedTermsToSlots(state: FactorState): void {
  const defined = state.factors.filter((factor) => factor.anchor.startsWith("defined:"));
  if (defined.length === 0) {
    return;
  }
  for (const slot of state.factors) {
    if (slot.kind !== "amount" && slot.kind !== "citation") {
      continue;
    }
    for (const def of defined) {
      linkNeighbors(state, def.anchor, slot.anchor);
    }
  }
}

/** A non-empty material quote is independent evidence only when it attests the node. */
function spanAccepted(state: FactorState, span: string, outcomeId = ""): boolean {
  if (outcomeId.trim()) {
    return spanAttestsOutcome(span, outcomeId);
  }
  return span.trim().length > 0;
}

function ingestWorkerRecord(state: FactorState, record: Record<string, unknown>): void {
  const anchor = typeof record.anchor === "string" ? record.anchor.trim() : "";
  const outcomeId = typeof record.outcomeId === "string" ? record.outcomeId.trim() : "";
  const span = typeof record.span === "string" ? record.span.trim() : "";
  const grounded = outcomeId.length > 0 && spanAttestsOutcome(span, outcomeId);
  if (anchor && outcomeId) {
    recordReading(state, anchor, "clause", outcomeId, grounded, span);
    bindListedAnchors(state, anchor, record);
  }
  const patches = Array.isArray(record.patches) ? record.patches : [];
  state.pendingPatches = state.pendingPatches ?? [];
  for (const raw of patches) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const row = raw as Record<string, unknown>;
    const find = typeof row.find === "string" ? row.find.trim() : "";
    const replace = typeof row.replace === "string" ? row.replace.trim() : "";
    const patchSpan = typeof row.span === "string" ? row.span.trim() : span;
    const patchAnchor = typeof row.anchor === "string" ? row.anchor.trim() : anchor;
    const patchOutcome = typeof row.outcomeId === "string" ? row.outcomeId.trim() : outcomeId;
    if (!find || !replace || !spanAccepted(state, patchSpan, patchOutcome)) {
      continue;
    }
    state.pendingPatches.push({
      ...(patchAnchor ? { anchor: patchAnchor } : {}),
      find,
      replace,
      ...(patchSpan ? { span: patchSpan } : {}),
    });
    if (patchAnchor && patchOutcome) {
      recordReading(state, patchAnchor, "clause", patchOutcome, true, patchSpan);
    }
  }
}

function ingestDraftFields(state: FactorState, record: Record<string, unknown>): void {
  const chunks: string[] = [];
  for (const key of ["draft", "result", "conclusion", "output"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      chunks.push(value);
    }
  }
  if (Array.isArray(record.sections)) {
    for (const section of record.sections) {
      if (!section || typeof section !== "object") {
        continue;
      }
      const body = (section as { body?: unknown; bodyPreview?: unknown }).body;
      const preview = (section as { bodyPreview?: unknown }).bodyPreview;
      if (typeof body === "string") {
        chunks.push(body);
      } else if (typeof preview === "string") {
        chunks.push(preview);
      }
    }
  }
  if (chunks.length > 0) {
    absorbProseProposals(state, chunks.join("\n"));
  }
}

/** One clause under review is this-turn; a retrieved article is its 1-hop, not a hub to every clause. */
function bindCitationsToSoleClause(state: FactorState, sourceIds: readonly string[]): void {
  if (sourceIds.length === 0) {
    return;
  }
  const clauses = state.factors.filter((factor) => factor.anchor.startsWith("clause:"));
  if (clauses.length !== 1 || !clauses[0]) {
    return;
  }
  for (const id of sourceIds) {
    linkNeighbors(state, `citation:${id}`, clauses[0].anchor);
  }
}

function bindListedAnchors(
  state: FactorState,
  anchor: string,
  record: Record<string, unknown>,
): void {
  const binds = stringList(record.binds);
  const clause = typeof record.clauseAnchor === "string" ? record.clauseAnchor.trim() : "";
  if (clause) {
    binds.push(clause);
  }
  for (const other of binds) {
    linkNeighbors(state, anchor, other);
  }
}

function capState(state: FactorState): void {
  if (state.factors.length > MAX_FACTORS) {
    state.factors.splice(0, state.factors.length - MAX_FACTORS);
  }
  if (state.sourcePack.length > MAX_FACTORS) {
    state.sourcePack.splice(0, state.sourcePack.length - MAX_FACTORS);
  }
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) {
    list.push(value);
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
