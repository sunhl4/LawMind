/**
 * Audit Layer — 审计日志
 *
 * 每个任务的关键步骤都必须生成一条 AuditEvent 并持久化。
 * 默认以 JSONL 格式追加写入 audit/ 目录，按天分文件。
 *
 * 扩展方式：
 *   替换 persist 函数为其他存储后端（数据库、区块链存证等），
 *   不需要修改 emit() 调用方。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { listTaskRecords } from "../tasks/index.js";
import type { AuditEvent, AuditEventKind } from "../types.js";

// ─────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────

function todayAuditPath(auditDir: string): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return path.join(auditDir, `${yyyy}-${mm}-${dd}.jsonl`);
}

// ─────────────────────────────────────────────
// 主接口
// ─────────────────────────────────────────────

export type EmitParams = {
  taskId: string;
  kind: AuditEventKind;
  actor: AuditEvent["actor"];
  actorId?: string;
  detail?: string;
};

/**
 * 生成并持久化一条审计事件。
 * 调用方不需要管 eventId 和 timestamp，由此函数填写。
 */
export async function emit(auditDir: string, params: EmitParams): Promise<AuditEvent> {
  const event: AuditEvent = {
    eventId: randomUUID(),
    taskId: params.taskId,
    kind: params.kind,
    actor: params.actor,
    actorId: params.actorId,
    detail: params.detail,
    timestamp: new Date().toISOString(),
  };

  await persist(auditDir, event);
  return event;
}

async function persist(auditDir: string, event: AuditEvent): Promise<void> {
  await fs.mkdir(auditDir, { recursive: true });
  const line = JSON.stringify(event) + "\n";
  await fs.appendFile(todayAuditPath(auditDir), line, "utf8");
}

// ─────────────────────────────────────────────
// 读取（用于回放和展示）
// ─────────────────────────────────────────────

/**
 * 读取某天的审计事件列表。
 * date 格式：YYYY-MM-DD，默认今天。
 */
export async function readAuditLog(auditDir: string, date?: string): Promise<AuditEvent[]> {
  const target = date ? path.join(auditDir, `${date}.jsonl`) : todayAuditPath(auditDir);

  const content = await fs.readFile(target, "utf8").catch(() => "");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditEvent);
}

export async function readAllAuditLogs(auditDir: string): Promise<AuditEvent[]> {
  const files = await fs
    .readdir(auditDir)
    .then((entries) => entries.filter((name) => name.endsWith(".jsonl")).sort())
    .catch(() => [] as string[]);

  const batches = await Promise.all(
    files.map(async (name) => {
      const content = await fs.readFile(path.join(auditDir, name), "utf8").catch(() => "");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEvent);
    }),
  );

  return batches.flat().toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// ─────────────────────────────────────────────
// 可导出报告（Phase A：按案件 / 任务筛选，Markdown）
// ─────────────────────────────────────────────

export type AuditExportFilters = {
  matterId?: string;
  taskId?: string;
  /** ISO 8601：保留 timestamp >= since */
  since?: string;
  /** ISO 8601：保留 timestamp <= until */
  until?: string;
  /** 超出时保留时间最近的若干条（默认 2000） */
  maxEvents?: number;
};

/**
 * 在内存中筛选审计事件（可单测，不读盘）。
 * - 同时指定 taskId 与 matterId 时，以 taskId 为准。
 * - 按 matterId 筛选时，用当前 workspace 下任务记录的 matterId 映射到 taskId。
 */
export function filterAuditEventsForExport(
  events: AuditEvent[],
  workspaceDir: string,
  filters: AuditExportFilters,
): AuditEvent[] {
  let out = [...events];
  const tid = filters.taskId?.trim();
  const mid = filters.matterId?.trim();
  if (tid) {
    out = out.filter((e) => e.taskId === tid);
  } else if (mid) {
    const taskIds = new Set(
      listTaskRecords(workspaceDir)
        .filter((t) => t.matterId === mid)
        .map((t) => t.taskId),
    );
    out = out.filter((e) => taskIds.has(e.taskId));
  }
  const since = filters.since?.trim();
  if (since) {
    out = out.filter((e) => e.timestamp >= since);
  }
  const until = filters.until?.trim();
  if (until) {
    out = out.filter((e) => e.timestamp <= until);
  }
  out = out.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
  const max = filters.maxEvents ?? 2000;
  if (out.length > max) {
    out = out.slice(-max);
  }
  return out;
}

function escapeMdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

/**
 * 将筛选后的事件格式化为 Markdown（便于存档、打印、发给 IT）。
 */
export function formatAuditExportMarkdown(
  workspaceDir: string,
  events: AuditEvent[],
  filters: AuditExportFilters,
): string {
  const lines: string[] = [
    "# LawMind audit export",
    "",
    "<!-- LawMind audit export format: 2 -->",
    "",
    `- **Generated:** ${new Date().toISOString()}`,
    `- **Workspace:** \`${workspaceDir}\``,
    `- **Export schema version:** 2`,
    `- **Event count:** ${events.length}`,
  ];
  if (filters.matterId) {
    lines.push(`- **Filter matterId:** \`${filters.matterId}\``);
  }
  if (filters.taskId) {
    lines.push(`- **Filter taskId:** \`${filters.taskId}\``);
  }
  if (filters.since) {
    lines.push(`- **Since:** \`${filters.since}\``);
  }
  if (filters.until) {
    lines.push(`- **Until:** \`${filters.until}\``);
  }
  lines.push(
    "",
    "| timestamp | kind | actor | taskId | detail |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const e of events) {
    const actor = e.actor + (e.actorId?.trim() ? ` (${escapeMdCell(e.actorId.trim())})` : "");
    lines.push(
      `| ${e.timestamp} | ${e.kind} | ${actor} | ${e.taskId} | ${escapeMdCell(e.detail ?? "")} |`,
    );
  }
  return lines.join("\n");
}

/**
 * 读取 workspace `audit/` 下全部 JSONL，筛选后输出 Markdown。
 */
export async function buildAuditExportMarkdown(
  workspaceDir: string,
  filters: AuditExportFilters = {},
): Promise<string> {
  const auditDir = path.join(workspaceDir, "audit");
  const all = await readAllAuditLogs(auditDir);
  const filtered = filterAuditEventsForExport(all, workspaceDir, filters);
  return formatAuditExportMarkdown(workspaceDir, filtered, filters);
}

function countAuditKinds(events: AuditEvent[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const e of events) {
    m[e.kind] = (m[e.kind] ?? 0) + 1;
  }
  return m;
}

/**
 * 合规向审计摘要：在标准导出前增加事件统计与免责声明（仍为非法律意见）。
 */
export async function buildComplianceAuditMarkdown(
  workspaceDir: string,
  filters: AuditExportFilters = {},
): Promise<string> {
  const auditDir = path.join(workspaceDir, "audit");
  const all = await readAllAuditLogs(auditDir);
  const filtered = filterAuditEventsForExport(all, workspaceDir, filters);
  const counts = countAuditKinds(filtered);
  const countsLines = Object.keys(counts)
    .toSorted((a, b) => a.localeCompare(b))
    .map((k) => `- \`${k}\`: ${counts[k]}`);
  const cover = [
    "# LawMind compliance-oriented audit summary",
    "",
    "<!-- LawMind audit export format: 2 -->",
    "",
    "_This report is informational only. It does not constitute legal advice, certification, or a guarantee of completeness._",
    "",
    `- **Generated:** ${new Date().toISOString()}`,
    `- **Workspace:** \`${workspaceDir}\``,
    `- **Export schema version:** 2`,
    `- **Events included:** ${filtered.length}`,
    "",
    "## Filters",
    "",
    `- matterId: ${filters.matterId ?? "_none_"}`,
    `- taskId: ${filters.taskId ?? "_none_"}`,
    `- since: ${filters.since ?? "_none_"}`,
    `- until: ${filters.until ?? "_none_"}`,
    "",
    "## Event counts by kind",
    "",
    ...(countsLines.length ? countsLines : ["_None_"]),
    "",
    "---",
    "",
  ].join("\n");
  const body = formatAuditExportMarkdown(workspaceDir, filtered, filters);
  return `${cover}\n${body}`;
}
