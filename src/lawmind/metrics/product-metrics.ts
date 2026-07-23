/**
 * Product metrics for Skills epic S0+ (first-pass, rewrite, gate, triage).
 * Append-only JSONL under workspace/lawmind/metrics/product-events.jsonl
 */

import fs from "node:fs";
import path from "node:path";

export type ProductMetricKind =
  | "first_pass"
  | "rewrite"
  | "rewrite_amplitude"
  | "gate_failure"
  | "triage"
  | "checklist"
  | "citation_mode";

export type ProductMetricEvent = {
  ts: string;
  kind: ProductMetricKind;
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
  /** Outcome or reason code */
  outcome: string;
  detail?: string;
  meta?: Record<string, string | number | boolean | null>;
};

export function productMetricsPath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "metrics", "product-events.jsonl");
}

export function appendProductMetric(
  workspaceDir: string,
  event: Omit<ProductMetricEvent, "ts">,
): void {
  const dir = path.dirname(productMetricsPath(workspaceDir));
  fs.mkdirSync(dir, { recursive: true });
  const row: ProductMetricEvent = { ...event, ts: new Date().toISOString() };
  fs.appendFileSync(productMetricsPath(workspaceDir), `${JSON.stringify(row)}\n`, "utf8");
}

export type ProductMetricSummary = {
  total: number;
  byKind: Record<string, number>;
  byOutcome: Record<string, number>;
  triageConfirmed: number;
  triagePreview: number;
  gateFailures: number;
  firstPassOk: number;
  firstPassFail: number;
  /** kind=rewrite 事件数（与 specialization materialRewrites 同向） */
  rewrites: number;
};

export function summarizeProductMetrics(workspaceDir: string, limit = 5000): ProductMetricSummary {
  const file = productMetricsPath(workspaceDir);
  const summary: ProductMetricSummary = {
    total: 0,
    byKind: {},
    byOutcome: {},
    triageConfirmed: 0,
    triagePreview: 0,
    gateFailures: 0,
    firstPassOk: 0,
    firstPassFail: 0,
    rewrites: 0,
  };
  if (!fs.existsSync(file)) {
    return summary;
  }
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-limit);
  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as ProductMetricEvent;
      summary.total += 1;
      summary.byKind[ev.kind] = (summary.byKind[ev.kind] ?? 0) + 1;
      summary.byOutcome[ev.outcome] = (summary.byOutcome[ev.outcome] ?? 0) + 1;
      if (ev.kind === "triage" && ev.outcome === "confirmed") {
        summary.triageConfirmed += 1;
      }
      if (ev.kind === "triage" && ev.outcome === "preview") {
        summary.triagePreview += 1;
      }
      if (ev.kind === "gate_failure") {
        summary.gateFailures += 1;
      }
      if (ev.kind === "first_pass" && ev.outcome === "ok") {
        summary.firstPassOk += 1;
      }
      if (ev.kind === "first_pass" && ev.outcome === "fail") {
        summary.firstPassFail += 1;
      }
      if (ev.kind === "rewrite") {
        summary.rewrites += 1;
        summary.firstPassFail += 1;
      }
    } catch {
      /* skip bad lines */
    }
  }
  return summary;
}
