/**
 * 资源管理器（律师向）：只展示案件与材料相关树，隐藏系统目录与源码类文件。
 */

export type ExplorerRootKey = "workspace" | "project";

/** 路径任一层出现这些目录名则整支隐藏（工作区 / 项目均适用）。 */
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
  ].map((s) => s.toLowerCase()),
);

const HIDDEN_WORKSPACE_ROOT_FILES = new Set(
  [
    "assistants.json",
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
  ].map((s) => s.toLowerCase()),
);

const LAWYER_MATERIAL_PREFIXES = ["cases/", "artifacts/", "templates/", "playbooks/"];

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
]);

const HIDDEN_LAWYER_LEAF_NAMES = new Set([".ds_store", "thumbs.db"]);

export function pathHasHiddenSegment(relPath: string): boolean {
  const norm = relPath.replace(/^\/+/, "").toLowerCase();
  const segments = norm.split("/").filter(Boolean);
  for (const seg of segments) {
    const base = seg.split("\\").pop() ?? seg;
    if (base.startsWith(".") && base !== "." && base !== "..") {
      if (
        base === ".lawmind-role.txt" ||
        base.startsWith(".lawmind-") ||
        base === ".trae" ||
        base === ".cursor"
      ) {
        return true;
      }
    }
    if (HIDDEN_DIR_SEGMENTS.has(base)) {
      return true;
    }
  }
  return false;
}

function underLawyerMaterialPrefix(relPath: string): boolean {
  const norm = relPath.replace(/^\/+/, "");
  const low = norm.toLowerCase();
  for (const p of LAWYER_MATERIAL_PREFIXES) {
    if (low === p.slice(0, -1) || low.startsWith(p)) {
      return true;
    }
  }
  return false;
}

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
  const name = relPath.split(/[/\\]/).filter(Boolean).pop() ?? relPath;
  if (name && HIDDEN_LAWYER_LEAF_NAMES.has(name.toLowerCase())) {
    return false;
  }
  const parent = relPath.replace(/^\/+/, "");
  const slash = parent.lastIndexOf("/");
  const dir = slash >= 0 ? parent.slice(0, slash) : "";

  if (root === "workspace" && !dir) {
    if (name.startsWith(".") || HIDDEN_WORKSPACE_ROOT_FILES.has(name.toLowerCase())) {
      return false;
    }
  }

  if (underLawyerMaterialPrefix(relPath)) {
    return true;
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
