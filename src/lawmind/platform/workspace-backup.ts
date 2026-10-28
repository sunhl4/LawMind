/**
 * 工作区备份 / 迁移：把律师工作区打成可校验的 zip，并能安全解回一个空目录。
 *
 * 设计边界：
 * - 默认排除密钥（`.env*`、`license.json`、`mail-secrets.json`）与派生/运行时目录；
 * - 归档根写 `BACKUP-MANIFEST.json`（文件清单、大小、排除项、是否含密钥）；
 * - 恢复只接受相对路径、拒绝 `..` / 绝对路径 / 盘符，且默认拒绝非空目标；
 * - 恢复不删除目标里已有文件，也不碰工作区外的 `~/.lawmind`。
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

export const WORKSPACE_BACKUP_SCHEMA_VERSION = 1;
export const WORKSPACE_BACKUP_MANIFEST_NAME = "BACKUP-MANIFEST.json";
export const WORKSPACE_BACKUP_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const WORKSPACE_BACKUP_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

export type WorkspaceBackupFile = {
  /** POSIX 相对路径。 */
  path: string;
  bytes: number;
};

export type WorkspaceBackupManifest = {
  schemaVersion: 1;
  createdAt: string;
  /** 只写工作区目录名，不写本机绝对路径。 */
  workspaceName: string;
  fileCount: number;
  totalBytes: number;
  includedRoots: string[];
  excluded: string[];
  secretsIncluded: boolean;
  warnings: string[];
  files: WorkspaceBackupFile[];
};

export type WorkspaceBackupPlan = {
  workspaceDir: string;
  files: WorkspaceBackupFile[];
  totalBytes: number;
  excluded: string[];
  warnings: string[];
};

export type WorkspaceBackupOptions = {
  includeSecrets?: boolean;
  maxFileBytes?: number;
  maxTotalBytes?: number;
};

export type CreateWorkspaceBackupInput = WorkspaceBackupOptions & {
  workspaceDir: string;
  outputPath?: string;
  now?: Date;
};

export type RestoreWorkspaceBackupInput = {
  archivePath: string;
  targetDir: string;
  /** 目标目录已有文件时是否继续；默认拒绝。 */
  force?: boolean;
};

export type RestoreWorkspaceBackupResult = {
  restoredFiles: number;
  skipped: string[];
  manifest: WorkspaceBackupManifest;
};

const ALWAYS_EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "release",
  ".cache",
  "tmp",
  "rounds",
  "lawmind/search-index",
  "lawmind/lint",
  "lawmind/decision",
]);

const ALWAYS_EXCLUDED_FILES = new Set([
  ".DS_Store",
  "lawmind/search-index.sqlite",
  "lawmind/search-index.sqlite-journal",
  "lawmind/search-index.sqlite-wal",
  "lawmind/search-index.sqlite-shm",
]);

const SECRET_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)license\.json$/,
  /(^|\/)mail-secrets\.json$/,
];

function isSecretPath(rel: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(rel));
}

function isExcludedDir(rel: string): boolean {
  return ALWAYS_EXCLUDED_DIRS.has(rel);
}

function isExcludedFile(rel: string): boolean {
  return ALWAYS_EXCLUDED_FILES.has(rel) || rel.endsWith("/.DS_Store");
}

function safeWorkspaceName(workspaceDir: string): string {
  return path.basename(path.resolve(workspaceDir)) || "workspace";
}

function includedRoots(files: readonly WorkspaceBackupFile[]): string[] {
  const roots = new Set<string>();
  for (const file of files) {
    const root = file.path.split("/")[0];
    if (root) {
      roots.add(root);
    }
  }
  return [...roots].toSorted();
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * 只做规划，不写盘。调用方可以先把清单给律师看，再决定是否打包。
 */
export function planWorkspaceBackup(
  workspaceDir: string,
  options: WorkspaceBackupOptions = {},
): WorkspaceBackupPlan {
  const root = path.resolve(workspaceDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error("workspace_not_a_directory");
  }
  const includeSecrets = options.includeSecrets === true;
  const maxFileBytes = normalizeLimit(options.maxFileBytes, WORKSPACE_BACKUP_MAX_FILE_BYTES);
  const maxTotalBytes = normalizeLimit(options.maxTotalBytes, WORKSPACE_BACKUP_MAX_TOTAL_BYTES);
  const files: WorkspaceBackupFile[] = [];
  const excluded: string[] = [];
  const warnings: string[] = [];

  const walk = (rel: string): void => {
    const abs = rel ? path.join(root, ...rel.split("/")) : root;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      warnings.push(`读不到，已跳过：${rel || "."}`);
      return;
    }
    if (stat.isSymbolicLink()) {
      warnings.push(`符号链接不打包：${rel}`);
      return;
    }
    if (stat.isDirectory()) {
      if (rel && isExcludedDir(rel)) {
        excluded.push(`${rel}/`);
        return;
      }
      for (const name of fs.readdirSync(abs).toSorted()) {
        walk(rel ? `${rel}/${name}` : name);
      }
      return;
    }
    if (!stat.isFile()) {
      return;
    }
    if (isExcludedFile(rel)) {
      excluded.push(rel);
      return;
    }
    if (!includeSecrets && isSecretPath(rel)) {
      excluded.push(rel);
      return;
    }
    if (stat.size > maxFileBytes) {
      excluded.push(rel);
      warnings.push(`单文件超过上限（${stat.size} bytes），已跳过：${rel}`);
      return;
    }
    files.push({ path: rel, bytes: stat.size });
  };

  walk("");
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (totalBytes > maxTotalBytes) {
    throw new Error(`workspace_backup_too_large:${totalBytes}`);
  }
  return {
    workspaceDir: root,
    files: files.toSorted((a, b) => a.path.localeCompare(b.path)),
    totalBytes,
    excluded: excluded.toSorted(),
    warnings,
  };
}

function defaultOutputPath(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return `lawmind-workspace-backup-${stamp}.zip`;
}

/**
 * 打包工作区。只写 zip，不修改工作区。
 */
export async function createWorkspaceBackup(
  input: CreateWorkspaceBackupInput,
): Promise<{ outputPath: string; manifest: WorkspaceBackupManifest }> {
  const now = input.now ?? new Date();
  const plan = planWorkspaceBackup(input.workspaceDir, input);
  const manifest: WorkspaceBackupManifest = {
    schemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    workspaceName: safeWorkspaceName(input.workspaceDir),
    fileCount: plan.files.length,
    totalBytes: plan.totalBytes,
    includedRoots: includedRoots(plan.files),
    excluded: plan.excluded,
    secretsIncluded: input.includeSecrets === true,
    warnings: plan.warnings,
    files: plan.files,
  };

  const zip = new JSZip();
  for (const file of plan.files) {
    const abs = path.join(plan.workspaceDir, ...file.path.split("/"));
    zip.file(file.path, await fsp.readFile(abs));
  }
  zip.file(WORKSPACE_BACKUP_MANIFEST_NAME, JSON.stringify(manifest, null, 2));

  const outputPath = path.resolve(input.outputPath?.trim() || defaultOutputPath(now));
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await fsp.writeFile(outputPath, buffer);
  return { outputPath, manifest };
}

function isSafeRelativePath(rel: string): boolean {
  if (!rel || rel.startsWith("/") || rel.includes("\\") || /^[A-Za-z]:/.test(rel)) {
    return false;
  }
  return rel.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function parseManifest(raw: string): WorkspaceBackupManifest {
  const parsed = JSON.parse(raw) as Partial<WorkspaceBackupManifest>;
  if (parsed.schemaVersion !== WORKSPACE_BACKUP_SCHEMA_VERSION) {
    throw new Error("unsupported_backup_schema");
  }
  if (!Array.isArray(parsed.files) || typeof parsed.createdAt !== "string") {
    throw new Error("invalid_backup_manifest");
  }
  return parsed as WorkspaceBackupManifest;
}

async function directoryHasEntries(dir: string): Promise<boolean> {
  try {
    return (await fsp.readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

/**
 * 恢复到目标目录。默认只接受空目录；`force` 只允许覆盖同名文件，不删除目标里已有内容。
 */
export async function restoreWorkspaceBackup(
  input: RestoreWorkspaceBackupInput,
): Promise<RestoreWorkspaceBackupResult> {
  const archivePath = path.resolve(input.archivePath);
  const zip = await JSZip.loadAsync(await fsp.readFile(archivePath));
  const manifestEntry = zip.file(WORKSPACE_BACKUP_MANIFEST_NAME);
  if (!manifestEntry) {
    throw new Error("backup_manifest_missing");
  }
  const manifest = parseManifest(await manifestEntry.async("string"));

  const target = path.resolve(input.targetDir);
  if (!input.force && (await directoryHasEntries(target))) {
    throw new Error("restore_target_not_empty");
  }
  await fsp.mkdir(target, { recursive: true });

  const skipped: string[] = [];
  let restoredFiles = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) {
      continue;
    }
    const rel = entry.name;
    if (rel === WORKSPACE_BACKUP_MANIFEST_NAME) {
      // 清单也落盘，便于事后核对；路径固定，不参与遍历校验。
      await fsp.writeFile(
        path.join(target, WORKSPACE_BACKUP_MANIFEST_NAME),
        await entry.async("nodebuffer"),
      );
      continue;
    }
    if (!isSafeRelativePath(rel)) {
      throw new Error(`unsafe_backup_path:${rel}`);
    }
    const dest = path.resolve(target, ...rel.split("/"));
    if (dest !== target && !dest.startsWith(`${target}${path.sep}`)) {
      throw new Error(`unsafe_backup_path:${rel}`);
    }
    try {
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, await entry.async("nodebuffer"));
      restoredFiles += 1;
    } catch {
      skipped.push(rel);
    }
  }
  return { restoredFiles, skipped, manifest };
}
