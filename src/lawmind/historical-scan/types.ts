export const HISTORICAL_SCAN_SCHEMA = 1;
export const MAX_SCAN_ROOTS = 3;
export const MAX_SCAN_FILES = 2_000;
export const MAX_SCAN_DEPTH = 8;
export const HABIT_MIN_OCCURRENCES = 5;

export type HistoricalDocKind = "contract" | "litigation" | "evidence" | "correspondence" | "other";

export type HistoricalLayout = "organized" | "messy";

export type HistoricalScanRoot = {
  id: string;
  absPath: string;
  addedAt: string;
  label?: string;
};

export type HistoricalCatalogItem = {
  rootId: string;
  relPath: string;
  fileName: string;
  ext: string;
  size: number;
  mtimeMs: number;
  kind: HistoricalDocKind;
  layout: HistoricalLayout;
  proposedMatterLabel?: string;
};

export type HistoricalHabitCandidate = {
  clauseType: string;
  preferredLanguage: string;
  occurrences: number;
  latestMtimeMs: number;
  conflictResolved: boolean;
  samplePaths: string[];
  /** 贡献接受 hunk 的不同案件（由 draft 文件解析），供立场证据跨案件门槛使用。 */
  matterIds: string[];
};

export type HistoricalScanCursorFile = {
  mtimeMs: number;
  size: number;
};

export type HistoricalScanCursor = {
  schemaVersion: typeof HISTORICAL_SCAN_SCHEMA;
  roots: {
    [rootId: string]: {
      files: {
        [relPath: string]: HistoricalScanCursorFile;
      };
    };
  };
};

export type HistoricalScanJob = {
  schemaVersion: typeof HISTORICAL_SCAN_SCHEMA;
  scanId: string;
  createdAt: string;
  status: "running" | "complete" | "failed";
  error?: string;
  rootIds: string[];
  /** Stable hash of kinds + organized folder names + messy count. */
  catalogFingerprint?: string;
  stats: {
    filesSeen: number;
    cataloged: number;
    organizedFolders: number;
    messyFiles: number;
    habitsQueued: number;
    knowledgeQueued: number;
    filesUnchanged: number;
    filesChanged: number;
    incremental?: boolean;
    truncated: boolean;
  };
  catalog: HistoricalCatalogItem[];
  habits: HistoricalHabitCandidate[];
};
