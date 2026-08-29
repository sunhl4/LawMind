/**
 * Lawyer-facing Word deliverable paths under a matter folder.
 * Naming: keep original basename stem, append _YYYYMMDD_01 (increment 02 on collision).
 * Never opens Word — files are written for the lawyer to open manually.
 */

import fs from "node:fs";
import path from "node:path";

/** Local calendar date YYYYMMDD. */
export function formatDeliveryDateStamp(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function formatDeliveryTimeStamp(at: Date = new Date()): string {
  const h = String(at.getHours()).padStart(2, "0");
  const min = String(at.getMinutes()).padStart(2, "0");
  const s = String(at.getSeconds()).padStart(2, "0");
  return `${h}${min}${s}`;
}

/** Sanitize a single path segment (keep CJK / common punctuation used in contract titles). */
export function safeDeliveryStem(originalBasename: string): string {
  const leaf = path.basename(originalBasename.trim() || "合同");
  const ext = path.extname(leaf);
  let stem = ext ? leaf.slice(0, -ext.length) : leaf;
  stem = stem.replace(/[^\w.\u4e00-\u9fff（）()[\]【】\-—_ +<>《》]/g, "_").trim();
  stem = stem.replace(/_+/g, "_").replace(/^[_\s]+|[_\s]+$/g, "");
  stem = stem.replace(/_\d{8}(?:_\d{2})?(?:_\d{6})?$/, "") || stem;
  return stem.slice(0, 160) || "合同";
}

function nextVersionSerial(dir: string, stem: string, date: string): number {
  if (!dir || !fs.existsSync(dir)) {
    return 1;
  }
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}_${date}_(\\d{2})\\.docx$`, "i");
  let max = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      const m = re.exec(name);
      if (!m?.[1]) {
        continue;
      }
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) {
        max = n;
      }
    }
  } catch {
    return 1;
  }
  return Math.min(max + 1, 99);
}

/**
 * Build `原文件名_YYYYMMDD_01.docx` (officecli tracked output is always OOXML).
 * Same-day collision increments `_02`, `_03`, …
 */
export function buildMatterReviewedWordFilename(
  originalBasename: string,
  at: Date = new Date(),
  opts?: { dirForUniqueness?: string },
): string {
  const stem = safeDeliveryStem(originalBasename);
  const date = formatDeliveryDateStamp(at);
  const serial = nextVersionSerial(opts?.dirForUniqueness ?? "", stem, date);
  return `${stem}_${date}_${String(serial).padStart(2, "0")}.docx`;
}

/** Matter workspace folder: `cases/<matterId>/`. */
export function resolveMatterWorkspaceDir(workspaceDir: string, matterId: string): string {
  const mid = matterId.trim();
  if (!mid || mid.includes("..") || mid.includes("/") || mid.includes("\\")) {
    throw new Error("invalid_matter_id");
  }
  return path.join(path.resolve(workspaceDir), "cases", mid);
}

/** Infer matterId from a workspace-relative baseline like `cases/<id>/mail/...`. */
export function matterIdFromWorkspaceRelativePath(rel: string): string | undefined {
  const norm = rel.trim().replace(/\\/g, "/");
  const m = norm.match(/^cases\/([^/]+)\//);
  const id = m?.[1]?.trim();
  if (!id || id.includes("..")) {
    return undefined;
  }
  return id;
}
