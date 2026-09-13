import fs from "node:fs";
import path from "node:path";
import { isDeniedHostPath } from "./deny-list.js";
import { activeMountsForSession } from "./matter-fence.js";
import { newHostId, redactHostPath } from "./paths.js";
import type { HostAccessRuntime, HostSearchHit } from "./types.js";

const TEXT_EXT = new Set([".md", ".txt", ".json", ".csv", ".html", ".xml", ".log", ".tex"]);
const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  ".svn",
  "dist",
  "release",
  "__pycache__",
  ".lawmind",
]);
const MAX_FILES_PER_MOUNT = 4000;
const MAX_BODY_CHARS = 32_000;
const MAX_INDEX_DEPTH = 8;

export type HostIndexFile = {
  rel: string;
  name: string;
  ext: string;
  size: number;
  mtimeMs: number;
  body?: string;
};

export type HostIndexState = {
  schemaVersion: 1;
  mounts: Record<string, { absPath: string; files: HostIndexFile[] }>;
};

function indexPath(runtime: HostAccessRuntime): string {
  const dir = runtime.indexDir ?? path.join(path.dirname(runtime.storePath ?? "."), "host-index");
  return path.join(dir, "host-index.json");
}

function readIndex(file: string): HostIndexState {
  try {
    if (!fs.existsSync(file)) {
      return { schemaVersion: 1, mounts: {} };
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as HostIndexState;
    if (raw?.schemaVersion !== 1 || !raw.mounts) {
      return { schemaVersion: 1, mounts: {} };
    }
    return raw;
  } catch {
    return { schemaVersion: 1, mounts: {} };
  }
}

function walkIndexFiles(
  root: string,
  runtime: HostAccessRuntime,
  includeBody: boolean,
): HostIndexFile[] {
  const files: HostIndexFile[] = [];
  const visit = (dir: string, relDir: string, depth: number): void => {
    if (files.length >= MAX_FILES_PER_MOUNT || depth > MAX_INDEX_DEPTH) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (files.length >= MAX_FILES_PER_MOUNT) {
        return;
      }
      if (ent.isSymbolicLink()) {
        continue;
      }
      const abs = path.join(dir, ent.name);
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (ent.name.startsWith(".") || SKIP_DIR.has(ent.name)) {
          continue;
        }
        visit(abs, rel, depth + 1);
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      if (
        isDeniedHostPath(abs, {
          homeDir: runtime.homeDir,
          extraPatterns: runtime.policy.denyPathPatterns,
        })
      ) {
        continue;
      }
      try {
        const st = fs.statSync(abs);
        const ext = path.extname(ent.name).toLowerCase();
        let body: string | undefined;
        if (includeBody && TEXT_EXT.has(ext) && st.size <= MAX_BODY_CHARS) {
          body = fs.readFileSync(abs, "utf8").slice(0, MAX_BODY_CHARS);
        }
        files.push({
          rel,
          name: ent.name,
          ext,
          size: st.size,
          mtimeMs: st.mtimeMs,
          body,
        });
      } catch {
        /* skip unreadable */
      }
    }
  };
  visit(path.resolve(root), "", 0);
  return files;
}

export function rebuildHostIndex(runtime: HostAccessRuntime): { mounts: number; files: number } {
  const { active } = activeMountsForSession({
    mounts: runtime.mounts,
    workspaceDir: runtime.workspaceDir,
    sessionMatterId: runtime.matterId,
    allowCrossMatterMounts: runtime.policy.allowCrossMatterMounts,
    mode: runtime.policy.mode === "matter" ? "matter" : "mounts",
  });
  const includeBody = runtime.policy.indexBodyInAppSupport;
  const state: HostIndexState = { schemaVersion: 1, mounts: {} };
  let files = 0;
  for (const mount of active) {
    const list = walkIndexFiles(mount.absPath, runtime, includeBody);
    state.mounts[mount.id] = { absPath: path.resolve(mount.absPath), files: list };
    files += list.length;
  }
  const file = indexPath(runtime);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state)}\n`, "utf8");
  return { mounts: active.length, files };
}

export function searchHostIndex(
  runtime: HostAccessRuntime,
  query: string,
  limit = 16,
): HostSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  const state = readIndex(indexPath(runtime));
  const hits: HostSearchHit[] = [];
  for (const [mountId, bucket] of Object.entries(state.mounts)) {
    const mount = runtime.mounts.find((m) => m.id === mountId);
    if (!mount) {
      continue;
    }
    for (const file of bucket.files) {
      const blob = `${file.name} ${file.body ?? ""}`.toLowerCase();
      if (!blob.includes(q)) {
        continue;
      }
      const abs = path.resolve(bucket.absPath, file.rel);
      if (
        isDeniedHostPath(abs, {
          homeDir: runtime.homeDir,
          extraPatterns: runtime.policy.denyPathPatterns,
        })
      ) {
        continue;
      }
      const redacted = redactHostPath(abs);
      let snippet: string | undefined;
      if (file.body) {
        const idx = file.body.toLowerCase().indexOf(q);
        if (idx >= 0) {
          snippet = file.body
            .slice(Math.max(0, idx - 40), idx + q.length + 80)
            .replace(/\s+/g, " ");
        }
      }
      hits.push({
        hitId: newHostId("hit"),
        displayName: redacted.displayName,
        parentName: redacted.parentName,
        ext: file.ext,
        size: file.size,
        mtimeMs: file.mtimeMs,
        absPath: abs,
        mountId,
        matterId: mount.matterId,
        needsGrant: false,
        snippet,
      });
      if (hits.length >= limit) {
        return hits;
      }
    }
  }
  return hits;
}
