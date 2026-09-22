/**
 * 决策语料导出器（第二十期 P0）：把分散在既有产物里的判断信号归一成一份可编译语料。
 *
 * 背景：`lint-escape-candidates.ts` 自第十四期起就在写 `escape-candidates.jsonl` /
 * `escape-corpus.jsonl` / `escape-stance.jsonl`——**但全仓没有任何一处读它们**。
 * 飞轮有写入端、没有读取端。本模块提供那个读取端，并把其余既有信号（产品指标、
 * 运行时事件、质量快照、拍板记录）归一进来，作为规则编译与校准的原料。
 *
 * 三条口径（与 LawMind 既有约定一致，不得违反）：
 *   1. 缺来源 → `present: false`，**绝不产出 0**（`metrics/north-star.ts`：
 *      "Missing samples stay null — do not invent a 0% story"）。
 *   2. 截断显式：读窗口超限时标 `truncated` 并给出 `totalLines`，消费方不得当全量。
 *   3. `collectDecisionSamples()` **纯读取**，不写任何东西；写盘是独立的 `writeDecisionSamples()`。
 *
 * 关键语义（**2026-09-21 实测修正**）：
 *
 * 飞轮记的两个 outcome **都不是**「编译器在 agent 原稿上漏掉了缺陷」。真实口径见
 * `engine/reviewing.ts:169-190`——它 lint 的是**审核时传入的 draft**，也就是
 * **律师改完之后的那一版文本**（律师在审核台上改完才提交）：
 *
 * | outcome | 精确含义 |
 * | ----------------- | ------------------------------------------------------------------------------- |
 * | `lint_findings` | **最终稿**仍有 blocker/warning（律师交出去的稿子带着机械缺陷） |
 * | `lawyer_edit` | **最终稿机械干净**，且该稿经历过改稿（`rewriteAmplitude` 幅度 > 0） |
 *
 * 由此推出一个**必须写明的局限**：
 *
 * > 飞轮**看不见「agent 原稿有缺陷、律师在提交前改掉了」这一类**——因为 lint 读的是改后文本，
 * > 缺陷已被改掉，规则自然看不到。
 *
 * 这意味着 `rule_miss` 只能表示「最终稿无机械缺陷但仍被改过」（可能只是口径/风格），
 * **不等于**「编译器漏掉了实体缺陷」。要测后者必须在**改稿前**另 lint 一次原稿
 * ——`scripts/lawmind/lawmind-round.ts` 就是这么做的（它同时 lint 原稿与改后稿，
 * 从而实测出「定金按金额写、不写百分比时 `statutory.deposit_cap` 静默放过」这条真实盲区）。
 *
 * 因此本模块**不再把 `lawyer_edit` 映射成 `rule_miss`**——那是把两个不同的东西混成一个名字。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readApprovals } from "../adapters/matter-storage/index.js";
import { listMatterIdsFromStorage } from "../adapters/matter-storage/io.js";
import { listQualityRecords } from "../evaluation/quality.js";
import { readLintEscapeFiles } from "./lint-escape-candidates.js";
import { readProductMetricEvents } from "./product-metrics.js";
import { listRuntimeEvents } from "./runtime-events.js";

export const DECISION_SAMPLES_REL = "lawmind/decision/decision-samples.jsonl";
export const DECISION_REPORT_REL = "lawmind/decision/decision-samples-report.json";

export type DecisionSampleSource =
  | "escape"
  | "product_events"
  | "runtime_events"
  | "quality"
  | "approvals"
  /** 演练标记（`scripts/lawmind/lawmind-round.ts` 写入的工作区自述）。 */
  | "drill";

export type DecisionSampleSignal =
  /**
   * 逃逸候选的 `ruleIds` 非空 —— 规则命中了。
   *
   * ⚠️ 注意：这是**审核时那份文本**（通常是律师改后稿）上的命中，不是 agent 原稿的命中。
   * 见模块头「关键语义」。
   */
  | "rule_hit"
  /**
   * 逃逸候选的 `ruleIds` **为空** —— 该次审核没有产生任何规则命中。
   *
   * **不等于「编译器漏掉了缺陷」**：lint 读的是改后文本，原稿的缺陷可能已被改掉。
   * 它只表示「这次审核里规则没说话」。要测真实盲区必须在改稿前另 lint 一次原稿。
   */
  | "rule_miss"
  /** 漏网正文命中的条款类型，作为立场候选 */
  | "stance_candidate"
  | "first_pass_ok"
  | "first_pass_fail"
  | "lawyer_edit"
  | "review_label"
  | "approval_approved"
  | "approval_rejected"
  | "approval_needs_changes";

export type DecisionSample = {
  /** 稳定 id：跨次导出可去重，不随导出时间变化。 */
  sampleId: string;
  ts: string;
  signal: DecisionSampleSignal;
  source: DecisionSampleSource;
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
  /** `rule_hit` 是命中的规则；`rule_miss` 恒为空数组——空数组本身就是信号。 */
  ruleIds?: string[];
  /** 漏网正文片段（采集侧已截断到 400 字）。 */
  snippet?: string;
  /** 细粒度标签（`ReviewLabel`）或拍板结论。 */
  labels?: string[];
  /** 原样保留的旁证，不做推断。 */
  meta?: Record<string, string | number | boolean | null>;
};

export type DecisionSampleSourceReport = {
  id: DecisionSampleSource;
  /** 工作区相对路径（可多个，用 `、` 连接）。 */
  path: string;
  present: boolean;
  rows: number;
  /** 被跳过的坏行 / 半写行（只对有 reader 的来源有意义）。 */
  skippedLines?: number;
  note?: string;
};

export type DecisionSamplesReport = {
  schemaVersion: 1;
  generatedAt: string;
  workspaceDir: string;
  /**
   * 本工作区是不是**演练**产物（发现 `DRILL_MARKER_FILE` 时为 true）。
   *
   * **为什么必须显式**：`pnpm lawmind:round` 会往 `workspace/rounds/<日期>-<slug>/`
   * 里 append 与真实飞轮同形的 JSONL。那批数据能证明「机制跑通」，**不能**用来推断
   * 规则覆盖率或律师改稿习惯（律师改稿是脚本模拟的）。没有这个标记时，
   * 「跑了 50 轮」与「真实办了 50 件」在报表上长得一模一样。
   */
  drill: boolean;
  sampleCount: number;
  bySignal: Record<string, number>;
  sources: DecisionSampleSourceReport[];
  /** 数据缺口自述。空数组表示本次导出没有发现缺口（罕见，不代表数据充足）。 */
  warnings: string[];
  snippetStats: {
    withSnippet: number;
    withoutSnippet: number;
    /** 无样本时为 null——不编造 0。 */
    avgChars: number | null;
    /** 采集侧截断上限（`engine/reviewing.ts` 的 slice(0, 400)）。 */
    clipChars: number;
    atClipLimit: number;
  };
  labelBalance: {
    firstPassOk: number;
    firstPassFail: number;
    approvalsApproved: number;
    approvalsRejected: number;
  };
  timeRange: { from: string | null; to: string | null };
  truncated: boolean;
};

export type DecisionSamplesCollection = {
  samples: DecisionSample[];
  report: DecisionSamplesReport;
  /** 读窗口是否触顶（`product-events.jsonl` / `runtime-events.jsonl`）。 */
  truncated: boolean;
};

const SNIPPET_CLIP_CHARS = 400;
const DEFAULT_EVENT_WINDOW = 5000;

export function decisionSamplesPath(workspaceDir: string): string {
  return path.join(workspaceDir, DECISION_SAMPLES_REL);
}

export function decisionReportPath(workspaceDir: string): string {
  return path.join(workspaceDir, DECISION_REPORT_REL);
}

/**
 * 来源「缺口自述」的唯一构造点。
 *
 * 用单一函数生成 note，避免多处 `...(cond ? {note} : {})` 展开互相覆盖——
 * 缺来源与截断可能同时成立，只显示其中一条会误导消费方。
 */
function eventSourceNote(input: {
  totalLines: number;
  readRows: number;
  missingNote: string;
}): string | undefined {
  const { totalLines, readRows, missingNote } = input;
  if (totalLines === 0) {
    return missingNote;
  }
  if (totalLines > readRows) {
    return readRows === 0
      ? `文件有 ${totalLines} 行但全部无法解析（坏行 / 半写行）。`
      : `仅读取最近 ${readRows} 条（文件共 ${totalLines} 条）。`;
  }
  return undefined;
}

function optionalNote(note: string | undefined): { note?: string } {
  return note ? { note } : {};
}

/** 稳定 id：同一源行在任何时候导出都得到同一 id。 */
function makeSampleId(input: {
  signal: DecisionSampleSignal;
  ts: string;
  taskId?: string;
  matterId?: string;
  discriminator?: string;
}): string {
  const canonical = [
    input.signal,
    input.ts,
    input.taskId ?? "",
    input.matterId ?? "",
    input.discriminator ?? "",
  ].join("\u0000");
  return `ds_${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16)}`;
}

function pushSample(samples: DecisionSample[], sample: DecisionSample): void {
  samples.push(sample);
}

/**
 * 演练标记文件名。`scripts/lawmind/lawmind-round.ts` 在创建工作区时写入，
 * `collectDecisionSamples` 读它并在报告里标 `drill: true` + 一条 warning。
 *
 * 与 `.gitignore` 里的 `workspace/rounds/` 配套：那一条防的是「产物被提交」，
 * 这一条防的是「产物被当成真实分布」。
 */
export const DRILL_MARKER_FILE = ".lawmind-drill.json";

export type DrillMarker = {
  slug?: string;
  generatedAt?: string;
  note?: string;
};

/**
 * 读演练标记。**永不抛**。
 *
 * 判定口径是 **fail-closed**：文件**存在**就算演练（内容坏掉也只是取不到 slug），
 * 只有**文件不存在**才返回 `undefined`。反过来（坏文件当非演练）刚好会在
 * 「标记写坏」时静默地把演练数据放行成真实分布——那是这条标记唯一要防的事。
 */
export function readDrillMarker(workspaceDir: string): DrillMarker | undefined {
  const file = path.join(workspaceDir, DRILL_MARKER_FILE);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return { note: "演练标记存在但内容不可解析——仍按演练处理。" };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      ...(typeof obj.slug === "string" ? { slug: obj.slug } : {}),
      ...(typeof obj.generatedAt === "string" ? { generatedAt: obj.generatedAt } : {}),
      ...(typeof obj.note === "string" ? { note: obj.note } : {}),
    };
  } catch {
    return { note: "演练标记存在但内容不可读——仍按演练处理。" };
  }
}

/**
 * 纯读取：把工作区里既有的判断信号归一成语料。不写任何东西。
 * `opts.eventWindow` 控制事件文件的读取窗口（超限会在报告里标 `truncated`）。
 */
export async function collectDecisionSamples(
  workspaceDir: string,
  opts?: { eventWindow?: number },
): Promise<DecisionSamplesCollection> {
  const window = Math.max(1, Math.floor(opts?.eventWindow ?? DEFAULT_EVENT_WINDOW));
  const samples: DecisionSample[] = [];
  const sources: DecisionSampleSourceReport[] = [];
  const warnings: string[] = [];

  // ── 1. 逃逸飞轮（规则漏网 / 规则命中 / 立场候选）────────────────────────
  const escape = readLintEscapeFiles(workspaceDir);
  const escapeRows = escape.candidates.rows.length + escape.corpus.rows.length;
  sources.push({
    id: "escape",
    path: "lawmind/lint/escape-candidates.jsonl、escape-corpus.jsonl、escape-stance.jsonl",
    present: escape.candidates.present || escape.corpus.present || escape.stance.present,
    rows: escapeRows + escape.stance.rows.length,
    skippedLines:
      escape.candidates.skippedLines + escape.corpus.skippedLines + escape.stance.skippedLines,
    ...(escape.candidates.present
      ? {}
      : {
          note: "三个逃逸文件均不存在——该工作区尚未产生过 lint 逃逸，或从未跑过审核。这不等于逃逸率为 0。",
        }),
  });

  // 语料按 `${ts}|${taskId}` 建索引，与 candidates 行同源同 ts（见 distributeLintEscape）。
  const corpusByKey = new Map<string, string>();
  for (const row of escape.corpus.rows) {
    corpusByKey.set(`${row.ts}|${row.taskId ?? ""}`, row.snippet);
  }

  for (const row of escape.candidates.rows) {
    const ruleIds = row.ruleIds;
    // 关键：空 ruleIds ⟺ 该次审核**没有任何规则命中**。
    // 这只表示「规则那次没说话」，**不等于**「编译器漏掉了实体缺陷」——
    // 因为 lint 读的是审核时那份文本（通常是律师改后稿）。见模块头「关键语义」。
    const signal: DecisionSampleSignal = ruleIds.length > 0 ? "rule_hit" : "rule_miss";
    const snippet = row.snippet ?? corpusByKey.get(`${row.ts}|${row.taskId ?? ""}`);
    pushSample(samples, {
      sampleId: makeSampleId({
        signal,
        ts: row.ts,
        taskId: row.taskId,
        discriminator: `${ruleIds.join(",")}|${snippet?.slice(0, 64) ?? ""}`,
      }),
      ts: row.ts,
      signal,
      source: "escape",
      ...(row.taskId ? { taskId: row.taskId } : {}),
      ruleIds,
      ...(snippet ? { snippet } : {}),
    });
  }

  for (const row of escape.stance.rows) {
    pushSample(samples, {
      sampleId: makeSampleId({
        signal: "stance_candidate",
        ts: row.ts,
        taskId: row.taskId,
        discriminator: row.clauseType,
      }),
      ts: row.ts,
      signal: "stance_candidate",
      source: "escape",
      ...(row.taskId ? { taskId: row.taskId } : {}),
      snippet: row.snippet,
      labels: [row.clauseType],
    });
  }

  // ── 2. 产品指标（一次通过 / 律师实质修改 / 草稿侧 lint）──────────────────
  const product = readProductMetricEvents(workspaceDir, window);
  sources.push({
    id: "product_events",
    path: "lawmind/metrics/product-events.jsonl",
    present: product.totalLines > 0,
    rows: product.events.length,
    ...optionalNote(
      eventSourceNote({
        totalLines: product.totalLines,
        readRows: product.events.length,
        missingNote:
          "尚无产品指标事件——该工作区还没有任何已交付/已审核记录，不等于一次通过率为 0。",
      }),
    ),
  });
  if (product.truncated) {
    warnings.push(
      `product-events.jsonl 已截断：只读最近 ${product.events.length} / ${product.totalLines} 条。本报告不足以当作全量历史。`,
    );
  }

  for (const ev of product.events) {
    const base = {
      ts: ev.ts,
      source: "product_events" as const,
      ...(ev.taskId ? { taskId: ev.taskId } : {}),
      ...(ev.matterId ? { matterId: ev.matterId } : {}),
      ...(ev.deliverableType ? { deliverableType: ev.deliverableType } : {}),
      ...(ev.meta ? { meta: ev.meta } : {}),
    };
    if (ev.kind === "first_pass") {
      const signal: DecisionSampleSignal =
        ev.outcome === "ok" ? "first_pass_ok" : "first_pass_fail";
      pushSample(samples, {
        ...base,
        signal,
        sampleId: makeSampleId({ signal, ts: ev.ts, taskId: ev.taskId, discriminator: ev.kind }),
      });
      continue;
    }
    if (ev.kind === "lint_escape") {
      // 口径见模块头「关键语义」：
      //   outcome=lint_findings ⟺ 审核时那份文本（通常已改过）仍有命中
      //   outcome=lawyer_edit   ⟺ 那份文本机械干净，但该稿经历过改稿
      // 两者都不是「agent 原稿上的漏网」。
      const signal: DecisionSampleSignal =
        ev.outcome === "lawyer_edit" ? "lawyer_edit" : "rule_hit";
      pushSample(samples, {
        ...base,
        signal,
        sampleId: makeSampleId({
          signal,
          ts: ev.ts,
          taskId: ev.taskId,
          discriminator: "lint_escape",
        }),
      });
    }
  }

  // ── 3. 运行时事件（律师改稿明细）───────────────────────────────────────
  const runtime = listRuntimeEvents(workspaceDir, window);
  const runtimePresent = fs.existsSync(
    path.join(workspaceDir, "lawmind/metrics/runtime-events.jsonl"),
  );
  const runtimeAll = runtimePresent
    ? fs
        .readFileSync(path.join(workspaceDir, "lawmind/metrics/runtime-events.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean).length
    : 0;
  sources.push({
    id: "runtime_events",
    path: "lawmind/metrics/runtime-events.jsonl",
    present: runtimePresent,
    rows: runtime.length,
    ...optionalNote(
      runtimePresent
        ? eventSourceNote({
            totalLines: runtimeAll,
            readRows: runtime.length,
            missingNote: "", // present=true 时不会用到
          })
        : "尚无运行时事件——没有 tool_call / lint_run / lawyer_edit / deliver 明细可学。",
    ),
  });
  if (runtimeAll > runtime.length) {
    warnings.push(`runtime-events.jsonl 已截断：只读最近 ${runtime.length} / ${runtimeAll} 条。`);
  }

  for (const ev of runtime) {
    if (ev.kind !== "lawyer_edit") {
      continue;
    }
    const outcome = typeof ev.meta?.outcome === "string" ? ev.meta.outcome : undefined;
    const lintEscape = ev.meta?.lintEscape === true;
    pushSample(samples, {
      sampleId: makeSampleId({
        signal: "lawyer_edit",
        ts: ev.ts,
        taskId: ev.taskId,
        discriminator: ev.eventId,
      }),
      ts: ev.ts,
      signal: "lawyer_edit",
      source: "runtime_events",
      ...(ev.taskId ? { taskId: ev.taskId } : {}),
      ...(ev.matterId ? { matterId: ev.matterId } : {}),
      ...(ev.deliverableType ? { deliverableType: ev.deliverableType } : {}),
      ...(outcome ? { labels: [outcome] } : {}),
      meta: { lintEscape },
    });
  }

  // ── 4. 质量快照（ReviewLabel 细粒度失败分类）────────────────────────────
  let qualityRows = 0;
  let qualityPresent = false;
  try {
    const records = await listQualityRecords(workspaceDir);
    qualityRows = records.length;
    qualityPresent = records.length > 0;
    for (const rec of records) {
      if (rec.reviewLabels.length === 0) {
        continue;
      }
      pushSample(samples, {
        sampleId: makeSampleId({
          signal: "review_label",
          ts: rec.createdAt,
          taskId: rec.taskId,
          matterId: rec.matterId,
          discriminator: rec.reviewLabels.join(","),
        }),
        ts: rec.createdAt,
        signal: "review_label",
        source: "quality",
        ...(rec.taskId ? { taskId: rec.taskId } : {}),
        ...(rec.matterId ? { matterId: rec.matterId } : {}),
        labels: rec.reviewLabels,
        meta: {
          reviewStatus: rec.reviewStatus,
          firstPassApproved: rec.firstPassApproved,
          isGoldenExample: rec.isGoldenExample,
        },
      });
    }
  } catch {
    // 质量快照损坏不应让整次导出失败。
    warnings.push("质量快照读取失败（workspace/quality/）；本次导出不含 ReviewLabel 样本。");
  }
  sources.push({
    id: "quality",
    path: "workspace/quality/*.json",
    present: qualityPresent,
    rows: qualityRows,
    ...(qualityPresent ? {} : { note: "尚无质量快照；ReviewLabel 语料为空。" }),
  });

  // ── 5. 拍板记录（matters/<id>/approvals.jsonl）──────────────────────────
  const matterIds = listMatterIdsFromStorage(workspaceDir);
  let approvalRows = 0;
  let approvalClosed = 0;
  for (const matterId of matterIds) {
    let rows: ReturnType<typeof readApprovals>;
    try {
      rows = readApprovals(workspaceDir, matterId);
    } catch {
      continue;
    }
    for (const a of rows) {
      approvalRows += 1;
      if (a.status === "pending") {
        // 待办不是标签——没有结论可学。
        continue;
      }
      approvalClosed += 1;
      const signal: DecisionSampleSignal =
        a.status === "approved"
          ? "approval_approved"
          : a.status === "rejected"
            ? "approval_rejected"
            : "approval_needs_changes";
      pushSample(samples, {
        sampleId: makeSampleId({
          signal,
          ts: a.requestedAt,
          matterId,
          discriminator: a.approvalId,
        }),
        ts: a.requestedAt,
        signal,
        source: "approvals",
        matterId,
        ...(a.deliverableId ? { taskId: a.deliverableId } : {}),
        labels: [a.status],
        meta: { riskLevel: a.riskLevel, reason: a.reason },
      });
    }
  }
  sources.push({
    id: "approvals",
    path: "matters/<id>/approvals.jsonl",
    present: matterIds.length > 0,
    rows: approvalRows,
    ...(matterIds.length > 0
      ? {}
      : { note: "工作区没有案件目录；拍板标签为空（这不等于没有驳回）。" }),
    ...(approvalRows > 0 && approvalClosed === 0
      ? { note: `${approvalRows} 条拍板全部仍是 pending——尚无结论可学。` }
      : {}),
  });

  // ── 汇总 ────────────────────────────────────────────────────────────────
  // 演练标记：先于汇总检测，因为它改变**整份报告该怎么读**。
  const drill = readDrillMarker(workspaceDir);
  if (drill) {
    sources.push({
      id: "drill",
      path: DRILL_MARKER_FILE,
      present: true,
      rows: 0,
      note: "本工作区由 `pnpm lawmind:round` 创建——数据是**演练**，不是真实办件。",
    });
    warnings.push(
      "**这是演练工作区**（发现 " +
        DRILL_MARKER_FILE +
        "）：数据可用来判断机制是否跑通，" +
        "**不得**据此推断规则覆盖率、律师改稿习惯或真实案件分布。",
    );
  }

  samples.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const report = buildReport({
    workspaceDir,
    samples,
    sources,
    warnings,
    truncated: product.truncated,
    drill: drill !== undefined,
  });
  return { samples, report, truncated: product.truncated };
}

function buildReport(input: {
  workspaceDir: string;
  samples: DecisionSample[];
  sources: DecisionSampleSourceReport[];
  warnings: string[];
  truncated: boolean;
  drill: boolean;
}): DecisionSamplesReport {
  const { samples, sources } = input;
  const bySignal: Record<string, number> = {};
  let withSnippet = 0;
  let snippetChars = 0;
  let atClipLimit = 0;
  for (const s of samples) {
    bySignal[s.signal] = (bySignal[s.signal] ?? 0) + 1;
    if (s.snippet) {
      withSnippet += 1;
      snippetChars += s.snippet.length;
      if (s.snippet.length >= SNIPPET_CLIP_CHARS) {
        atClipLimit += 1;
      }
    }
  }
  const withoutSnippet = samples.length - withSnippet;
  const warnings = [...input.warnings];

  // 数据缺口自述：把「看起来像 0」的情况说清楚，避免被当成「没有漏网」。
  const ruleMiss = bySignal.rule_miss ?? 0;
  const ruleHit = bySignal.rule_hit ?? 0;
  if (ruleMiss === 0 && ruleHit === 0) {
    warnings.push(
      "没有任何规则命中/漏网样本——该工作区尚无可用于编译规则的证据。不要据此认为规则覆盖完整。",
    );
  } else if (ruleMiss === 0) {
    warnings.push(
      `只有 ${ruleHit} 条规则命中、0 条漏网记录。遗漏样本为空可能意味着样本量不足，而不是规则无盲区。`,
    );
  }
  if (withoutSnippet > 0 && withSnippet === 0) {
    warnings.push("所有样本都没有正文片段——无法据此编译规则（只有计数，没有语料）。");
  }

  const firstPassOk = bySignal.first_pass_ok ?? 0;
  const firstPassFail = (bySignal.first_pass_fail ?? 0) + (bySignal.lawyer_edit ?? 0);
  const approvalsApproved = bySignal.approval_approved ?? 0;
  const approvalsRejected =
    (bySignal.approval_rejected ?? 0) + (bySignal.approval_needs_changes ?? 0);
  if (approvalsApproved + approvalsRejected === 0) {
    warnings.push("没有已结论的拍板记录。拍板是最干净的标签来源；此空白会让 P3 的校准器无法起步。");
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    workspaceDir: input.workspaceDir,
    drill: input.drill,
    sampleCount: samples.length,
    bySignal,
    sources,
    warnings,
    snippetStats: {
      withSnippet,
      withoutSnippet,
      avgChars: withSnippet > 0 ? Math.round(snippetChars / withSnippet) : null,
      clipChars: SNIPPET_CLIP_CHARS,
      atClipLimit,
    },
    labelBalance: { firstPassOk, firstPassFail, approvalsApproved, approvalsRejected },
    timeRange: {
      from: samples[0]?.ts ?? null,
      to: samples[samples.length - 1]?.ts ?? null,
    },
    truncated: input.truncated,
  };
}

/** 原子写：先写 `.tmp` 再 rename，避免半写撕档（与 `matter-storage/io.ts` 同口径）。 */
function writeFileAtomic(dest: string, content: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, dest);
}

/**
 * 写盘。**与 collect 分离**——导出器默认纯读取，只有显式调用这里才会落盘。
 * 返回写入的语料行数与报告路径。
 */
export function writeDecisionSamples(
  workspaceDir: string,
  collection: DecisionSamplesCollection,
): { samplesPath: string; reportPath: string; rows: number } {
  const samplesPath = decisionSamplesPath(workspaceDir);
  const reportPath = decisionReportPath(workspaceDir);
  const body = collection.samples.map((s) => JSON.stringify(s)).join("\n");
  writeFileAtomic(samplesPath, body ? `${body}\n` : "");
  writeFileAtomic(reportPath, `${JSON.stringify(collection.report, null, 2)}\n`);
  return { samplesPath, reportPath, rows: collection.samples.length };
}
