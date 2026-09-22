/**
 * Seed workspace quality snapshots for release-readiness / dashboard (smoke, demos).
 */

import type { LawMindEngine } from "../engine/types.js";
import type { QualityRecord, ReviewLabel } from "../types.js";
import { writeQualityDashboardJson } from "./export-json.js";
import { persistQualityRecord } from "./quality.js";

const DEFAULT_QUALITY_LABELS: ReviewLabel[] = ["质量范例"];

export async function seedQualitySnapshot(
  workspaceDir: string,
  taskId: string,
  labels: ReviewLabel[] = DEFAULT_QUALITY_LABELS,
): Promise<void> {
  const record: QualityRecord = {
    taskId,
    taskKind: "draft.word",
    citationValidityRate: null,
    issueCoverageRate: null,
    riskRecallRate: null,
    firstPassApproved: true,
    reviewStatus: "approved",
    reviewLabels: labels,
    isGoldenExample: labels.includes("质量范例"),
    latencyMs: 0,
    createdAt: new Date().toISOString(),
  };
  await persistQualityRecord(workspaceDir, record);
}

export async function seedQualityAfterTask(
  engine: LawMindEngine,
  workspaceDir: string,
  taskId: string,
  labels: ReviewLabel[] = DEFAULT_QUALITY_LABELS,
): Promise<void> {
  await engine.recordQuality(taskId, { labels });
  await writeQualityDashboardJson(workspaceDir);
}

export async function flushQualityDashboard(workspaceDir: string): Promise<void> {
  await writeQualityDashboardJson(workspaceDir);
}
