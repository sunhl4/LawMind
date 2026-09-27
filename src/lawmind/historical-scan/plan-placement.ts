/**
 * 把一次查看分成三件事：新建案件、收进已有案件、一般资料按类型收好。
 * 只看文件夹名和文件名，不读正文，也不调用模型。确认后才复制。
 */

import fs from "node:fs";
import path from "node:path";
import { listMatterIds } from "../cases/index.js";
import { createMatterIfAbsent } from "../cases/matter-create.js";
import { isValidMatterId } from "../cases/matter-id.js";
import { resolveMatterSidebarLabel } from "../cases/matter-label.js";
import { caseFilePath } from "../memory/case-workspace.js";
import { resolveScanSource } from "./file-into-matters.js";
import { listScanRoots } from "./job-store.js";
import { readLatestScanJob } from "./run-scan.js";
import type { HistoricalCatalogItem, HistoricalDocKind } from "./types.js";

const PLACE_ROOT = /^(desktop|documents|downloads?|桌面|文稿|文档|下载)$/i;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

export const LIBRARY_KIND_LABEL: Record<HistoricalDocKind, string> = {
  contract: "合同",
  litigation: "诉讼文书",
  evidence: "证据",
  correspondence: "往来",
  other: "其他",
};

export type ScanPlan = {
  createMatters: Array<{ label: string; count: number }>;
  intoMatters: Array<{ matterId: string; displayName: string; count: number }>;
  library: Array<{ kind: HistoricalDocKind; label: string; count: number }>;
};

export type ScanPlanSelection = {
  createLabels: string[];
  intoMatterIds: string[];
  libraryKinds: string[];
};

type MatterName = { matterId: string; displayName: string };

type Assignment =
  | { item: HistoricalCatalogItem; action: "create"; label: string }
  | { item: HistoricalCatalogItem; action: "into"; matterId: string; displayName: string }
  | { item: HistoricalCatalogItem; action: "library"; kind: HistoricalDocKind };

function compactName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function matchMatter(text: string, matters: MatterName[]): MatterName | null {
  const hay = compactName(text);
  if (hay.length < 2) {
    return null;
  }
  let best: { matter: MatterName; length: number } | null = null;
  for (const matter of matters) {
    for (const raw of [matter.displayName, matter.matterId]) {
      const name = compactName(raw);
      if (name.length < 2) {
        continue;
      }
      // 短名只接受完全一致，避免「合同」把所有合同文件吸进同一个案件。
      if (hay === name || (name.length >= 4 && hay.includes(name))) {
        if (!best || name.length > best.length) {
          best = { matter, length: name.length };
        }
      }
    }
  }
  return best?.matter ?? null;
}

function assignCatalog(items: HistoricalCatalogItem[], matters: MatterName[]): Assignment[] {
  const folders = new Map<string, HistoricalCatalogItem[]>();
  const loose: HistoricalCatalogItem[] = [];
  for (const item of items) {
    const label = item.proposedMatterLabel?.trim();
    if (item.layout === "organized" && label && !PLACE_ROOT.test(label)) {
      const group = folders.get(label) ?? [];
      group.push(item);
      folders.set(label, group);
      continue;
    }
    loose.push(item);
  }
  const assigned: Assignment[] = [];
  for (const [label, group] of folders) {
    const hit = matchMatter(label, matters);
    for (const item of group) {
      assigned.push(
        hit
          ? { item, action: "into", matterId: hit.matterId, displayName: hit.displayName }
          : { item, action: "create", label },
      );
    }
  }
  for (const item of loose) {
    const stem = item.fileName.replace(/\.[^.]+$/u, "");
    const hit = matchMatter(stem, matters);
    if (hit) {
      assigned.push({ item, action: "into", matterId: hit.matterId, displayName: hit.displayName });
      continue;
    }
    assigned.push({ item, action: "library", kind: item.kind });
  }
  return assigned;
}

async function matterNames(workspaceDir: string): Promise<MatterName[]> {
  const ids = await listMatterIds(workspaceDir);
  return ids.map((matterId) => {
    let memory = "";
    try {
      memory = fs.readFileSync(caseFilePath(workspaceDir, matterId), "utf8");
    } catch {
      memory = "";
    }
    return { matterId, displayName: resolveMatterSidebarLabel(memory, matterId) };
  });
}

function countBy<T extends string>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export async function buildScanPlan(workspaceDir: string): Promise<ScanPlan | null> {
  const job = readLatestScanJob(workspaceDir);
  if (!job) {
    return null;
  }
  const assigned = assignCatalog(job.catalog, await matterNames(workspaceDir));
  const createMatters = [
    ...countBy(assigned.flatMap((row) => (row.action === "create" ? [row.label] : []))),
  ].map(([label, count]) => ({ label, count }));
  const intoGroups = new Map<string, { displayName: string; count: number }>();
  for (const row of assigned) {
    if (row.action !== "into") {
      continue;
    }
    const prev = intoGroups.get(row.matterId);
    intoGroups.set(row.matterId, {
      displayName: row.displayName,
      count: (prev?.count ?? 0) + 1,
    });
  }
  const library = [
    ...countBy(assigned.flatMap((row) => (row.action === "library" ? [row.kind] : []))),
  ].map(([kind, count]) => ({ kind, label: LIBRARY_KIND_LABEL[kind], count }));
  return {
    createMatters,
    intoMatters: [...intoGroups.entries()].map(([matterId, row]) => ({
      matterId,
      displayName: row.displayName,
      count: row.count,
    })),
    library,
  };
}

function underDir(dir: string, file: string): boolean {
  const base = path.resolve(dir);
  const target = path.resolve(file);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

/** 同名且大小相同视为已经收过；大小不同则另存一份，不覆盖。 */
function placeDest(
  dir: string,
  fileName: string,
  size: number,
): { dest: string; already: boolean } | null {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  for (let n = 1; n < 50; n += 1) {
    const name = n === 1 ? fileName : `${stem} (${n})${ext}`;
    const dest = path.join(dir, name);
    if (!underDir(dir, dest)) {
      return null;
    }
    if (!fs.existsSync(dest)) {
      return { dest, already: false };
    }
    try {
      if (fs.statSync(dest).size === size) {
        return { dest, already: true };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function applyScanPlan(
  workspaceDir: string,
  selection: ScanPlanSelection,
): Promise<
  | { ok: true; copied: number; created: number; truncated: boolean }
  | { ok: false; error: "no_scan" }
> {
  const job = readLatestScanJob(workspaceDir);
  if (!job) {
    return { ok: false, error: "no_scan" };
  }
  const createLabels = new Set(selection.createLabels);
  const intoIds = new Set(selection.intoMatterIds);
  const kinds = new Set(selection.libraryKinds);
  const assigned = assignCatalog(job.catalog, await matterNames(workspaceDir)).filter((row) => {
    if (row.action === "create") {
      return createLabels.has(row.label);
    }
    if (row.action === "into") {
      return intoIds.has(row.matterId);
    }
    return kinds.has(row.kind);
  });
  const roots = new Map(listScanRoots(workspaceDir).map((root) => [root.id, root.absPath]));
  let copied = 0;
  let created = 0;
  let totalBytes = 0;
  let truncated = false;
  const createdIds = new Set<string>();

  for (const row of assigned) {
    if (truncated) {
      break;
    }
    const rootAbs = roots.get(row.item.rootId);
    if (!rootAbs) {
      continue;
    }
    const src = resolveScanSource(rootAbs, row.item.relPath);
    if (!src || src.size > MAX_FILE_BYTES) {
      continue;
    }
    let destDir: string;
    if (row.action === "create") {
      if (!isValidMatterId(row.label)) {
        continue;
      }
      if (!createdIds.has(row.label)) {
        const made = await createMatterIfAbsent(workspaceDir, row.label, {
          displayName: row.label,
          status: "intake",
        });
        if (made.created) {
          created += 1;
        }
        createdIds.add(row.label);
      }
      destDir = path.join(workspaceDir, "cases", row.label, "materials");
    } else if (row.action === "into") {
      if (!isValidMatterId(row.matterId)) {
        continue;
      }
      destDir = path.join(workspaceDir, "cases", row.matterId, "materials");
    } else {
      destDir = path.join(workspaceDir, "library", LIBRARY_KIND_LABEL[row.kind]);
    }
    const placed = placeDest(destDir, row.item.fileName, src.size);
    if (!placed) {
      continue;
    }
    if (placed.already) {
      continue;
    }
    if (totalBytes + src.size > MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src.abs, placed.dest);
    copied += 1;
    totalBytes += src.size;
  }

  return { ok: true, copied, created, truncated };
}
