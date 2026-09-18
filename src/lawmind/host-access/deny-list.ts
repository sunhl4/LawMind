/**
 * Hard deny list for host access. Grants cannot override these paths.
 */

import os from "node:os";
import path from "node:path";
import { isUnderRoot, realpathOrResolve } from "./paths.js";

const DENY_BASENAMES = new Set([
  ".env",
  ".env.lawmind",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "mail-secrets.json",
  "lawmind.policy.json",
  "ethics-wall.json",
]);

const DENY_EXTENSIONS = new Set([".pem", ".p12", ".pfx", ".key"]);

const DENY_DIR_NAMES = new Set([".ssh", ".gnupg", "Keychains", "Cookies"]);

const WORKSPACE_DENY_PREFIXES = ["audit/", "sessions/", "lawmind/"];

export function defaultSensitiveHomeDirs(homeDir = os.homedir()): string[] {
  const home = path.resolve(homeDir);
  return [
    path.join(home, ".ssh"),
    path.join(home, ".gnupg"),
    path.join(home, "Library", "Keychains"),
    path.join(home, "Library", "Cookies"),
  ];
}

function basenameLower(p: string): string {
  return path.basename(p).toLowerCase();
}

function matchesGlobish(pattern: string, absPosix: string, base: string): boolean {
  const p = pattern.trim().replace(/\\/g, "/");
  if (!p) {
    return false;
  }
  if (p.startsWith("**/")) {
    const rest = p.slice(3);
    if (rest.startsWith(".")) {
      return base === rest || base.startsWith(`${rest}.`) || base.startsWith(rest);
    }
    return absPosix.endsWith(`/${rest}`) || base === rest;
  }
  return absPosix.includes(p.replace(/^\//, ""));
}

export function isDeniedHostPath(
  absPath: string,
  opts?: { homeDir?: string; extraPatterns?: string[] },
): boolean {
  if (!absPath?.trim()) {
    return true;
  }
  const real = realpathOrResolve(absPath);
  const posix = real.replace(/\\/g, "/");
  const base = path.basename(real);
  const baseLower = basenameLower(real);
  const ext = path.extname(real).toLowerCase();

  if (base.startsWith(".env")) {
    return true;
  }
  if (DENY_BASENAMES.has(base) || DENY_BASENAMES.has(baseLower)) {
    return true;
  }
  if (DENY_EXTENSIONS.has(ext)) {
    return true;
  }
  const parts = posix.split("/").filter(Boolean);
  if (parts.some((seg) => DENY_DIR_NAMES.has(seg))) {
    return true;
  }
  for (const dir of defaultSensitiveHomeDirs(opts?.homeDir)) {
    if (isUnderRoot(dir, real)) {
      return true;
    }
  }
  const relHint = posix.toLowerCase();
  if (hitsWorkspaceDenyPrefix(relHint)) {
    return true;
  }
  for (const pattern of opts?.extraPatterns ?? []) {
    if (matchesGlobish(pattern, posix, base)) {
      return true;
    }
  }
  return false;
}

/**
 * Host paths that look like LawMind governance trees (…/lawmind/…, …/audit/…).
 * Do not treat documentation trees like …/docs/lawmind/… as secrets.
 */
function hitsWorkspaceDenyPrefix(posixLower: string): boolean {
  for (const prefix of WORKSPACE_DENY_PREFIXES) {
    const needle = `/${prefix}`;
    let from = 0;
    while (from < posixLower.length) {
      const at = posixLower.indexOf(needle, from);
      if (at < 0) {
        break;
      }
      if (prefix === "lawmind/") {
        const before = posixLower.slice(0, at);
        if (before.endsWith("/docs") || before === "docs") {
          from = at + 1;
          continue;
        }
      }
      return true;
    }
  }
  return (
    posixLower.endsWith("/audit") ||
    posixLower.endsWith("/sessions") ||
    (posixLower.endsWith("/lawmind") && !posixLower.endsWith("/docs/lawmind"))
  );
}

export function denyListMessage(): string {
  return "该路径属于密钥、钥匙串或治理数据，不能读取。请把需要的材料复制到本案或本机文件夹后再交办。";
}
