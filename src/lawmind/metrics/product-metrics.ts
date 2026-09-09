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
  | "citation_mode"
  | "lint_escape"
  | "delivery_autonomy"
  | "review_duration";

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
  /** Optional id of the corresponding runtime event (tool_call / lint_run / lawyer_edit / deliver). */
  runtimeEventId?: string;
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
  /** 口径标注：true 表示事件文件超过窗口 limit，仅统计最近 limit 条 */
  truncated: boolean;
  /** 统计窗口内最早/最晚事件 ts（无事件为 null） */
  windowFrom: string | null;
  windowTo: string | null;
  /** 文件内事件总行数（> total 时说明窗口外还有历史事件被截断） */
  totalLines: number;
};

export type ProductMetricEventsPage = {
  events: ProductMetricEvent[];
  /** true = 文件超过 limit，仅返回最近窗口（口径显式化，消费方不得当作全量） */
  truncated: boolean;
  /** 文件内事件总行数 */
  totalLines: number;
  /** 窗口内最早/最晚事件 ts（无事件为 null） */
  windowFrom: string | null;
  windowTo: string | null;
};

export function readProductMetricEvents(
  workspaceDir: string,
  limit = 5000,
): ProductMetricEventsPage {
  const file = productMetricsPath(workspaceDir);
  if (!fs.existsSync(file)) {
    return { events: [], truncated: false, totalLines: 0, windowFrom: null, windowTo: null };
  }
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const windowLines = lines.slice(-limit);
  const events: ProductMetricEvent[] = [];
  for (const line of windowLines) {
    try {
      events.push(JSON.parse(line) as ProductMetricEvent);
    } catch {
      /* skip bad lines */
    }
  }
  return {
    events,
    truncated: lines.length > windowLines.length,
    totalLines: lines.length,
    windowFrom: events[0]?.ts ?? null,
    windowTo: events[events.length - 1]?.ts ?? null,
  };
}

export function listProductMetricEvents(workspaceDir: string, limit = 5000): ProductMetricEvent[] {
  return readProductMetricEvents(workspaceDir, limit).events;
}

export function summarizeProductMetrics(workspaceDir: string, limit = 5000): ProductMetricSummary {
  const page = readProductMetricEvents(workspaceDir, limit);
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
    truncated: page.truncated,
    windowFrom: page.windowFrom,
    windowTo: page.windowTo,
    totalLines: page.totalLines,
  };
  for (const ev of page.events) {
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
  }
  return summary;
}
