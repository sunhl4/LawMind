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
