/**
 * Capture lawyer stance from accepted redlines (and adopted habit payloads).
 * Does not write LAWYER_PROFILE; redline accept is already an explicit lawyer click.
 */

import { randomUUID } from "node:crypto";
import {
  extractHabitsFromRedlines,
  loadWorkspaceRedlineFiles,
} from "../historical-scan/habit-extract.js";
import { mutateStanceItems } from "./store.js";
import type { StanceEvidenceEntry, StanceItem, StanceRedlineHunk, StanceSource } from "./types.js";

/** Duplicated from historical-scan/habit-extract — do not import (cycle risk). */
const CLAUSE_TYPES: Array<{ id: string; re: RegExp }> = [
  { id: "管辖", re: /管辖|争议解决|仲裁/ },
  { id: "违约金", re: /违约金/ },
  { id: "保密", re: /保密/ },
  { id: "赔偿", re: /赔偿|责任限制|责任上限/ },
  { id: "知识产权", re: /知识产权|许可使用/ },
  { id: "定金", re: /定金/ },
];

const HABIT_PAYLOAD_RE = /审查「([^」]+)」条款时，默认采用：(.+)/;

/**
 * 来源权重：redline 单案件一次接受（低）< revision_pack 律师显式总结（中）
 * < habit_adopt 跨案件统计后采纳（高）；manual 为手工/所内默认。
 */
export const STANCE_SOURCE_WEIGHT: Record<StanceSource, number> = {
  redline: 0.25,
  revision_pack: 0.4,
  habit_adopt: 0.5,
  manual: 0.45,
};

/** 证据账本派生置信度：概率和 1 − Π(1 − w)，天然有界且边际递减。 */
export function stanceConfidenceFromEvidence(evidence: StanceEvidenceEntry[]): number {
  let miss = 1;
  for (const entry of evidence) {
    miss *= 1 - (STANCE_SOURCE_WEIGHT[entry.source] ?? 0.2);
  }
  return Math.min(1, Math.round((1 - miss) * 10000) / 10000);
}

/** 在既有置信度（无账本存量的先验）上叠加一条新证据。 */
function combineStanceConfidence(prior: number, source: StanceSource): number {
  const w = STANCE_SOURCE_WEIGHT[source] ?? 0.2;
  const base = Number.isFinite(prior) ? Math.min(1, Math.max(0, prior)) : 0;
  return Math.min(1, Math.round((1 - (1 - base) * (1 - w)) * 10000) / 10000);
}

export function detectStanceClauseType(text: string): string | undefined {
  for (const row of CLAUSE_TYPES) {
    if (row.re.test(text)) {
      return row.id;
    }
  }
  return undefined;
}

export function normalizeStanceLanguage(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

function detectFamily(text: string): string | undefined {
  if (/买卖/.test(text)) {
    return "sale";
  }
  if (/借款|借贷|贷款/.test(text)) {
    return "loan";
  }
  return undefined;
}

function shortPosition(preferredLanguage: string): string {
  return preferredLanguage.slice(0, 80);
}

function newStanceId(): string {
  return `st_${randomUUID()}`;
}

function findActiveForClause(items: StanceItem[], clauseType: string): StanceItem | undefined {
  const active = items.filter((it) => it.clauseType === clauseType && !it.supersededBy);
  if (active.length === 0) {
    return undefined;
  }
  return active.toSorted((a, b) => {
    const occ = b.occurrences - a.occurrences;
    if (occ !== 0) {
      return occ;
    }
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  })[0];
}

/** 存量条目无账本时以其既有 confidence 为先验，叠加新证据；有账本则由账本派生。 */
function nextConfidence(existing: StanceItem | undefined, added: StanceEvidenceEntry[]): number {
  if (existing) {
    const ledger = [...(existing.evidence ?? []), ...added];
    if (existing.evidence?.length) {
      return stanceConfidenceFromEvidence(ledger);
    }
    return added.reduce((acc, e) => combineStanceConfidence(acc, e.source), existing.confidence);
  }
  return stanceConfidenceFromEvidence(added);
}

function applyUpsert(
  items: StanceItem[],
  params: {
    clauseType: string;
    preferredLanguage: string;
    source: StanceSource;
    family?: string;
    rationale?: string;
    seedOccurrences?: number;
    evidence: StanceEvidenceEntry[];
  },
): { items: StanceItem[]; item: StanceItem } {
  const now = new Date().toISOString();
  const preferredLanguage = params.preferredLanguage;
  const added = params.evidence.length > 0 ? params.evidence : [{ source: params.source, at: now }];
  const existing = findActiveForClause(items, params.clauseType);
  if (existing && existing.preferredLanguage === preferredLanguage) {
    existing.occurrences += 1;
    existing.confidence = nextConfidence(existing, added);
    existing.evidence = [...(existing.evidence ?? []), ...added];
    existing.updatedAt = now;
    if (params.family && !existing.family) {
      existing.family = params.family;
    }
    return { items, item: existing };
  }
  if (existing) {
    const next: StanceItem = {
      id: newStanceId(),
      clauseType: params.clauseType,
      position: shortPosition(preferredLanguage),
      preferredLanguage,
      source: params.source,
      confidence: 0,
      occurrences: existing.occurrences + 1,
      evidence: [...(existing.evidence ?? []), ...added],
      createdAt: now,
      updatedAt: now,
    };
    next.confidence = existing.evidence?.length
      ? stanceConfidenceFromEvidence(next.evidence ?? [])
      : added.reduce((acc, e) => combineStanceConfidence(acc, e.source), existing.confidence);
    if (params.family) {
      next.family = params.family;
    } else if (existing.family) {
      next.family = existing.family;
    }
    if (params.rationale) {
      next.rationale = params.rationale;
    }
    existing.supersededBy = next.id;
    existing.updatedAt = now;
    return { items: [...items, next], item: next };
  }
  const seed =
    params.seedOccurrences && params.seedOccurrences > 0 ? Math.floor(params.seedOccurrences) : 1;
  const created: StanceItem = {
    id: newStanceId(),
    clauseType: params.clauseType,
    position: shortPosition(preferredLanguage),
    preferredLanguage,
    source: params.source,
    confidence: stanceConfidenceFromEvidence(added),
    occurrences: seed,
    evidence: added,
    createdAt: now,
    updatedAt: now,
  };
  if (params.family) {
    created.family = params.family;
  }
  if (params.rationale) {
    created.rationale = params.rationale;
  }
  return { items: [...items, created], item: created };
}

export function upsertStanceFromRedline(params: {
  workspaceDir: string;
  hunk: StanceRedlineHunk;
  /** 来源案件：红线所属 draft 的 matterId，写入证据账本。 */
  matterId?: string;
}): StanceItem | undefined {
  const { workspaceDir, hunk } = params;
  if (hunk.status !== "accepted") {
    return undefined;
  }
  const preferredLanguage = normalizeStanceLanguage(hunk.after ?? "");
  if (!preferredLanguage) {
    return undefined;
  }
  const blob = `${hunk.heading ?? ""} ${hunk.before ?? ""} ${hunk.after ?? ""}`;
  const clauseType = detectStanceClauseType(blob);
  if (!clauseType) {
    return undefined;
  }
  const matterId = params.matterId?.trim() || undefined;
  let captured: StanceItem | undefined;
  mutateStanceItems(workspaceDir, (items) => {
    const out = applyUpsert(items, {
      clauseType,
      preferredLanguage,
      source: "redline",
      family: detectFamily(blob),
      evidence: [
        { source: "redline", at: new Date().toISOString(), ...(matterId ? { matterId } : {}) },
      ],
    });
    captured = out.item;
    return out.items;
  });
  return captured;
}

/** Route-facing alias: never throws (caller may still wrap). */
export function captureStanceFromRedline(params: {
  workspaceDir: string;
  hunk: StanceRedlineHunk;
  matterId?: string;
}): StanceItem | undefined {
  try {
    return upsertStanceFromRedline(params);
  } catch {
    return undefined;
  }
}

export function parseHabitStancePayload(payload: string):
  | {
      clauseType: string;
      preferredLanguage: string;
      occurrences: number;
    }
  | undefined {
  const m = HABIT_PAYLOAD_RE.exec(payload.trim());
  if (!m) {
    return undefined;
  }
  let preferredLanguage = normalizeStanceLanguage(m[2] ?? "");
  let occurrences = 1;
  const occ = /（(\d+)\s*次/.exec(preferredLanguage);
  if (occ) {
    occurrences = Math.max(1, Number(occ[1]));
    preferredLanguage = normalizeStanceLanguage(
      preferredLanguage.replace(/（\d+\s*次[^）]*）\s*$/, ""),
    );
  }
  const named = (m[1] ?? "").trim();
  const clauseType = detectStanceClauseType(named) ?? named;
  if (!clauseType || !preferredLanguage) {
    return undefined;
  }
  return { clauseType, preferredLanguage, occurrences };
}

/** Lawyer-approved revision pack KEY_MODIFICATIONS → structured stance. */
export function upsertStanceFromKeyModification(params: {
  workspaceDir: string;
  bullet: string;
  /** 修订包所属案件，写入证据账本。 */
  matterId?: string;
}): StanceItem | undefined {
  const preferredLanguage = normalizeStanceLanguage(params.bullet);
  const clauseType = detectStanceClauseType(preferredLanguage);
  if (!clauseType || !preferredLanguage) {
    return undefined;
  }
  const matterId = params.matterId?.trim() || undefined;
  let captured: StanceItem | undefined;
  mutateStanceItems(params.workspaceDir, (items) => {
    const out = applyUpsert(items, {
      clauseType,
      preferredLanguage,
      source: "revision_pack",
      family: detectFamily(preferredLanguage),
      rationale: "合同修订积累 KEY_MODIFICATIONS",
      evidence: [
        {
          source: "revision_pack",
          at: new Date().toISOString(),
          ...(matterId ? { matterId } : {}),
        },
      ],
    });
    captured = out.item;
    return out.items;
  });
  return captured;
}

/**
 * 习惯证据的来源案件：按当前工作区红线文件重新聚类该条款，取贡献案件列表。
 * 解析不到时返回空数组——证据无 matterId，注入门槛会保守拦截。
 */
function habitEvidenceMatterIds(workspaceDir: string, clauseType: string): string[] {
  try {
    const cluster = extractHabitsFromRedlines(loadWorkspaceRedlineFiles(workspaceDir)).find(
      (h) => h.clauseType === clauseType,
    );
    return cluster?.matterIds ?? [];
  } catch {
    return [];
  }
}

/** Lawyer already adopted a habit_pattern suggestion — write structured stance only. */
export function writeStanceFromHabit(
  workspaceDir: string,
  payload: string,
): StanceItem | undefined {
  const parsed = parseHabitStancePayload(payload);
  if (!parsed) {
    return undefined;
  }
  const at = new Date().toISOString();
  const matterIds = habitEvidenceMatterIds(workspaceDir, parsed.clauseType);
  const evidence: StanceEvidenceEntry[] =
    matterIds.length > 0
      ? matterIds.map((matterId) => ({ source: "habit_adopt" as const, at, matterId }))
      : [{ source: "habit_adopt", at }];
  let captured: StanceItem | undefined;
  mutateStanceItems(workspaceDir, (items) => {
    const out = applyUpsert(items, {
      clauseType: parsed.clauseType,
      preferredLanguage: parsed.preferredLanguage,
      source: "habit_adopt",
      seedOccurrences: parsed.occurrences,
      evidence,
    });
    captured = out.item;
    return out.items;
  });
  return captured;
}
