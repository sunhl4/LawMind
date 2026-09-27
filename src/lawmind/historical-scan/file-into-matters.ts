/**
 * 把一次扫描里、律师点名的「已按案件分好」的材料复制进案件目录。
 * 源文件不改、不删。杂目录不在这里收。
 */

import fs from "node:fs";
import path from "node:path";
import { createMatterIfAbsent } from "../cases/matter-create.js";
import { isValidMatterId } from "../cases/matter-id.js";
import { listScanRoots } from "./job-store.js";
import { readLatestScanJob } from "./run-scan.js";
import { isPathInsideRoot } from "./walk.js";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

export type FiledMatter = {
  label: string;
  matterId: string;
  created: boolean;
  copied: number;
  alreadyThere: number;
  keptExisting: number;
};

export type SkippedMatter = {
  label: string;
  reason: "invalid_name" | "no_files";
};

export type FileIntoMattersResult = {
  filed: FiledMatter[];
  skipped: SkippedMatter[];
  truncated: boolean;
};

function destRelative(relPath: string, label: string, fileName: string): string {
  const parts = relPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const idx = parts.lastIndexOf(label);
  const rest = (idx >= 0 ? parts.slice(idx + 1) : [fileName]).filter(
    (part) =>
      part !== "." &&
      part !== ".." &&
      !part.includes("\0") &&
      !part.includes("/") &&
      !part.includes("\\"),
  );
  return rest.length > 0 ? rest.join("/") : fileName;
}

export function resolveScanSource(
  rootAbs: string,
  relPath: string,
): { abs: string; size: number } | null {
  const rel = relPath.replace(/\\/g, "/");
  if (!rel || rel.startsWith("/") || rel.includes("..") || rel.includes("\0")) {
    return null;
  }
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(rootAbs);
  } catch {
    return null;
  }
  const abs = path.resolve(rootReal, rel);
  let real: string;
  let size = 0;
  try {
    real = fs.realpathSync(abs);
    const st = fs.statSync(real);
    if (!st.isFile()) {
      return null;
    }
    size = st.size;
  } catch {
    return null;
  }
  if (!isPathInsideRoot(real, rootReal)) {
    return null;
  }
  return { abs: real, size };
}

function underDir(dir: string, file: string): boolean {
  const base = path.resolve(dir);
  const target = path.resolve(file);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

export async function fileScanIntoMatters(
  workspaceDir: string,
  labels: string[],
): Promise<{ ok: true; result: FileIntoMattersResult } | { ok: false; error: "no_scan" }> {
  const job = readLatestScanJob(workspaceDir);
  if (!job) {
    return { ok: false, error: "no_scan" };
  }
  const wanted = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  const roots = new Map(listScanRoots(workspaceDir).map((root) => [root.id, root.absPath]));
  const filed: FiledMatter[] = [];
  const skipped: SkippedMatter[] = [];
  let truncated = false;
  let totalBytes = 0;

  for (const label of wanted) {
    if (truncated) {
      break;
    }
    if (!isValidMatterId(label)) {
      skipped.push({ label, reason: "invalid_name" });
      continue;
    }
    const items = job.catalog.filter(
      (item) => item.layout === "organized" && item.proposedMatterLabel === label,
    );
    const sources: Array<{ abs: string; size: number; destRel: string }> = [];
    for (const item of items) {
      const rootAbs = roots.get(item.rootId);
      if (!rootAbs) {
        continue;
      }
      const src = resolveScanSource(rootAbs, item.relPath);
      if (!src) {
        continue;
      }
      sources.push({ ...src, destRel: destRelative(item.relPath, label, item.fileName) });
    }
    const copyable = sources.filter((src) => src.size <= MAX_FILE_BYTES);
    if (copyable.length === 0) {
      skipped.push({ label, reason: "no_files" });
      continue;
    }
    const created = await createMatterIfAbsent(workspaceDir, label, {
      displayName: label,
      status: "intake",
    });
    const materials = path.join(workspaceDir, "cases", label, "materials");
    fs.mkdirSync(materials, { recursive: true });
    let copied = 0;
    let alreadyThere = 0;
    let keptExisting = 0;
    for (const src of copyable) {
      if (truncated) {
        break;
      }
      const dest = path.join(materials, src.destRel);
      if (!underDir(materials, dest)) {
        continue;
      }
      if (fs.existsSync(dest)) {
        try {
          if (fs.statSync(dest).size === src.size) {
            alreadyThere += 1;
          } else {
            keptExisting += 1;
          }
        } catch {
          keptExisting += 1;
        }
        continue;
      }
      if (totalBytes + src.size > MAX_TOTAL_BYTES) {
        truncated = true;
        break;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src.abs, dest);
      copied += 1;
      totalBytes += src.size;
    }
    filed.push({
      label,
      matterId: created.matterId,
      created: created.created,
      copied,
      alreadyThere,
      keptExisting,
    });
  }

  return { ok: true, result: { filed, skipped, truncated } };
}
