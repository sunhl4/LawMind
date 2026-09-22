import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { suggestMemoryAdoption } from "../memory/adoption-service.js";
import {
  classifyWalkedItems,
  cursorFromWalk,
  fingerprintOfJob,
  hashCatalogFingerprint,
  mergeCatalog,
  readScanCursor,
  writeScanCursor,
} from "./cursor.js";
import { extractHabitsFromRedlines, loadWorkspaceRedlineFiles } from "./habit-extract.js";
import { jobPath, listScanRoots } from "./job-store.js";
import {
  HISTORICAL_SCAN_SCHEMA,
  type HistoricalCatalogItem,
  type HistoricalScanJob,
} from "./types.js";
import { walkScanRoot } from "./walk.js";

function knowledgeMarkdown(job: HistoricalScanJob): string {
  const organized = job.catalog.filter((i) => i.layout === "organized");
  const messy = job.catalog.filter((i) => i.layout === "messy");
  const byKind = new Map<string, number>();
  for (const item of job.catalog) {
    byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
  }
  const kindLines = [...byKind.entries()].map(([k, n]) => `- ${k}：${n}`);
  const folders = [...new Set(organized.map((i) => i.proposedMatterLabel).filter(Boolean))];
  return [
    `# 历史材料扫描 ${job.scanId}`,
    "",
    `扫描时间：${job.createdAt}`,
    `文件 ${job.stats.cataloged} 份${job.stats.truncated ? "（已截断）" : ""}。`,
    "",
    "## 类型",
    ...kindLines,
    "",
    "## 已整理文件夹（建议建案）",
    folders.length > 0 ? folders.map((f) => `- ${f}`).join("\n") : "- （无）",
    "",
    `## 未分类（杂烩）`,
    `- ${messy.length} 份，不自动建案。`,
  ].join("\n");
}

export async function runHistoricalScan(
  workspaceDir: string,
  opts?: { rootIds?: string[]; auditDir?: string; incremental?: boolean },
): Promise<HistoricalScanJob> {
  const roots = listScanRoots(workspaceDir).filter((r) =>
    opts?.rootIds?.length ? opts.rootIds.includes(r.id) : true,
  );
  const previousJob = readLatestScanJob(workspaceDir);
  const incremental = opts?.incremental ?? previousJob !== null;
  const cursor = incremental ? readScanCursor(workspaceDir) : null;

  const scanId = `scan_${randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  let truncated = false;
  const walked: HistoricalCatalogItem[] = [];
  for (const root of roots) {
    const result = walkScanRoot(root);
    walked.push(...result.items);
    truncated = truncated || result.truncated;
  }

  const { unchanged, changed } = classifyWalkedItems(walked, incremental ? cursor : null);
  const catalog = incremental
    ? mergeCatalog(previousJob?.catalog ?? [], walked, unchanged)
    : walked;

  const organizedFolders = new Set(
    catalog
      .filter((i) => i.layout === "organized" && i.proposedMatterLabel)
      .map((i) => i.proposedMatterLabel),
  );
  const habits = extractHabitsFromRedlines(loadWorkspaceRedlineFiles(workspaceDir));
  const catalogFingerprint = hashCatalogFingerprint(catalog);
  const job: HistoricalScanJob = {
    schemaVersion: HISTORICAL_SCAN_SCHEMA,
    scanId,
    createdAt,
    status: "complete",
    rootIds: roots.map((r) => r.id),
    catalogFingerprint,
    stats: {
      filesSeen: walked.length,
      cataloged: catalog.length,
      organizedFolders: organizedFolders.size,
      messyFiles: catalog.filter((i) => i.layout === "messy").length,
      habitsQueued: 0,
      knowledgeQueued: 0,
      filesUnchanged: incremental ? unchanged.length : 0,
      filesChanged: incremental ? changed.length : walked.length,
      incremental,
      truncated,
    },
    catalog,
    habits,
  };

  const auditDir = opts?.auditDir ?? path.join(workspaceDir, "audit");
  fs.mkdirSync(auditDir, { recursive: true });
  const knowledgeUnchanged =
    previousJob !== null && fingerprintOfJob(previousJob) === catalogFingerprint;
  if (catalog.length > 0 && !knowledgeUnchanged) {
    await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "project",
      kind: "historical.knowledge",
      payload: knowledgeMarkdown(job),
      origin: "engine",
      note: "historical_scan",
    });
    job.stats.knowledgeQueued = 1;
  }
  for (const habit of habits) {
    const rec = await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "lawyer",
      kind: "lawyer.habit_pattern",
      payload: `审查「${habit.clauseType}」条款时，默认采用：${habit.preferredLanguage}（${habit.occurrences} 次，已取最新改法）`,
      origin: "engine",
      note: "habit_min_5",
    });
    if (!rec.reusedPending) {
      job.stats.habitsQueued += 1;
    }
  }

  fs.mkdirSync(path.dirname(jobPath(workspaceDir, scanId)), { recursive: true });
  writeJsonAtomic(jobPath(workspaceDir, scanId), job);
  writeScanCursor(
    workspaceDir,
    cursorFromWalk(walked, job.rootIds, incremental ? cursor : readScanCursor(workspaceDir)),
  );
  return job;
}

export function readLatestScanJob(workspaceDir: string): HistoricalScanJob | null {
  const dir = path.join(workspaceDir, "lawmind", "historical-scan", "jobs");
  if (!fs.existsSync(dir)) {
    return null;
  }
  const jobs: HistoricalScanJob[] = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as HistoricalScanJob;
      if (parsed && typeof parsed.scanId === "string") {
        jobs.push(parsed);
      }
    } catch {
      /* skip */
    }
  }
  if (jobs.length === 0) {
    return null;
  }
  jobs.sort((a, b) => {
    const byTime = (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    if (byTime !== 0) {
      return byTime;
    }
    return b.scanId.localeCompare(a.scanId);
  });
  return jobs[0] ?? null;
}
