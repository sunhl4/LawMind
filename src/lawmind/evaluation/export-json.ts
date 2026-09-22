/**
 * Phase D: machine-readable quality dashboard export for integrations / dashboards.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { QualityRecord } from "../types.js";
import { listQualityRecords } from "./quality.js";

export type QualityDashboardJsonPayload = {
  schemaVersion: 1;
  generatedAt: string;
  recordCount: number;
  byTaskKind: Record<string, number>;
  records: QualityRecord[];
};

/**
 * Writes `quality/dashboard.json` with all `*.quality.json` records aggregated.
 * Returns the absolute path written.
 */
export async function writeQualityDashboardJson(workspaceDir: string): Promise<string> {
  const records = await listQualityRecords(workspaceDir);
  const byTaskKind: Record<string, number> = {};
  for (const r of records) {
    byTaskKind[r.taskKind] = (byTaskKind[r.taskKind] ?? 0) + 1;
  }
  const payload: QualityDashboardJsonPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    byTaskKind,
    records,
  };
  const out = path.join(workspaceDir, "quality", "dashboard.json");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return out;
}
