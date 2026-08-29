/**
 * Lawyer-facing north-star rates (not audit-event counts).
 * Missing samples stay null — do not invent a 0% story.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { listProductMetricEvents, summarizeProductMetrics } from "./product-metrics.js";

export type NorthStarSnapshot = {
  schemaVersion: 1;
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
    lintEscapes: number;
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
  const sorted = [...values].toSorted((a, b) => a - b);
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

export function northStarPath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "metrics", "north-star.json");
}

export function buildNorthStarSnapshot(workspaceDir: string): NorthStarSnapshot {
  const product = summarizeProductMetrics(workspaceDir);
  const firstTotal = product.firstPassOk + product.firstPassFail;
  const unattended = product.byOutcome.unattended ?? 0;
  const attended = product.byOutcome.attended ?? 0;
  const lintEscapes = product.byKind.lint_escape ?? 0;
  const deliveries = product.byKind.first_pass ?? firstTotal;
  const lintTracked = product.byKind.lint_escape != null;
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    unattendedCompleteRate: rate(unattended, unattended + attended),
    firstPassRate: rate(product.firstPassOk, firstTotal),
    reviewDurationMsMedian: median(reviewDurationMsValues(workspaceDir)),
    lintEscapeRate: lintTracked ? rate(lintEscapes, deliveries || lintEscapes) : null,
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
