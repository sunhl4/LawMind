import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { historicalScanDir } from "./job-store.js";
import {
  HISTORICAL_SCAN_SCHEMA,
  type HistoricalCatalogItem,
  type HistoricalScanCursor,
} from "./types.js";

export function cursorPath(workspaceDir: string): string {
  return path.join(historicalScanDir(workspaceDir), "cursor.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readScanCursor(workspaceDir: string): HistoricalScanCursor | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(cursorPath(workspaceDir), "utf8"));
    if (!isRecord(raw) || raw.schemaVersion !== HISTORICAL_SCAN_SCHEMA || !isRecord(raw.roots)) {
      return null;
    }
    const roots: HistoricalScanCursor["roots"] = {};
    for (const [rootId, bucket] of Object.entries(raw.roots)) {
      if (!isRecord(bucket) || !isRecord(bucket.files)) {
        continue;
      }
      const files: HistoricalScanCursor["roots"][string]["files"] = {};
      for (const [relPath, meta] of Object.entries(bucket.files)) {
        if (!isRecord(meta) || typeof meta.mtimeMs !== "number" || typeof meta.size !== "number") {
          continue;
        }
        files[relPath] = { mtimeMs: meta.mtimeMs, size: meta.size };
      }
      roots[rootId] = { files };
    }
    return { schemaVersion: HISTORICAL_SCAN_SCHEMA, roots };
  } catch {
    return null;
  }
}

export function writeScanCursor(workspaceDir: string, cursor: HistoricalScanCursor): void {
  fs.mkdirSync(historicalScanDir(workspaceDir), { recursive: true });
  writeJsonAtomic(cursorPath(workspaceDir), cursor);
}

export function catalogItemKey(item: Pick<HistoricalCatalogItem, "rootId" | "relPath">): string {
  return `${item.rootId}\0${item.relPath}`;
}

export function classifyWalkedItems(
  walked: HistoricalCatalogItem[],
  cursor: HistoricalScanCursor | null,
): { unchanged: HistoricalCatalogItem[]; changed: HistoricalCatalogItem[] } {
  const unchanged: HistoricalCatalogItem[] = [];
  const changed: HistoricalCatalogItem[] = [];
  for (const item of walked) {
    const prev = cursor?.roots[item.rootId]?.files[item.relPath];
    if (prev && prev.mtimeMs === item.mtimeMs && prev.size === item.size) {
      unchanged.push(item);
    } else {
      changed.push(item);
    }
  }
  return { unchanged, changed };
}

export function mergeCatalog(
  previous: HistoricalCatalogItem[],
  walked: HistoricalCatalogItem[],
  unchanged: HistoricalCatalogItem[],
): HistoricalCatalogItem[] {
  const prevByKey = new Map(previous.map((item) => [catalogItemKey(item), item]));
  const unchangedKeys = new Set(unchanged.map((item) => catalogItemKey(item)));
  return walked.map((item) => {
    const key = catalogItemKey(item);
    if (unchangedKeys.has(key)) {
      return prevByKey.get(key) ?? item;
    }
    return item;
  });
}

export function cursorFromWalk(
  walked: HistoricalCatalogItem[],
  scannedRootIds: string[],
  previous: HistoricalScanCursor | null,
): HistoricalScanCursor {
  const roots: HistoricalScanCursor["roots"] = { ...previous?.roots };
  for (const rootId of scannedRootIds) {
    roots[rootId] = { files: {} };
  }
  for (const item of walked) {
    let bucket = roots[item.rootId];
    if (!bucket) {
      bucket = { files: {} };
      roots[item.rootId] = bucket;
    }
    bucket.files[item.relPath] = { mtimeMs: item.mtimeMs, size: item.size };
  }
  return { schemaVersion: HISTORICAL_SCAN_SCHEMA, roots };
}

export function hashCatalogFingerprint(catalog: HistoricalCatalogItem[]): string {
  const byKind = new Map<string, number>();
  const folders = new Set<string>();
  let messy = 0;
  for (const item of catalog) {
    byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
    if (item.layout === "messy") {
      messy += 1;
    } else if (item.proposedMatterLabel) {
      folders.add(item.proposedMatterLabel);
    }
  }
  const kinds = [...byKind.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([kind, n]) => `${kind}:${n}`)
    .join(",");
  const folderList = [...folders].toSorted((a, b) => a.localeCompare(b)).join(",");
  const summary = `kinds=${kinds}|folders=${folderList}|messy=${messy}`;
  return createHash("sha256").update(summary).digest("hex");
}

export function fingerprintOfJob(job: {
  catalogFingerprint?: string;
  catalog: HistoricalCatalogItem[];
}): string {
  return job.catalogFingerprint ?? hashCatalogFingerprint(job.catalog);
}
