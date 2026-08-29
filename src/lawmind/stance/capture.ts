/**
 * Capture lawyer stance from accepted redlines (and adopted habit payloads).
 * Does not write LAWYER_PROFILE; redline accept is already an explicit lawyer click.
 */

import { randomUUID } from "node:crypto";
import { mutateStanceItems } from "./store.js";
import type { StanceItem, StanceRedlineHunk, StanceSource } from "./types.js";

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

export function stanceConfidence(occurrences: number): number {
  const n = Number.isFinite(occurrences) && occurrences > 0 ? Math.floor(occurrences) : 1;
  return Math.min(1, 0.3 + n * 0.1);
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

function applyUpsert(
  items: StanceItem[],
  params: {
    clauseType: string;
    preferredLanguage: string;
    source: StanceSource;
    family?: string;
    rationale?: string;
    seedOccurrences?: number;
  },
): { items: StanceItem[]; item: StanceItem } {
  const now = new Date().toISOString();
  const preferredLanguage = params.preferredLanguage;
  const existing = findActiveForClause(items, params.clauseType);
  if (existing && existing.preferredLanguage === preferredLanguage) {
    existing.occurrences += 1;
    existing.confidence = stanceConfidence(existing.occurrences);
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
      confidence: stanceConfidence(existing.occurrences + 1),
      occurrences: existing.occurrences + 1,
      createdAt: now,
      updatedAt: now,
    };
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
    confidence: stanceConfidence(seed),
    occurrences: seed,
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
  let captured: StanceItem | undefined;
  mutateStanceItems(workspaceDir, (items) => {
    const out = applyUpsert(items, {
      clauseType,
      preferredLanguage,
      source: "redline",
      family: detectFamily(blob),
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

/** Lawyer already adopted a habit_pattern suggestion — write structured stance only. */
export function writeStanceFromHabit(
  workspaceDir: string,
  payload: string,
): StanceItem | undefined {
  const parsed = parseHabitStancePayload(payload);
  if (!parsed) {
    return undefined;
  }
  let captured: StanceItem | undefined;
  mutateStanceItems(workspaceDir, (items) => {
    const out = applyUpsert(items, {
      clauseType: parsed.clauseType,
      preferredLanguage: parsed.preferredLanguage,
      source: "habit_adopt",
      seedOccurrences: parsed.occurrences,
    });
    captured = out.item;
    return out.items;
  });
  return captured;
}
