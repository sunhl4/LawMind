import fs from "node:fs";
import path from "node:path";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import { caseFilePath } from "./index.js";

export type MemoryManifestEntry = {
  relativePath: string;
  title: string;
  description?: string;
  validUntil?: string;
  mtimeMs: number;
  sizeBytes?: number;
};

/** Raised so long matters surface more topic files without starving the window. */
const MAX_RECALL = 8;
const DEFAULT_SMALL_FILE_MAX_BYTES = 8_000;
const MEMORY_READ_TOOL_NAMES = new Set([
  "read_file",
  "read_workspace_file",
  "get_source_preview",
  "list_drafts",
]);

function memoryTopicsDir(workspaceDir: string): string {
  return path.join(workspaceDir, "memory", "topics");
}

function isDailyLogRel(rel: string): boolean {
  return /^memory\/\d{4}-\d{2}-\d{2}\.md$/i.test(rel.replace(/\\/g, "/"));
}

function fileSizeBytes(workspaceDir: string, relativePath: string): number {
  try {
    return fs.statSync(path.join(workspaceDir, relativePath)).size;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function parseMemoryIndex(workspaceDir: string): MemoryManifestEntry[] {
  const indexPath = path.join(workspaceDir, "MEMORY.md");
  let raw = "";
  try {
    raw = fs.readFileSync(indexPath, "utf8");
  } catch {
    return [];
  }
  const entries: MemoryManifestEntry[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    const m = /^-\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:—\s*(.+))?$/.exec(line.trim());
    if (!m) {
      continue;
    }
    const rel = m[2].trim();
    const full = path.join(workspaceDir, rel);
    let mtimeMs = 0;
    let sizeBytes: number | undefined;
    try {
      const st = fs.statSync(full);
      mtimeMs = st.mtimeMs;
      sizeBytes = st.size;
    } catch {
      continue;
    }
    entries.push({
      relativePath: rel.replace(/\\/g, "/"),
      title: m[1].trim(),
      description: m[3]?.trim(),
      mtimeMs,
      sizeBytes,
    });
  }
  return entries;
}

function scanTopicHeaders(workspaceDir: string): MemoryManifestEntry[] {
  const dir = memoryTopicsDir(workspaceDir);
  const out: MemoryManifestEntry[] = [];
  try {
    const files = fs.readdirSync(dir);
    for (const name of files) {
      if (!name.endsWith(".md")) {
        continue;
      }
      const rel = `memory/topics/${name}`;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      const head = fs.readFileSync(full, "utf8").slice(0, 400);
      const titleMatch = /^#\s+(.+)$/m.exec(head);
      out.push({
        relativePath: rel,
        title: titleMatch?.[1]?.trim() ?? name.replace(/\.md$/, ""),
        description: head.split("\n").slice(1, 4).join(" ").trim().slice(0, 120),
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
      });
    }
  } catch {
    /* no topics dir */
  }
  return out;
}

/** 按 (mtime,size) 签名的 manifest 缓存：签名只花 readdir+stat，不再每轮重读 MEMORY.md 与全部 topic 头。 */
const manifestCache = new Map<string, { signature: string; entries: MemoryManifestEntry[] }>();

function manifestSignature(workspaceDir: string): string {
  const parts: string[] = [];
  try {
    const st = fs.statSync(path.join(workspaceDir, "MEMORY.md"));
    parts.push(`idx:${st.mtimeMs}:${st.size}`);
  } catch {
    parts.push("idx:none");
  }
  try {
    const dir = memoryTopicsDir(workspaceDir);
    const names = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .toSorted();
    for (const n of names) {
      const st = fs.statSync(path.join(dir, n));
      parts.push(`${n}:${st.mtimeMs}:${st.size}`);
    }
  } catch {
    parts.push("topics:none");
  }
  return parts.join("|");
}

export function scanMemoryManifest(workspaceDir: string): MemoryManifestEntry[] {
  const signature = manifestSignature(workspaceDir);
  const cached = manifestCache.get(workspaceDir);
  if (cached && cached.signature === signature) {
    return cached.entries;
  }
  const seen = new Set<string>();
  const merged: MemoryManifestEntry[] = [];
  for (const e of [...parseMemoryIndex(workspaceDir), ...scanTopicHeaders(workspaceDir)]) {
    if (seen.has(e.relativePath)) {
      continue;
    }
    seen.add(e.relativePath);
    if (e.sizeBytes === undefined) {
      e.sizeBytes = fileSizeBytes(workspaceDir, e.relativePath);
    }
    merged.push(e);
  }
  // 防御性上限：单进程多工作区测试场景下不至于无界增长。
  if (manifestCache.size > 32) {
    manifestCache.clear();
  }
  manifestCache.set(workspaceDir, { signature, entries: merged });
  return merged;
}

function isExpired(entry: MemoryManifestEntry): boolean {
  if (!entry.validUntil) {
    return false;
  }
  const t = Date.parse(entry.validUntil);
  return Number.isFinite(t) && t < Date.now();
}

function resolveRecallPrefs(policy?: LawMindWorkspacePolicy | null): {
  preferSmallFiles: boolean;
  smallFileMaxBytes: number;
} {
  const envPrefer =
    process.env.LAWMIND_RECALL_PREFER_SMALL_FILES?.trim().toLowerCase() === "1" ||
    process.env.LAWMIND_RECALL_PREFER_SMALL_FILES?.trim().toLowerCase() === "true";
  const preferSmallFiles = policy?.memoryRecall?.preferSmallFiles === true || envPrefer;
  const smallFileMaxBytes =
    policy?.memoryRecall?.smallFileMaxBytes && policy.memoryRecall.smallFileMaxBytes > 0
      ? policy.memoryRecall.smallFileMaxBytes
      : DEFAULT_SMALL_FILE_MAX_BYTES;
  return { preferSmallFiles, smallFileMaxBytes };
}

function scoreEntry(
  entry: MemoryManifestEntry,
  query: string,
  matterId: string | undefined,
  opts: { preferSmallFiles: boolean; smallFileMaxBytes: number; recentReadTools: boolean },
): number {
  const q = query.toLowerCase();
  let score = 0;
  if (entry.title.toLowerCase().includes(q)) {
    score += 3;
  }
  if ((entry.description ?? "").toLowerCase().includes(q)) {
    score += 2;
  }
  if (matterId) {
    if (entry.relativePath.includes(`cases/${matterId}/`)) {
      score += 5;
    }
    if (entry.relativePath.endsWith("CASE.md")) {
      score += 4;
    }
  }
  const size = entry.sizeBytes ?? Number.MAX_SAFE_INTEGER;
  if (opts.preferSmallFiles && size <= opts.smallFileMaxBytes) {
    score += 2;
  }
  if (
    opts.recentReadTools &&
    entry.relativePath.endsWith(".md") &&
    size <= opts.smallFileMaxBytes * 2
  ) {
    score += 1;
  }
  return score;
}

export async function findRelevantMemoriesForTurn(opts: {
  workspaceDir: string;
  matterId?: string;
  query: string;
  alreadySurfaced: ReadonlySet<string>;
  recentToolNames: readonly string[];
  policy?: LawMindWorkspacePolicy | null;
  signal?: AbortSignal;
}): Promise<Array<{ relativePath: string; mtimeMs: number }>> {
  if (opts.signal?.aborted) {
    return [];
  }
  const recallPrefs = resolveRecallPrefs(opts.policy);
  const recentReadTools = opts.recentToolNames.some((n) => MEMORY_READ_TOOL_NAMES.has(n));

  const manifest = scanMemoryManifest(opts.workspaceDir).filter(
    (e) => !opts.alreadySurfaced.has(e.relativePath) && !isExpired(e),
  );

  // FTS personal-knowledge candidates supplement the small-file manifest bias.
  try {
    const { searchPersonalKnowledge } = await import("../indexing/knowledge-search.js");
    const fts = await searchPersonalKnowledge(opts.workspaceDir, {
      q: opts.query,
      matterId: opts.matterId,
      limit: 6,
      autoRebuild: false,
    });
    for (const hit of fts.hits) {
      const rel = hit.path.replace(/\\/g, "/");
      if (opts.alreadySurfaced.has(rel) || isDailyLogRel(rel)) {
        continue;
      }
      if (manifest.some((e) => e.relativePath === rel)) {
        continue;
      }
      manifest.push({
        relativePath: rel,
        title: hit.section || hit.docKind,
        mtimeMs: Date.now(),
        sizeBytes: hit.snippet.length,
      });
    }
  } catch {
    /* index optional */
  }

  if (opts.matterId?.trim()) {
    const caseRel = `cases/${opts.matterId.trim()}/CASE.md`.replace(/\\/g, "/");
    try {
      const fp = caseFilePath(opts.workspaceDir, opts.matterId.trim());
      const st = fs.statSync(fp);
      if (!opts.alreadySurfaced.has(caseRel)) {
        manifest.unshift({
          relativePath: caseRel,
          title: "案件记忆 CASE",
          mtimeMs: st.mtimeMs,
          sizeBytes: st.size,
        });
      }
    } catch {
      /* no case */
    }
  }

  const ranked = manifest
    .map((e) => ({
      e,
      score: scoreEntry(e, opts.query, opts.matterId, {
        ...recallPrefs,
        recentReadTools,
      }),
    }))
    .filter((r) => r.score > 0)
    .toSorted((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (recallPrefs.preferSmallFiles) {
        const aSize = a.e.sizeBytes ?? Number.MAX_SAFE_INTEGER;
        const bSize = b.e.sizeBytes ?? Number.MAX_SAFE_INTEGER;
        if (aSize !== bSize) {
          return aSize - bSize;
        }
      }
      return b.e.mtimeMs - a.e.mtimeMs;
    })
    .slice(0, MAX_RECALL);

  if (ranked.length === 0 && manifest.length > 0) {
    const fallback = manifest
      .toSorted((a, b) => {
        if (recallPrefs.preferSmallFiles) {
          const aSize = a.sizeBytes ?? Number.MAX_SAFE_INTEGER;
          const bSize = b.sizeBytes ?? Number.MAX_SAFE_INTEGER;
          if (aSize !== bSize) {
            return aSize - bSize;
          }
        }
        return b.mtimeMs - a.mtimeMs;
      })
      .slice(0, Math.min(3, MAX_RECALL));
    return fallback.map((e) => ({ relativePath: e.relativePath, mtimeMs: e.mtimeMs }));
  }

  return ranked.map((r) => ({
    relativePath: r.e.relativePath,
    mtimeMs: r.e.mtimeMs,
  }));
}
