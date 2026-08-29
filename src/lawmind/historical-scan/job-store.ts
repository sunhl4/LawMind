import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { HISTORICAL_SCAN_SCHEMA, MAX_SCAN_ROOTS, type HistoricalScanRoot } from "./types.js";

export function historicalScanDir(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "historical-scan");
}

function rootsPath(workspaceDir: string): string {
  return path.join(historicalScanDir(workspaceDir), "roots.json");
}

export function listScanRoots(workspaceDir: string): HistoricalScanRoot[] {
  try {
    const raw = JSON.parse(fs.readFileSync(rootsPath(workspaceDir), "utf8")) as {
      roots?: HistoricalScanRoot[];
    };
    return Array.isArray(raw.roots) ? raw.roots.slice(0, MAX_SCAN_ROOTS) : [];
  } catch {
    return [];
  }
}

export function addScanRoot(
  workspaceDir: string,
  absPath: string,
  label?: string,
): { ok: true; root: HistoricalScanRoot } | { ok: false; error: string } {
  const trimmed = absPath.trim();
  if (!trimmed) {
    return { ok: false, error: "empty_path" };
  }
  let real: string;
  try {
    real = fs.realpathSync(trimmed);
  } catch {
    return { ok: false, error: "path_not_found" };
  }
  if (!fs.statSync(real).isDirectory()) {
    return { ok: false, error: "not_directory" };
  }
  const existing = listScanRoots(workspaceDir);
  if (existing.some((r) => r.absPath === real)) {
    return { ok: false, error: "duplicate_root" };
  }
  if (existing.length >= MAX_SCAN_ROOTS) {
    return { ok: false, error: "max_roots" };
  }
  const root: HistoricalScanRoot = {
    id: `root_${randomUUID().slice(0, 8)}`,
    absPath: real,
    addedAt: new Date().toISOString(),
    label: label?.trim() || path.basename(real),
  };
  fs.mkdirSync(historicalScanDir(workspaceDir), { recursive: true });
  writeJsonAtomic(rootsPath(workspaceDir), {
    schemaVersion: HISTORICAL_SCAN_SCHEMA,
    roots: [...existing, root],
  });
  return { ok: true, root };
}

export function removeScanRoot(workspaceDir: string, rootId: string): boolean {
  const existing = listScanRoots(workspaceDir);
  const next = existing.filter((r) => r.id !== rootId);
  if (next.length === existing.length) {
    return false;
  }
  writeJsonAtomic(rootsPath(workspaceDir), { schemaVersion: HISTORICAL_SCAN_SCHEMA, roots: next });
  return true;
}

export function jobPath(workspaceDir: string, scanId: string): string {
  return path.join(historicalScanDir(workspaceDir), "jobs", `${scanId}.json`);
}
