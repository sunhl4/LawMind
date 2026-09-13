/**
 * Copy lawyer-dropped files that sit outside the workspace/project into
 * `uploads/` or `cases/<matterId>/materials/` so chat tools can read them.
 */

import fs from "node:fs";
import path from "node:path";

export const MAX_DROPPED_IMPORT_BYTES = 200 * 1024 * 1024;
export const MAX_DROPPED_DIR_FILES = 200;
export const MAX_DROPPED_DIR_DEPTH = 8;
export const MAX_DROPPED_DIR_TOTAL_BYTES = 500 * 1024 * 1024;

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".svn",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".lawmind",
  ".vite",
  "release",
]);

/**
 * @param {string | null | undefined} matterId
 * @param {string} fileName
 */
export function destRelForDroppedFile(matterId, fileName) {
  const base = safeBasename(fileName);
  if (!base) {
    return null;
  }
  const id = typeof matterId === "string" ? matterId.trim() : "";
  if (id && isUsableMatterId(id)) {
    return `cases/${id}/materials/${base}`;
  }
  return `uploads/${base}`;
}

function realpathOrResolve(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * @param {string | null | undefined} rootDir
 * @param {string} absPath
 * @param {"workspace" | "project"} root
 */
export function mapAbsUnderRoot(rootDir, absPath, root) {
  if (!rootDir || typeof rootDir !== "string" || !rootDir.trim()) {
    return null;
  }
  const rootResolved = realpathOrResolve(rootDir.trim());
  const abs = realpathOrResolve(absPath);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return null;
  }
  const rel = path.relative(rootResolved, abs).replace(/\\/g, "/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  let kind = "file";
  try {
    kind = fs.statSync(abs).isDirectory() ? "directory" : "file";
  } catch {
    return null;
  }
  if (!rel && kind !== "directory") {
    return null;
  }
  return { root, relPath: rel, kind };
}

function isPathInside(parentAbs, childAbs) {
  const parent = realpathOrResolve(parentAbs);
  const child = path.resolve(childAbs);
  return child === parent || child.startsWith(parent + path.sep);
}

/**
 * @param {string} fileName
 */
export function safeBasename(fileName) {
  let base = "";
  for (const ch of path.basename(String(fileName || ""))) {
    if (ch.charCodeAt(0) >= 32) {
      base += ch;
    }
  }
  base = base.trim();
  if (!base || base === "." || base === "..") {
    return null;
  }
  if (base.includes("/") || base.includes("\\") || base.includes("\0")) {
    return null;
  }
  return base;
}

/**
 * @param {string | null | undefined} id
 */
export function isUsableMatterId(id) {
  const t = typeof id === "string" ? id.trim() : "";
  if (t.length < 2 || t.length > 128) {
    return false;
  }
  return !t.includes("..") && !t.includes("/") && !t.includes("\\") && !t.includes("\0");
}

/**
 * @param {string} destDir
 * @param {string} fileName
 */
export function allocateNonCollidingAbs(destDir, fileName) {
  const base = safeBasename(fileName);
  if (!base) {
    return null;
  }
  const parsed = path.parse(base);
  let candidate = path.join(destDir, base);
  let n = 0;
  while (fs.existsSync(candidate)) {
    n += 1;
    const nextName = parsed.ext ? `${parsed.name} (${n})${parsed.ext}` : `${parsed.name} (${n})`;
    candidate = path.join(destDir, nextName);
  }
  return candidate;
}

/**
 * @param {string} srcRoot
 * @param {string} destRoot
 * @returns {{ ok: true; files: number; truncated: boolean } | { ok: false; error: string }}
 */
function copyDirectoryTree(srcRoot, destRoot) {
  const srcAbs = realpathOrResolve(srcRoot);
  let files = 0;
  let bytes = 0;
  let truncated = false;
  const visit = (srcDir, destDir, depth) => {
    if (truncated || depth > MAX_DROPPED_DIR_DEPTH) {
      if (depth > MAX_DROPPED_DIR_DEPTH) {
        truncated = true;
      }
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(srcDir, { withFileTypes: true });
    } catch {
      return;
    }
    fs.mkdirSync(destDir, { recursive: true });
    for (const ent of entries) {
      if (truncated) {
        return;
      }
      if (ent.isSymbolicLink()) {
        continue;
      }
      const src = path.join(srcDir, ent.name);
      const dest = path.join(destDir, ent.name);
      const destRel = path.relative(destRoot, dest);
      if (destRel.startsWith("..") || path.isAbsolute(destRel)) {
        continue;
      }
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name) || ent.name.startsWith(".")) {
          continue;
        }
        visit(src, dest, depth + 1);
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      if (files >= MAX_DROPPED_DIR_FILES) {
        truncated = true;
        return;
      }
      let size = 0;
      try {
        size = fs.statSync(src).size;
      } catch {
        continue;
      }
      if (size > MAX_DROPPED_IMPORT_BYTES) {
        continue;
      }
      if (bytes + size > MAX_DROPPED_DIR_TOTAL_BYTES) {
        truncated = true;
        return;
      }
      fs.copyFileSync(src, dest);
      files += 1;
      bytes += size;
    }
  };
  try {
    visit(srcAbs, destRoot, 0);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (files === 0 && !truncated) {
    return { ok: false, error: `文件夹「${path.basename(srcAbs)}」里没有可导入的文件。` };
  }
  return { ok: true, files, truncated };
}

/**
 * @param {{
 *   workspaceDir: string;
 *   absPath: string;
 *   matterId?: string | null;
 * }} opts
 * @returns {{
 *   ok: true;
 *   root: "workspace";
 *   relPath: string;
 *   kind: "file" | "directory";
 *   imported: true;
 *   truncated?: boolean;
 * } | { ok: false; error: string }}
 */
export function importDroppedAbsPath(opts) {
  const workspaceDir = typeof opts.workspaceDir === "string" ? opts.workspaceDir.trim() : "";
  const absPath = typeof opts.absPath === "string" ? path.resolve(opts.absPath.trim()) : "";
  if (!workspaceDir) {
    return { ok: false, error: "未配置工作区，无法收进文件。" };
  }
  if (!absPath) {
    return { ok: false, error: "缺少文件路径。" };
  }

  const existing =
    mapAbsUnderRoot(workspaceDir, absPath, "workspace") ??
    mapAbsUnderRoot(opts.projectDir, absPath, "project");
  if (existing) {
    return { ok: true, ...existing, imported: false };
  }

  let st;
  try {
    st = fs.statSync(absPath);
  } catch {
    return { ok: false, error: `找不到文件：${path.basename(absPath)}` };
  }
  if (st.isDirectory()) {
    const relHint = destRelForDroppedFile(opts.matterId, absPath);
    if (!relHint) {
      return { ok: false, error: "无法识别文件夹名。" };
    }
    const destParent = path.join(workspaceDir, path.dirname(relHint));
    const destAbs = allocateNonCollidingAbs(destParent, path.basename(relHint));
    if (!destAbs) {
      return { ok: false, error: "无法识别文件夹名。" };
    }
    const destRel = path.relative(workspaceDir, destAbs).replace(/\\/g, "/");
    if (destRel.startsWith("..") || path.isAbsolute(destRel)) {
      return { ok: false, error: "目标路径超出工作区。" };
    }
    if (isPathInside(absPath, destAbs) || isPathInside(destAbs, absPath)) {
      return {
        ok: false,
        error:
          "该文件夹与当前工作区互相包含，无法整夹复制。请在设置中把它加为本机文件夹，或只拖入其中的子文件夹。",
      };
    }
    const copied = copyDirectoryTree(absPath, destAbs);
    if (!copied.ok) {
      return copied;
    }
    return {
      ok: true,
      root: "workspace",
      relPath: destRel,
      kind: "directory",
      imported: true,
      truncated: copied.truncated,
    };
  }
  if (!st.isFile()) {
    return { ok: false, error: `${path.basename(absPath)} 不是普通文件。` };
  }
  if (st.size > MAX_DROPPED_IMPORT_BYTES) {
    return { ok: false, error: `${path.basename(absPath)} 超过 200MB，请先放到工作区后再引用。` };
  }

  const relHint = destRelForDroppedFile(opts.matterId, absPath);
  if (!relHint) {
    return { ok: false, error: "无法识别文件名。" };
  }
  const destDir = path.join(workspaceDir, path.dirname(relHint));
  const destAbs = allocateNonCollidingAbs(destDir, path.basename(relHint));
  if (!destAbs) {
    return { ok: false, error: "无法识别文件名。" };
  }
  const destRel = path.relative(workspaceDir, destAbs).replace(/\\/g, "/");
  if (destRel.startsWith("..") || path.isAbsolute(destRel)) {
    return { ok: false, error: "目标路径超出工作区。" };
  }

  try {
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(absPath, destAbs);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, root: "workspace", relPath: destRel, kind: "file", imported: true };
}

/**
 * @param {{
 *   workspaceDir: string;
 *   absPaths: string[];
 *   matterId?: string | null;
 *   maxItems?: number;
 * }} opts
 */
export function importDroppedAbsPaths(opts) {
  const absPaths = Array.isArray(opts.absPaths) ? opts.absPaths : [];
  const maxItems = typeof opts.maxItems === "number" && opts.maxItems > 0 ? opts.maxItems : 8;
  const items = [];
  const errors = [];
  for (const raw of absPaths.slice(0, maxItems)) {
    const result = importDroppedAbsPath({
      workspaceDir: opts.workspaceDir,
      projectDir: opts.projectDir,
      absPath: raw,
      matterId: opts.matterId,
    });
    if (result.ok) {
      items.push({
        root: result.root,
        relPath: result.relPath,
        kind: result.kind,
        imported:  result.imported,
      });
      if (result.truncated === true) {
        errors.push(`文件夹「${path.basename(result.relPath)}」未全部导入（超过数量或体积上限），已导入部分仍可阅读。`);
      }
    } else {
      errors.push(result.error);
    }
  }
  return { ok: errors.length === 0, items, errors };
}
