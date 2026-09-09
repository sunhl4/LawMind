import fs from "node:fs";
import path from "node:path";
import { HABIT_MIN_OCCURRENCES, type HistoricalHabitCandidate } from "./types.js";

const CLAUSE_TYPES: Array<{ id: string; re: RegExp }> = [
  { id: "管辖", re: /管辖|争议解决|仲裁/ },
  { id: "违约金", re: /违约金/ },
  { id: "保密", re: /保密/ },
  { id: "赔偿", re: /赔偿|责任限制|责任上限/ },
  { id: "知识产权", re: /知识产权|许可使用/ },
  { id: "定金", re: /定金/ },
];

export type RedlineHunkLike = {
  before?: string;
  after?: string;
  status?: string;
  heading?: string;
};

export type RedlineFileLike = {
  hunks?: RedlineHunkLike[];
  updatedAt?: string;
  path?: string;
  mtimeMs?: number;
  /** 所属案件（由同名 draft 文件解析），用于立场证据的跨案件门槛。 */
  matterId?: string;
};

function detectClauseType(text: string): string | undefined {
  for (const row of CLAUSE_TYPES) {
    if (row.re.test(text)) {
      return row.id;
    }
  }
  return undefined;
}

function normalizeLanguage(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

/**
 * Cluster accepted redline hunks. Same clause type + conflicting after-text:
 * keep the latest mtime. Queue when occurrences ≥ HABIT_MIN_OCCURRENCES.
 */
export function extractHabitsFromRedlines(files: RedlineFileLike[]): HistoricalHabitCandidate[] {
  type Acc = {
    clauseType: string;
    preferredLanguage: string;
    occurrences: number;
    latestMtimeMs: number;
    samplePaths: string[];
    matterIds: string[];
  };
  const byType = new Map<string, Acc>();

  for (const file of files) {
    const mtime = file.mtimeMs ?? (file.updatedAt ? Date.parse(file.updatedAt) : 0);
    const matterId = file.matterId?.trim() || undefined;
    for (const hunk of file.hunks ?? []) {
      if (hunk.status !== "accepted") {
        continue;
      }
      const blob = `${hunk.heading ?? ""} ${hunk.before ?? ""} ${hunk.after ?? ""}`;
      const clauseType = detectClauseType(blob);
      const preferred = normalizeLanguage(hunk.after ?? "");
      if (!clauseType || !preferred) {
        continue;
      }
      const existing = byType.get(clauseType);
      if (!existing) {
        byType.set(clauseType, {
          clauseType,
          preferredLanguage: preferred,
          occurrences: 1,
          latestMtimeMs: mtime,
          samplePaths: file.path ? [file.path] : [],
          matterIds: matterId ? [matterId] : [],
        });
        continue;
      }
      existing.occurrences += 1;
      if (
        file.path &&
        existing.samplePaths.length < 5 &&
        !existing.samplePaths.includes(file.path)
      ) {
        existing.samplePaths.push(file.path);
      }
      if (matterId && !existing.matterIds.includes(matterId)) {
        existing.matterIds.push(matterId);
      }
      if (preferred !== existing.preferredLanguage && mtime >= existing.latestMtimeMs) {
        existing.preferredLanguage = preferred;
        existing.latestMtimeMs = mtime;
      } else if (mtime > existing.latestMtimeMs) {
        existing.latestMtimeMs = mtime;
      }
    }
  }

  return [...byType.values()]
    .filter((row) => row.occurrences >= HABIT_MIN_OCCURRENCES)
    .map((row) => ({
      clauseType: row.clauseType,
      preferredLanguage: row.preferredLanguage,
      occurrences: row.occurrences,
      latestMtimeMs: row.latestMtimeMs,
      conflictResolved: true,
      samplePaths: row.samplePaths,
      matterIds: row.matterIds.slice(0, 10),
    }));
}

/** Best-effort: drafts/<taskId>.redline.json 的所属案件取自同名 draft 文件。 */
function readDraftMatterId(workspaceDir: string, redlineFileName: string): string | undefined {
  const draftName = redlineFileName.replace(/\.redline\.json$/, ".json");
  if (draftName === redlineFileName) {
    return undefined;
  }
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, "drafts", draftName), "utf8"),
    ) as { matterId?: unknown };
    return typeof raw.matterId === "string" && raw.matterId.trim()
      ? raw.matterId.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export function loadWorkspaceRedlineFiles(workspaceDir: string): RedlineFileLike[] {
  const dir = path.join(workspaceDir, "drafts");
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: RedlineFileLike[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".redline.json")) {
      continue;
    }
    const abs = path.join(dir, name);
    try {
      const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as { hunks?: RedlineHunkLike[] };
      const st = fs.statSync(abs);
      const matterId = readDraftMatterId(workspaceDir, name);
      out.push({
        hunks: Array.isArray(raw.hunks) ? raw.hunks : [],
        path: `drafts/${name}`,
        mtimeMs: st.mtimeMs,
        ...(matterId ? { matterId } : {}),
      });
    } catch {
      /* skip */
    }
  }
  return out;
}
