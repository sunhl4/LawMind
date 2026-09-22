/**
 * 协作审计（所级报表）—— 把「谁在何时邀请 / 加入 / 签出 / 入卷 / 轮换密钥」写进
 * **防篡改审计链**，并能按所、按案件、按人导出。
 *
 * ## 为什么需要它
 *
 * 协作动作原先只落 `ops.jsonl`（同步用的日志），**从不进入审计链** ——
 * 于是律所采购清单上的「谁在何时动了卷宗」在协作场景下是空白（差距评审 G3）。
 *
 * ## 为什么不能复用既有的按案件筛选
 *
 * `filterAuditEventsForExport` 按 matterId 筛选时，走的是「matterId → taskId → 事件」，
 * 而协作动作**不是任务**，没有 taskId 可反查。所以协作事件自带 `matterId`，
 * 报表按该字段筛选（这也是 `canonicalPayload` 需要条件包含 matterId 的原因）。
 *
 * ## 写入是「尽力而为 + 可等待」
 *
 * 审计写入要拿文件锁并算哈希链，是异步的；而结出动作的引擎函数是同步的。
 * 所以这里用「投递即忘 + 显式 flush」：动作不被审计 IO 拖慢，而生成报表前
 * `flushCollaborationAudit()` 能保证刚发生的动作已落盘（报表不会漏掉最后一笔）。
 */

import path from "node:path";
import { listMatterIdsFromStorage } from "../adapters/matter-storage/index.js";
import { readMembership } from "../matter-replica/membership.js";
import type { AuditEvent, AuditEventKind } from "../types.js";
import { verifyAuditHashChain, type AuditEventWithIntegrity } from "./hash-chain.js";
import { readRecentAuditLogs, emit } from "./index.js";

/** 协作事件的 kind 前缀（报表按此筛选；新增协作事件只要沿用前缀即可被收录）。 */
export const COLLAB_KIND_PREFIX = "collab.";

/** 协作事件的 taskId 约定：它不属于任何任务，用案件号构造一个稳定占位。 */
export function collabTaskId(matterId: string): string {
  return `collab:${matterId}`;
}

export type CollabAuditInput = {
  matterId: string;
  kind: AuditEventKind;
  actorId?: string;
  actorName?: string;
  actor?: AuditEvent["actor"];
  detail?: string;
};

// ─────────────────────────────────────────────────────────────
// 投递（不阻塞动作）+ flush（报表前对齐）
// ─────────────────────────────────────────────────────────────

const pending = new Set<Promise<void>>();

/**
 * 记一条协作审计事件。**不等待**写入完成 —— 审计 IO 不该拖慢签出/入卷。
 * 需要确定性时（测试、报表）调用 `flushCollaborationAudit()`。
 */
export function emitCollaborationAudit(workspaceDir: string, input: CollabAuditInput): void {
  if (!input.matterId) {
    return;
  }
  const auditDir = path.join(path.resolve(workspaceDir), "audit");
  const task = emit(auditDir, {
    taskId: collabTaskId(input.matterId),
    kind: input.kind,
    actor: input.actor ?? "lawyer",
    actorId: input.actorId,
    actorName: input.actorName,
    matterId: input.matterId,
    detail: input.detail,
  })
    .then(() => undefined)
    .catch(() => {
      // 审计写入失败只告警（与外部锚同姿态）：不让合规 IO 把办案动作搞崩。
      // 真正的兜底是 Doctor / 链校验发现缺口。
    });
  pending.add(task);
  void task.finally(() => pending.delete(task));
}

/** 等待所有已投递的协作审计事件落盘。 */
export async function flushCollaborationAudit(): Promise<void> {
  // flush 期间可能有新投递（await 让出事件循环），循环到清空为止。
  while (pending.size > 0) {
    await Promise.allSettled(pending);
  }
}

// ─────────────────────────────────────────────────────────────
// 所级报表
// ─────────────────────────────────────────────────────────────

export type FirmCollaborationAuditOptions = {
  /** ISO 8601，含边界 */
  since?: string;
  /** ISO 8601，含边界 */
  until?: string;
  /** 总保留条数上限（默认 5000，超出取最近） */
  maxEvents?: number;
  /** 只看某个案件 */
  matterId?: string;
};

export type FirmCollaborationAuditEvent = {
  timestamp: string;
  kind: string;
  matterId?: string;
  actorId?: string;
  actorName?: string;
  detail?: string;
};

export type FirmCollaborationAuditReport = {
  schemaVersion: 1;
  generatedAt: string;
  workspaceDir: string;
  range: { since: string | null; until: string | null; scannedEvents: number };
  /** 链完整性：采购最关心的一条 —— 报表本身是否可验篡改 */
  integrity: {
    chained: boolean;
    ok: boolean;
    brokenAt?: number;
    reason?: string;
    note: string;
  };
  totals: { events: number; matters: number; actors: number };
  byKind: Array<{ kind: string; count: number }>;
  byMatter: Array<{ matterId: string; matterTitle: string | null; events: number; lastAt: string }>;
  byActor: Array<{ actorId: string; displayName: string | null; events: number; lastAt: string }>;
  events: FirmCollaborationAuditEvent[];
};

function isCollabEvent(event: AuditEvent): boolean {
  return typeof event.kind === "string" && event.kind.startsWith(COLLAB_KIND_PREFIX);
}

function inRange(event: AuditEvent, since?: string, until?: string): boolean {
  if (since && event.timestamp < since) {
    return false;
  }
  if (until && event.timestamp > until) {
    return false;
  }
  return true;
}

/**
 * 汇总所级协作审计。
 *
 * 名册只用于把 lawyerId 翻成人名（报表要「谁」）；取不到不影响计数。
 */
export async function buildFirmCollaborationAuditReport(
  workspaceDir: string,
  opts: FirmCollaborationAuditOptions = {},
): Promise<FirmCollaborationAuditReport> {
  // 先对齐：让刚发生的动作进入本次报表
  await flushCollaborationAudit();

  const auditDir = path.join(path.resolve(workspaceDir), "audit");
  const allEvents = (await readRecentAuditLogs(auditDir, {
    maxEvents: opts.maxEvents ?? 5000,
  })) as AuditEventWithIntegrity[];

  // 链校验只对**链式事件**有意义：legacy（无 eventHash）事件不参与
  const chained = allEvents.filter((e) => typeof e.eventHash === "string");
  const verify = chained.length > 0 ? verifyAuditHashChain(chained) : { ok: true as const };
  const integrity = {
    chained: chained.length > 0,
    ok: verify.ok,
    brokenAt: verify.brokenAt,
    reason: verify.reason,
    note:
      chained.length === 0
        ? "本工作区未开启审计链（Solo 默认关闭）；报表可读，但不具防篡改保证。"
        : verify.ok
          ? "审计链完整：报表中的协作事件受 HMAC-SHA256 链保护，改动任意一条都会验签失败。"
          : "审计链校验失败：请勿采信本报表，先排查链断裂原因。",
  };

  const collab = allEvents
    .filter(isCollabEvent)
    .filter((e) => inRange(e, opts.since, opts.until))
    .filter((e) => (opts.matterId ? e.matterId === opts.matterId : true))
    .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));

  const byKindMap = new Map<string, number>();
  const byMatterMap = new Map<string, { events: number; lastAt: string }>();
  const byActorMap = new Map<string, { events: number; lastAt: string }>();
  for (const e of collab) {
    byKindMap.set(e.kind, (byKindMap.get(e.kind) ?? 0) + 1);
    if (e.matterId) {
      const prev = byMatterMap.get(e.matterId);
      byMatterMap.set(e.matterId, {
        events: (prev?.events ?? 0) + 1,
        lastAt: !prev || e.timestamp > prev.lastAt ? e.timestamp : prev.lastAt,
      });
    }
    const actorId = e.actorId ?? "(未署名)";
    const prevActor = byActorMap.get(actorId);
    byActorMap.set(actorId, {
      events: (prevActor?.events ?? 0) + 1,
      lastAt: !prevActor || e.timestamp > prevActor.lastAt ? e.timestamp : prevActor.lastAt,
    });
  }

  // 名册：lawyerId → 人名 / 案件名
  // 事件自带 actorName 优先 —— 名册可能已经不含此人（已移出、或不在本机名册里），
  // 而审计事件本身记着当时是谁做的，那才是更权威的「谁」。
  const names = new Map<string, string>();
  const titles = new Map<string, string>();
  for (const e of collab) {
    if (e.actorId && e.actorName && !names.has(e.actorId)) {
      names.set(e.actorId, e.actorName);
    }
  }
  for (const matterId of listMatterIdsFromStorage(workspaceDir)) {
    try {
      const membership = readMembership(workspaceDir, matterId);
      if (!membership) {
        continue;
      }
      titles.set(matterId, membership.matterTitle);
      for (const m of membership.members) {
        if (!names.has(m.lawyerId)) {
          names.set(m.lawyerId, m.displayName);
        }
      }
    } catch {
      /* 跳过非法案件 */
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    workspaceDir,
    range: {
      since: opts.since ?? null,
      until: opts.until ?? null,
      scannedEvents: allEvents.length,
    },
    integrity,
    totals: {
      events: collab.length,
      matters: byMatterMap.size,
      actors: [...byActorMap.keys()].filter((k) => k !== "(未署名)").length,
    },
    byKind: [...byKindMap.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .toSorted((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    byMatter: [...byMatterMap.entries()]
      .map(([matterId, v]) => ({
        matterId,
        matterTitle: titles.get(matterId) ?? null,
        events: v.events,
        lastAt: v.lastAt,
      }))
      .toSorted((a, b) => b.events - a.events || a.matterId.localeCompare(b.matterId)),
    byActor: [...byActorMap.entries()]
      .map(([actorId, v]) => ({
        actorId,
        displayName: names.get(actorId) ?? null,
        events: v.events,
        lastAt: v.lastAt,
      }))
      .toSorted((a, b) => b.events - a.events || a.actorId.localeCompare(b.actorId)),
    events: collab.map((e) => ({
      timestamp: e.timestamp,
      kind: e.kind,
      matterId: e.matterId,
      actorId: e.actorId,
      actorName: e.actorName,
      detail: e.detail,
    })),
  };
}

const KIND_LABELS: Record<string, string> = {
  "collab.invite_created": "生成邀请",
  "collab.invite_accepted": "同事加入本案",
  "collab.invite_revoked": "撤销邀请",
  "collab.member_removed": "移出成员",
  "collab.member_key_published": "公布设备公钥",
  "collab.key_rotated": "轮换案件密钥",
  "collab.key_distributed": "补发案件密钥",
  "collab.document_checked_out": "签出文件",
  "collab.document_released": "释放签出",
  "collab.material_filed": "材料入卷",
  "collab.material_removed": "移除材料",
  "collab.integrity_rejected": "拒收可疑内容",
  "collab.conflict_parked": "冲突旁路",
  "collab.cloud_roster_applied": "同步云名册",
  "collab.sync_activity": "同步（有变化）",
};

export function collaborationKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/** 可打印/可交付的 Markdown 报表（律所采购与合规存档用）。 */
export function formatFirmCollaborationAuditMarkdown(report: FirmCollaborationAuditReport): string {
  const lines: string[] = [
    "# LawMind 协作审计报表（所级）",
    "",
    "<!-- LawMind collaboration audit format: 1 -->",
    "",
    `- **生成时间：** ${report.generatedAt}`,
    `- **工作区：** \`${report.workspaceDir}\``,
    `- **时间范围：** ${report.range.since ?? "（不限）"} → ${report.range.until ?? "（不限）"}`,
    `- **扫描审计事件：** ${report.range.scannedEvents}（其中协作事件 ${report.totals.events}）`,
    "",
    "## 完整性",
    "",
    `- **是否启用审计链：** ${report.integrity.chained ? "是" : "否"}`,
    `- **链校验：** ${report.integrity.ok ? "通过" : "**失败**"}${
      report.integrity.brokenAt !== undefined ? `（断点序号 ${report.integrity.brokenAt}）` : ""
    }`,
    `- **说明：** ${report.integrity.note}`,
    "",
    "## 概览",
    "",
    `- **涉及案件：** ${report.totals.matters}`,
    `- **涉及律师：** ${report.totals.actors}`,
    `- **协作事件：** ${report.totals.events}`,
    "",
  ];

  if (report.byKind.length > 0) {
    lines.push("## 按动作类型", "", "| 动作 | 次数 |", "| --- | --- |");
    for (const row of report.byKind) {
      lines.push(`| ${collaborationKindLabel(row.kind)} | ${row.count} |`);
    }
    lines.push("");
  }

  if (report.byActor.length > 0) {
    lines.push("## 按律师", "", "| 律师 | 标识 | 次数 | 最近动作 |", "| --- | --- | --- | --- |");
    for (const row of report.byActor) {
      lines.push(
        `| ${row.displayName ?? "（未在册）"} | \`${row.actorId}\` | ${row.events} | ${row.lastAt} |`,
      );
    }
    lines.push("");
  }

  if (report.byMatter.length > 0) {
    lines.push("## 按案件", "", "| 案件 | 标识 | 次数 | 最近动作 |", "| --- | --- | --- | --- |");
    for (const row of report.byMatter) {
      lines.push(
        `| ${row.matterTitle ?? "（未在册）"} | \`${row.matterId}\` | ${row.events} | ${row.lastAt} |`,
      );
    }
    lines.push("");
  }

  if (report.events.length > 0) {
    lines.push(
      "## 明细",
      "",
      "| 时间 | 动作 | 案件 | 律师 | 备注 |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const e of report.events) {
      lines.push(
        `| ${e.timestamp} | ${collaborationKindLabel(e.kind)} | \`${e.matterId ?? "-"}\` | ${
          e.actorName ?? e.actorId ?? "-"
        } | ${(e.detail ?? "").replace(/\|/g, "/")} |`,
      );
    }
    lines.push("");
  } else {
    lines.push("## 明细", "", "该时间范围内没有协作事件。", "");
  }

  lines.push(
    "---",
    "",
    "本报表由 LawMind 本地审计链生成。启用审计链时，任一事件被改动都会导致链校验失败；",
    "校验方式：`POST /api/audit/verify-external`（外部锚）或本机链校验。",
    "",
  );
  return lines.join("\n");
}
