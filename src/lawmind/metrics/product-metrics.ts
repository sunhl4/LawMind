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
  /**
   * 2026-09-22 删除两个**死 kind**：`checklist` 与 `citation_mode`。
   *
   * 它们只出现在这个联合类型里 —— 全仓**没有任何写入点**（生产代码里
   * `kind: "checklist"` / `"citation_mode"` 零命中），也没有任何读取点
   * （`byKind.*` 无人引用），连本类型都没有被别的文件导入（仅 `grep` 可证）。
   *
   * 为什么删而不是留着：一个"声明了但永远不写"的 kind 在类型层面与真正接线的
   * 完全一样 —— 读代码的人会以为「这项有在测」，而报表里它永远是 0 或缺失。
   * 本仓已经吃过多次「实现了但没接线」的亏（`facts_grounded`、G3 升级卡挂载点、
   * 判据三的幅度样本），所以这里宁可删掉：将来真要测，就必须顺手写产出点。
   * 出处：2026-09-22 对真实诊断包（82 条事件）做 B2 数据对账时发现。
   */
  | "lint_escape"
  | "delivery_autonomy"
  | "review_duration"
  /**
   * 素材块（判断层）合成结果——记录**哪些通道被纳入、哪些因预算被整条丢弃**。
   *
   * 为什么需要它：D10 之后素材是「一个受预算约束的片段，超预算整块丢弃」，
   * 但**丢弃此前只写在 prompt 文案里**（「本次因篇幅未展开：质量范例」）——
   * 律师看得见，系统自己看不见。于是无法回答一个真实的问题：
   * 「某个通道是不是长期被丢？」如果黄金范例 80% 的回合都被丢，
   * 要么预算太小，要么这个通道不值得留——**这需要数字，不是印象**。
   */
  | "material_block"
  /**
   * 上下文压力：回合内整理、退让反弹、承前分叉的**结果**。
   *
   * 为什么需要（与 `material_block` 同一条理由）：修了「模型把活儿退回律师」
   * 之后，如果只靠印象说「好多了」，那就无法回答商业上真正要回答的问题——
   * **模型尝试退让时，最后到达律师的比例是多少？整理真的腾出空间了吗？**
   * 律师侧的「已整理上下文」提示与面板数字只说明系统自己做了什么，
   * 说明不了这件事有没有变少。**这需要数字，不是印象。**
   */
  | "context_pressure";

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
