/**
 * Lawyer-facing north-star rates (not audit-event counts).
 * Missing samples stay null — do not invent a 0% story.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { listProductMetricEvents, summarizeProductMetrics } from "./product-metrics.js";

export type NorthStarSnapshot = {
  schemaVersion: 2;
  capturedAt: string;
  unattendedCompleteRate: number | null;
  firstPassRate: number | null;
  reviewDurationMsMedian: number | null;
  lintEscapeRate: number | null;
  samples: {
    firstPassOk: number;
    firstPassFail: number;
    unattended: number;
    attended: number;
    /** v2 口径：仅 lawyer_edit（律师实质修改）计逃逸 */
    lintEscapes: number;
    /** v2 口径：全部已交付任务 = first_pass + rewrite 事件数 */
    deliveries: number;
  };
};

function rate(ok: number, total: number): number | null {
  if (total <= 0) {
    return null;
  }
  return ok / total;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? null;
  }
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (lo == null || hi == null) {
    return null;
  }
  return (lo + hi) / 2;
}

function reviewDurationMsValues(workspaceDir: string): number[] {
  const out: number[] = [];
  for (const ev of listProductMetricEvents(workspaceDir)) {
    if (ev.kind !== "review_duration") {
      continue;
    }
    const raw = ev.meta?.durationMs;
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      out.push(raw);
    }
  }
  return out;
}

/** v2 口径：逃逸只计 lawyer_edit（律师实质修改）；lint_findings 是草稿侧信号，不算交付后逃逸。 */
function lawyerEditEscapeCount(workspaceDir: string): number {
  let n = 0;
  for (const ev of listProductMetricEvents(workspaceDir)) {
    if (ev.kind === "lint_escape" && ev.outcome === "lawyer_edit") {
      n += 1;
    }
  }
  return n;
}

export function northStarPath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "metrics", "north-star.json");
}

export function buildNorthStarSnapshot(workspaceDir: string): NorthStarSnapshot {
  const product = summarizeProductMetrics(workspaceDir);
  const firstTotal = product.firstPassOk + product.firstPassFail;
  const unattended = product.byOutcome.unattended ?? 0;
  const attended = product.byOutcome.attended ?? 0;
  // v2 口径：分母统一为全部已交付任务（rewrite 也进分母）；逃逸只计 lawyer_edit。
  // 空样本保持 null——不编造 100% 也不编造 0%。
  const deliveries = (product.byKind.first_pass ?? 0) + (product.byKind.rewrite ?? 0);
  const lintEscapes = lawyerEditEscapeCount(workspaceDir);
  return {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    unattendedCompleteRate: rate(unattended, unattended + attended),
    firstPassRate: rate(product.firstPassOk, firstTotal),
    reviewDurationMsMedian: median(reviewDurationMsValues(workspaceDir)),
    lintEscapeRate: rate(lintEscapes, deliveries),
    samples: {
      firstPassOk: product.firstPassOk,
      firstPassFail: product.firstPassFail,
      unattended,
      attended,
      lintEscapes,
      deliveries,
    },
  };
}

export function persistNorthStarSnapshot(workspaceDir: string): NorthStarSnapshot {
  const snap = buildNorthStarSnapshot(workspaceDir);
  fs.mkdirSync(path.dirname(northStarPath(workspaceDir)), { recursive: true });
  writeJsonAtomic(northStarPath(workspaceDir), snap);
  return snap;
}

/**
 * 读取持久化快照；schemaVersion < 2 的旧快照按 v2 口径重算并落盘（迁移）。
 * 快照是 product-events 的派生物，重算永远安全。
 */
export function readNorthStarSnapshot(workspaceDir: string): NorthStarSnapshot {
  try {
    const raw = fs.readFileSync(northStarPath(workspaceDir), "utf8");
    const parsed = JSON.parse(raw) as NorthStarSnapshot | undefined;
    if (parsed?.schemaVersion === 2) {
      return parsed;
    }
  } catch {
    /* missing or corrupt — rebuild below */
  }
  return persistNorthStarSnapshot(workspaceDir);
}
