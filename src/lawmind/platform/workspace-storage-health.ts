/**
 * 工作区存储体检：统计律师真正会碰的几块（案件 / 审计 / 会话 / 草稿）和工作区总量，
 * 超过阈值或私有化配额时给一句可执行的轮转建议。不做全盘深入分析，也不碰工作区外文件。
 */

import fs from "node:fs";
import path from "node:path";

export type WorkspaceStorageBucket = {
  name: "cases" | "audit" | "sessions" | "drafts";
  bytes: number;
  files: number;
  directories: number;
};

export type WorkspaceStorageThresholds = {
  sessionWarnBytes: number;
  auditWarnBytes: number;
  draftWarnBytes: number;
  caseWarnCount: number;
};

/** 私有化部署的软配额；只告警，不阻断写入。 */
export type WorkspaceStorageQuotaOptions = {
  /** 工作区总量软上限（字节）。省略或非正数时不检查配额。 */
  quotaBytes?: number;
  /** 触发告警的比例，默认 0.9，夹到 (0, 1]。 */
  warnRatio?: number;
};

export type WorkspaceStorageQuota = {
  limitBytes: number;
  usedBytes: number;
  usedRatio: number;
  warnRatio: number;
  exceeded: boolean;
};

export type WorkspaceStorageHealth = {
  ok: boolean;
  buckets: WorkspaceStorageBucket[];
  /** 工作区根目录下的总用量（不跟符号链接，跳过构建/缓存目录）。 */
  totalBytes: number;
  totalFiles: number;
  quota?: WorkspaceStorageQuota;
  lines: string[];
  warnings: string[];
};

const DEFAULT_THRESHOLDS: WorkspaceStorageThresholds = {
  sessionWarnBytes: 200 * 1024 * 1024,
  auditWarnBytes: 500 * 1024 * 1024,
  draftWarnBytes: 1024 * 1024 * 1024,
  caseWarnCount: 2_000,
};

const DEFAULT_QUOTA_WARN_RATIO = 0.9;

const BUCKET_NAMES = ["cases", "audit", "sessions", "drafts"] as const;
type BucketName = (typeof BUCKET_NAMES)[number];

/** 构建产物 / 缓存不属于工作区资料，不计入配额，也不拖慢巡检。 */
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "release", ".cache", "tmp"]);

const MB = 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) {
    return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
  }
  if (bytes >= MB) {
    return `${(bytes / MB).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function isBucketName(name: string): name is BucketName {
  return (BUCKET_NAMES as readonly string[]).includes(name);
}

type BucketAccumulator = { bytes: number; files: number; directories: number };
type WorkspaceScan = {
  buckets: Record<BucketName, BucketAccumulator>;
  totalBytes: number;
  totalFiles: number;
};

/**
 * 一次遍历同时算出四个桶和工作区总量。
 *
 * 案件数按 `cases/<id>` 的目录数算，不把材料子目录再算成案件。
 * 符号链接一律不跟进，避免把工作区外的大文件算进配额。
 */
function scanWorkspace(root: string): WorkspaceScan {
  const buckets: Record<BucketName, BucketAccumulator> = {
    cases: { bytes: 0, files: 0, directories: 0 },
    audit: { bytes: 0, files: 0, directories: 0 },
    sessions: { bytes: 0, files: 0, directories: 0 },
    drafts: { bytes: 0, files: 0, directories: 0 },
  };
  let totalBytes = 0;
  let totalFiles = 0;

  const visit = (abs: string, depth: number, bucket: BucketName | null): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(abs, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        if (depth === 0 && isBucketName(entry.name)) {
          visit(child, depth + 1, entry.name);
          continue;
        }
        if (bucket === "cases" && depth === 1) {
          buckets.cases.directories += 1;
        }
        visit(child, depth + 1, bucket);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      let size = 0;
      try {
        size = fs.statSync(child).size;
      } catch {
        // 文件刚被移走：不计入，不影响巡检。
        continue;
      }
      totalFiles += 1;
      totalBytes += size;
      if (bucket) {
        buckets[bucket].files += 1;
        buckets[bucket].bytes += size;
      }
    }
  };

  visit(root, 0, null);
  return { buckets, totalBytes, totalFiles };
}

function normalizeQuotaWarnRatio(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    return DEFAULT_QUOTA_WARN_RATIO;
  }
  return value;
}

export function summarizeWorkspaceStorageHealth(
  workspaceDir: string,
  thresholds: Partial<WorkspaceStorageThresholds> = {},
  quotaOptions: WorkspaceStorageQuotaOptions = {},
): WorkspaceStorageHealth {
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const root = path.resolve(workspaceDir);
  const scan = scanWorkspace(root);
  const buckets: WorkspaceStorageBucket[] = BUCKET_NAMES.map((name) => ({
    name,
    ...scan.buckets[name],
  }));
  const byName = new Map(buckets.map((bucket) => [bucket.name, bucket]));
  const cases = byName.get("cases")!;
  const audit = byName.get("audit")!;
  const sessions = byName.get("sessions")!;
  const drafts = byName.get("drafts")!;

  const lines: string[] = [];
  const warnings: string[] = [];
  if (cases.directories === 0 && sessions.files === 0 && drafts.files === 0) {
    lines.push("存储：工作区还没有案件/会话/草稿数据。");
  } else {
    lines.push(
      `存储：案件 ${cases.directories} 个 · 审计 ${formatBytes(audit.bytes)} · 会话 ${formatBytes(sessions.bytes)}（${sessions.files} 个文件）· 草稿 ${formatBytes(drafts.bytes)}。`,
    );
  }

  let quota: WorkspaceStorageQuota | undefined;
  const quotaBytes = quotaOptions.quotaBytes;
  if (typeof quotaBytes === "number" && Number.isFinite(quotaBytes) && quotaBytes > 0) {
    const limitBytes = Math.floor(quotaBytes);
    const warnRatio = normalizeQuotaWarnRatio(quotaOptions.warnRatio);
    const usedRatio = scan.totalBytes / limitBytes;
    const percent = Math.round(usedRatio * 100);
    quota = {
      limitBytes,
      usedBytes: scan.totalBytes,
      usedRatio,
      warnRatio,
      exceeded: scan.totalBytes > limitBytes,
    };
    lines.push(
      `存储：工作区合计 ${formatBytes(scan.totalBytes)}（配额 ${formatBytes(limitBytes)}，已用 ${percent}%）。`,
    );
    if (usedRatio >= warnRatio) {
      warnings.push(
        quota.exceeded
          ? `工作区已用 ${formatBytes(scan.totalBytes)}，超过配额 ${formatBytes(limitBytes)}（${percent}%）：先跑 pnpm lawmind:workspace:backup 再清理；配额只告警，不会拦住写入，别等磁盘写满。确实要放宽就调大 lawmind.policy.json 的 storage.quotaGb。`
          : `工作区已用 ${formatBytes(scan.totalBytes)}，达到配额 ${formatBytes(limitBytes)} 的 ${percent}%：先跑 pnpm lawmind:workspace:backup，再归档已结案材料；或调大 lawmind.policy.json 的 storage.quotaGb。`,
      );
    }
  }

  if (sessions.bytes > limits.sessionWarnBytes) {
    warnings.push(
      `会话 ${formatBytes(sessions.bytes)} 超过 ${formatBytes(limits.sessionWarnBytes)}：建议归档旧会话；先跑 pnpm lawmind:workspace:backup 再清理。`,
    );
  }
  if (audit.bytes > limits.auditWarnBytes) {
    warnings.push(
      `审计 ${formatBytes(audit.bytes)} 超过 ${formatBytes(limits.auditWarnBytes)}：按留存义务轮转按天文件；先备份。`,
    );
  }
  if (drafts.bytes > limits.draftWarnBytes) {
    warnings.push(
      `草稿 ${formatBytes(drafts.bytes)} 超过 ${formatBytes(limits.draftWarnBytes)}：归档已交付的老稿，保留本案当前版本。`,
    );
  }
  if (cases.directories > limits.caseWarnCount) {
    warnings.push(
      `案件 ${cases.directories} 个超过 ${limits.caseWarnCount}：桌面列表会变慢；先备份，再按年份归档已结案。`,
    );
  }
  if (warnings.length > 0) {
    lines.push(...warnings.map((warning) => `存储：${warning}`));
  }
  return {
    ok: warnings.length === 0,
    buckets,
    totalBytes: scan.totalBytes,
    totalFiles: scan.totalFiles,
    ...(quota ? { quota } : {}),
    lines,
    warnings,
  };
}
