import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isDeniedHostPath } from "./deny-list.js";
import { searchHostIndex } from "./host-index.js";
import { activeMountsForSession } from "./matter-fence.js";
import { isUnderRoot, newHostId, redactHostPath } from "./paths.js";
import type { HostAccessRuntime, HostSearchHit } from "./types.js";

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  ".svn",
  "dist",
  "release",
  "__pycache__",
  ".lawmind",
]);
const MAX_WALK_FILES = 800;
const MAX_WALK_DEPTH = 8;

function shouldSkipDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIR.has(name);
}

function walkMountFiles(root: string, maxFiles: number): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (out.length >= maxFiles || depth > MAX_WALK_DEPTH) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) {
        return;
      }
      if (ent.isSymbolicLink()) {
        continue;
      }
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name)) {
          continue;
        }
        visit(abs, depth + 1);
        continue;
      }
      if (ent.isFile()) {
        out.push(abs);
      }
    }
  };
  visit(path.resolve(root), 0);
  return out;
}

function statSafe(abs: string): { size?: number; mtimeMs?: number } {
  try {
    const st = fs.statSync(abs);
    return { size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return {};
  }
}

function hitFromAbs(
  abs: string,
  opts: { authorized: boolean; mountId?: string; matterId?: string; snippet?: string },
): HostSearchHit {
  const redacted = redactHostPath(abs);
  const ext = path.extname(abs);
  const st = statSafe(abs);
  return {
    hitId: newHostId("hit"),
    displayName: redacted.displayName,
    parentName: redacted.parentName,
    ext,
    ...st,
    absPath: opts.authorized ? abs : undefined,
    locateAbs: opts.authorized ? undefined : abs,
    mountId: opts.mountId,
    matterId: opts.matterId,
    needsGrant: !opts.authorized,
    snippet: opts.authorized ? opts.snippet : undefined,
  };
}

function queryMatches(abs: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return false;
  }
  const base = path.basename(abs).toLowerCase();
  if (base.includes(q)) {
    return true;
  }
  const ext = path.extname(abs).toLowerCase();
  return q === ext || q === ext.slice(1);
}

export function searchMountsByName(
  runtime: HostAccessRuntime,
  query: string,
  limit = 20,
): HostSearchHit[] {
  const { active } = activeMountsForSession({
    mounts: runtime.mounts,
    workspaceDir: runtime.workspaceDir,
    sessionMatterId: runtime.matterId,
    allowCrossMatterMounts: runtime.policy.allowCrossMatterMounts,
    mode: runtime.policy.mode === "matter" ? "matter" : "mounts",
  });
  const hits: HostSearchHit[] = [];
  for (const mount of active) {
    for (const abs of walkMountFiles(mount.absPath, MAX_WALK_FILES)) {
      if (
        isDeniedHostPath(abs, {
          homeDir: runtime.homeDir,
          extraPatterns: runtime.policy.denyPathPatterns,
        })
      ) {
        continue;
      }
      if (!queryMatches(abs, query)) {
        continue;
      }
      hits.push(
        hitFromAbs(abs, {
          authorized: true,
          mountId: mount.id,
          matterId: mount.matterId,
        }),
      );
      if (hits.length >= limit) {
        return hits;
      }
    }
  }
  return hits;
}

function parseMdfindQuery(query: string): string {
  const cleaned = query.replace(/["'\\]/g, " ").trim();
  return cleaned.slice(0, 80);
}

export function searchSpotlight(query: string, onlyIn?: string[], limit = 20): string[] {
  if (process.platform !== "darwin") {
    return [];
  }
  const q = parseMdfindQuery(query);
  if (!q) {
    return [];
  }
  const args = onlyIn?.length ? ["-onlyin", onlyIn[0], q] : [q];
  try {
    const res = spawnSync("mdfind", args, { encoding: "utf8", timeout: 4000 });
    if (res.status !== 0 || !res.stdout) {
      return [];
    }
    return res.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function searchWindows(query: string, roots: string[], limit = 20): string[] {
  const q = parseMdfindQuery(query).toLowerCase();
  if (!q) {
    return [];
  }
  const out: string[] = [];
  for (const root of roots) {
    for (const abs of walkMountFiles(root, MAX_WALK_FILES)) {
      if (path.basename(abs).toLowerCase().includes(q)) {
        out.push(abs);
        if (out.length >= limit) {
          return out;
        }
      }
    }
  }
  return out;
}

export function searchHost(runtime: HostAccessRuntime, query: string, limit = 16): HostSearchHit[] {
  const q = query.trim();
  if (!q) {
    return [];
  }
  const seen = new Set<string>();
  const out: HostSearchHit[] = [];
  const push = (hit: HostSearchHit, key: string): void => {
    if (seen.has(key) || out.length >= limit) {
      return;
    }
    seen.add(key);
    out.push(hit);
  };

  for (const hit of searchMountsByName(runtime, q, limit)) {
    push(hit, hit.absPath ?? `${hit.displayName}:${hit.parentName}`);
  }
  for (const hit of searchHostIndex(runtime, q, limit)) {
    push(hit, hit.absPath ?? `${hit.displayName}:${hit.parentName}`);
  }

  const locate = runtime.policy.mode === "locate" || runtime.policy.mode === "command";
  if (runtime.policy.spotlightEnabled && (locate || runtime.policy.fullDiskAccessOptIn)) {
    const { active } = activeMountsForSession({
      mounts: runtime.mounts,
      workspaceDir: runtime.workspaceDir,
      sessionMatterId: runtime.matterId,
      allowCrossMatterMounts: runtime.policy.allowCrossMatterMounts,
      mode: "mounts",
    });
    const authorizedRoots = [runtime.workspaceDir, ...active.map((m) => m.absPath)];
    const rawHits =
      process.platform === "darwin"
        ? searchSpotlight(q, undefined, limit)
        : process.platform === "win32"
          ? searchWindows(q, authorizedRoots, limit)
          : [];
    for (const abs of rawHits) {
      if (
        isDeniedHostPath(abs, {
          homeDir: runtime.homeDir,
          extraPatterns: runtime.policy.denyPathPatterns,
        })
      ) {
        continue;
      }
      const authorized = authorizedRoots.some((root) => isUnderRoot(root, abs));
      push(
        hitFromAbs(abs, { authorized }),
        authorized ? abs : `${path.basename(abs)}:${path.basename(path.dirname(abs))}`,
      );
    }
  }

  return out.slice(0, limit);
}
