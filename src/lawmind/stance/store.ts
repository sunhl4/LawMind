/**
 * Atomic read/write for the workspace stance library.
 */

import fs from "node:fs";
import path from "node:path";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";
import {
  STANCE_SCHEMA_VERSION,
  type StanceEvidenceEntry,
  type StanceItem,
  type StanceSource,
  type StanceStoreFile,
} from "./types.js";

export function stanceItemsPath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "stance", "items.json");
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}

function asSource(raw: unknown): StanceSource | undefined {
  if (raw === "redline" || raw === "habit_adopt" || raw === "manual" || raw === "revision_pack") {
    return raw;
  }
  return undefined;
}

/** 账本条目校验；上限防止无限增长（超出保留最近）。 */
const MAX_EVIDENCE_ENTRIES = 50;

function asEvidence(raw: unknown): StanceEvidenceEntry[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: StanceEvidenceEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const r = row as Partial<StanceEvidenceEntry>;
    const source = asSource(r.source);
    const at = typeof r.at === "string" && r.at ? r.at : "";
    if (!source || !at) {
      continue;
    }
    const entry: StanceEvidenceEntry = { source, at };
    if (typeof r.matterId === "string" && r.matterId.trim()) {
      entry.matterId = r.matterId.trim();
    }
    out.push(entry);
  }
  return out.length > 0 ? out.slice(-MAX_EVIDENCE_ENTRIES) : undefined;
}

function asStanceItem(raw: unknown): StanceItem | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const r = raw as Partial<StanceItem>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const clauseType = typeof r.clauseType === "string" ? r.clauseType.trim() : "";
  const preferredLanguage =
    typeof r.preferredLanguage === "string" ? r.preferredLanguage.trim() : "";
  const position = typeof r.position === "string" ? r.position.trim() : preferredLanguage;
  const source = asSource(r.source);
  if (!id || !clauseType || !preferredLanguage || !source) {
    return undefined;
  }
  const occurrences =
    typeof r.occurrences === "number" && Number.isFinite(r.occurrences) && r.occurrences > 0
      ? Math.floor(r.occurrences)
      : 1;
  const item: StanceItem = {
    id,
    clauseType,
    position: position || preferredLanguage,
    preferredLanguage,
    source,
    confidence: clamp01(typeof r.confidence === "number" ? r.confidence : 0),
    occurrences,
    createdAt:
      typeof r.createdAt === "string" && r.createdAt ? r.createdAt : new Date().toISOString(),
    updatedAt:
      typeof r.updatedAt === "string" && r.updatedAt ? r.updatedAt : new Date().toISOString(),
  };
  const evidence = asEvidence((r as { evidence?: unknown }).evidence);
  if (evidence) {
    item.evidence = evidence;
  }
  if (typeof r.family === "string" && r.family.trim()) {
    item.family = r.family.trim();
  }
  if (typeof r.rationale === "string" && r.rationale.trim()) {
    item.rationale = r.rationale.trim();
  }
  if (typeof r.statuteBasis === "string" && r.statuteBasis.trim()) {
    item.statuteBasis = r.statuteBasis.trim();
  }
  if (typeof r.supersededBy === "string" && r.supersededBy.trim()) {
    item.supersededBy = r.supersededBy.trim();
  }
  return item;
}

export function readStanceItems(workspaceDir: string): StanceItem[] {
  const file = stanceItemsPath(workspaceDir);
  try {
    if (!fs.existsSync(file)) {
      return [];
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StanceStoreFile>;
    if (raw?.schemaVersion !== STANCE_SCHEMA_VERSION || !Array.isArray(raw.items)) {
      return [];
    }
    return raw.items.map(asStanceItem).filter((x): x is StanceItem => Boolean(x));
  } catch {
    return [];
  }
}

export function writeStanceItems(workspaceDir: string, items: StanceItem[]): void {
  const payload: StanceStoreFile = {
    schemaVersion: STANCE_SCHEMA_VERSION,
    items,
  };
  writeJsonAtomic(stanceItemsPath(workspaceDir), payload);
}

/** Read-modify-write under an exclusive lock so concurrent accepts do not tear the file. */
export function mutateStanceItems(
  workspaceDir: string,
  fn: (items: StanceItem[]) => StanceItem[],
): StanceItem[] {
  const lockPath = `${stanceItemsPath(workspaceDir)}.lock`;
  return withExclusiveFileLock(lockPath, () => {
    const next = fn(readStanceItems(workspaceDir));
    writeStanceItems(workspaceDir, next);
    return next;
  });
}
