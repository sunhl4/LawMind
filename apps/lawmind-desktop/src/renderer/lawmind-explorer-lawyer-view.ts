/**
 * 资源管理器（律师向）：
 * - 「工作区」：律师本机文件夹（project root），不展示软件内部数据目录
 * - 「案件材料」：cases 下卷宗
 * 系统/引擎目录与配置文件隐藏；可配置项走「设置」表单。
 */

export type ExplorerRootKey = "workspace" | "project";

/** 路径任一层出现这些目录名则整支隐藏。 */
const HIDDEN_DIR_SEGMENTS = new Set(
  [
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    "out-next",
    ".next",
    "out",
    ".turbo",
    ".cache",
    ".vscode",
    ".idea",
    "audit",
    "memory",
    "sessions",
    "delegations",
    /** 引擎 / 产品内部目录：不对律师在文件树中暴露。 */
    "mail",
    "deliverables",
    "drafts",
    "tasks",
    "lawmind",
    "templates",
    "playbooks",
    "artifacts",
  ].map((s) => s.toLowerCase()),
);

/** 工作区根上隐藏的配置/系统文件（非律师日常文档）。 */
const HIDDEN_WORKSPACE_ROOT_FILES = new Set(
  [
    "assistants.json",
    "integrations.json",
    "memory.md",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "tsconfig.json",
    "tsconfig.node.json",
    "vite.config.ts",
    "vitest.config.ts",
    "eslint.config.js",
    ".eslintrc.cjs",
    ".npmrc",
    "readme.md",
  ].map((s) => s.toLowerCase()),
);

/** 案件目录下对律师隐藏的系统文件名。 */
const HIDDEN_MATTER_LEAF_NAMES = new Set(
  [
    "matter.json",
    "approvals.jsonl",
    "queue.jsonl",
    "deadlines.jsonl",
    "assistants.json",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
  ].map((s) => s.toLowerCase()),
);

const HIDDEN_LAWYER_LEAF_NAMES = new Set([".ds_store", "thumbs.db"]);

const TECH_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".rs",
  ".go",
  ".py",
  ".rb",
  ".java",
  ".kt",
  ".swift",
  ".map",
  ".jsonl",
]);

function normalizeRel(relPath: string): string {
  return relPath.replace(/^\/+/, "").replace(/\\/g, "/");
}

export function pathHasHiddenSegment(relPath: string): boolean {
  const segments = normalizeRel(relPath).toLowerCase().split("/").filter(Boolean);
  for (const seg of segments) {
    if (seg.startsWith(".") && seg !== "." && seg !== "..") {
      return true;
    }
    if (HIDDEN_DIR_SEGMENTS.has(seg)) {
      return true;
    }
  }
  return false;
}

/** 是否落在案件材料树（`cases/`）下。 */
export function isLawyerCasesPath(relPath: string): boolean {
  const norm = normalizeRel(relPath).toLowerCase();
  return norm === "cases" || norm.startsWith("cases/");
}

/** @deprecated 使用 isLawyerCasesPath；保留别名以免旧引用断裂。 */
export const isLawyerWorkspaceMaterialPath = isLawyerCasesPath;

function techExtensionHidden(name: string): boolean {
  const i = name.lastIndexOf(".");
  if (i <= 0) {
    return false;
  }
  return TECH_SOURCE_EXTENSIONS.has(name.slice(i).toLowerCase());
}

export function shouldShowExplorerFile(root: ExplorerRootKey, relPath: string): boolean {
  if (pathHasHiddenSegment(relPath)) {
    return false;
  }
  const name = normalizeRel(relPath).split("/").filter(Boolean).pop() ?? relPath;
  if (name && HIDDEN_LAWYER_LEAF_NAMES.has(name.toLowerCase())) {
    return false;
  }
  if (HIDDEN_MATTER_LEAF_NAMES.has(name.toLowerCase())) {
    return false;
  }

  const parent = normalizeRel(relPath);
  const slash = parent.lastIndexOf("/");
  const dir = slash >= 0 ? parent.slice(0, slash) : "";

  if (root === "workspace" && !dir) {
    if (name.startsWith(".") || HIDDEN_WORKSPACE_ROOT_FILES.has(name.toLowerCase())) {
      return false;
    }
  }

  return !techExtensionHidden(name);
}

export function shouldShowExplorerDirectory(_root: ExplorerRootKey, dirRelPath: string): boolean {
  return !pathHasHiddenSegment(dirRelPath);
}

export type FsEntryLite = { name: string; path: string; kind: "file" | "directory" };

export function filterExplorerEntries(
  root: ExplorerRootKey,
  _parentRelPath: string,
  entries: FsEntryLite[],
): FsEntryLite[] {
  return entries.filter((e) => {
    if (e.kind === "directory") {
      return shouldShowExplorerDirectory(root, e.path);
    }
    return shouldShowExplorerFile(root, e.path);
  });
}
