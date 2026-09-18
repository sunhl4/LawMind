/**
 * Session grants for directories the lawyer picked in a native dialog.
 * Renderer-supplied paths to set-project-dir / add-host-folder must match.
 */

import fs from "node:fs";
import path from "node:path";

const MAX_GRANTS = 64;

/** @type {Set<string>} */
const grants = new Set();

function realpathOrResolve(raw) {
  const abs = path.resolve(raw);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

function rememberNormalized(abs) {
  grants.add(abs);
  while (grants.size > MAX_GRANTS) {
    const first = grants.values().next().value;
    if (first === undefined) {
      break;
    }
    grants.delete(first);
  }
}

/** Record a directory returned by showOpenDialog. */
export function rememberPickerPath(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  const resolved = path.resolve(raw.trim());
  rememberNormalized(resolved);
  rememberNormalized(realpathOrResolve(raw.trim()));
  return realpathOrResolve(raw.trim());
}

export function isPickerGrantedPath(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return false;
  }
  const resolved = path.resolve(raw.trim());
  if (grants.has(resolved) || grants.has(realpathOrResolve(raw.trim()))) {
    return true;
  }
  return false;
}

/**
 * Null / blank clears the project dir. Any other path must have been picked.
 * @param {unknown} nextPath
 * @returns {{ ok: true, abs: string | null } | { ok: false, error: string }}
 */
export function resolveGrantedProjectDir(nextPath) {
  if (nextPath === null || nextPath === undefined) {
    return { ok: true, abs: null };
  }
  if (typeof nextPath !== "string") {
    return { ok: false, error: "请用系统对话框选择文件夹。" };
  }
  const trimmed = nextPath.trim();
  if (!trimmed) {
    return { ok: true, abs: null };
  }
  if (!isPickerGrantedPath(trimmed)) {
    return { ok: false, error: "请用系统对话框选择文件夹。" };
  }
  const abs = realpathOrResolve(trimmed);
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      return { ok: false, error: "invalid project directory" };
    }
  } catch {
    return { ok: false, error: "invalid project directory" };
  }
  return { ok: true, abs };
}

/** @param {unknown} raw */
export function resolveGrantedHostFolder(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "invalid folder" };
  }
  if (!isPickerGrantedPath(raw)) {
    return { ok: false, error: "请用系统对话框选择文件夹。" };
  }
  const abs = realpathOrResolve(raw.trim());
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      return { ok: false, error: "invalid folder" };
    }
  } catch {
    return { ok: false, error: "invalid folder" };
  }
  return { ok: true, abs };
}

/** Tests only. */
export function resetPickerPathGrants() {
  grants.clear();
}
