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
  opts?: { homeDir?: string; extraPatterns?: string[]; workspaceDir?: string },
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
  if (isGovernancePath(real, opts?.workspaceDir)) {
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
 * Governance trees are `audit/`, `sessions/`, and `lawmind/` inside the
 * workspace. The desktop data directory is also named LawMind
 * (`…/Application Support/LawMind/workspace`), so an absolute-path scan would
 * refuse every case file. When `workspaceDir` is known and the path sits
 * inside it, only the workspace-relative path counts.
 * Do not treat documentation trees like …/docs/lawmind/… as secrets.
 */
function isGovernancePath(realAbs: string, workspaceDir?: string): boolean {
  if (workspaceDir?.trim()) {
    const root = realpathOrResolve(workspaceDir);
    if (isUnderRoot(root, realAbs)) {
      const rel = path.relative(root, realpathOrResolve(realAbs)).replace(/\\/g, "/").toLowerCase();
      return governanceRelDenied(rel);
    }
  }
  return hitsWorkspaceDenyPrefix(realAbs.replace(/\\/g, "/").toLowerCase());
}

function governanceRelDenied(relLower: string): boolean {
  const rel = relLower.replace(/^\.\//, "");
  if (!rel || rel === ".") {
    return false;
  }
  if (rel === "docs/lawmind" || rel.startsWith("docs/lawmind/")) {
    return false;
  }
  for (const prefix of WORKSPACE_DENY_PREFIXES) {
    const bare = prefix.slice(0, -1);
    if (rel === bare || rel.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

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
