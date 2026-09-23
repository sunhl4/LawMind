/**
 * 常设工作（自动办件）的运行历史。
 *
 * 背景：此前每个自动办件只有 `lastRunAt / lastResultSummary / lastError*` —— **最后一次覆盖式**。
 * 后果是律师只看到「上次成功」或「上次失败」，看不出「过去 20 次里有 3 次缺数据」，
 * 而「这个常设工作到底靠不靠得住」正是决定要不要信它的唯一依据。
 *
 * 参照 [docs/LAWMIND-GROK-BOT-BORROW-REVIEW.md] C5：保留最近 N 次（默认 20），
 * 失败详情单独可查。文件按时间戳命名，天然的检索顺序。
 *
 * 存盘位置：`lawmind/automations/<id>/runs/<iso>__<runId>.json`
 * （与 `lawmind/automations/<id>.json` 同目录树，但不互相覆盖——自动化定义是单文件，历史是目录）
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { automationRunsDir } from "./automation-paths.js";

export { automationRunsDir } from "./automation-paths.js";

/** 每个自动办件保留的运行记录条数上限（超出即删最旧）。 */
export const AUTOMATION_RUN_RETENTION = 20;

export type AutomationRunTrigger =
  | "schedule"
  /** 律师在设置里点「立即运行」。 */
  | "manual"
  /** 「测试运行」：真跑，但与正式记录区分开。 */
  | "test";

export type AutomationRunStatus =
  | "ok"
  /** 抛错或返回失败。 */
  | "failed"
  /** 因缺数据/陈旧数据按 missingDataPolicy 跳过。 */
  | "skipped"
  /** 被信任闸挡住（待拍板、需授权）。 */
  | "blocked";

export type AutomationRunRecord = {
  runId: string;
  automationId: string;
  trigger: AutomationRunTrigger;
  status: AutomationRunStatus;
  startedAt: string;
  finishedAt: string;
  /** 律师可读的一句话结果。 */
  summary?: string;
  errorCode?: string;
  errorMessage?: string;
  jobId?: string;
  /** 本次运行发现的缺失/陈旧数据源（缺数据策略的输入）。 */
  missingData?: string[];
  /** 本次运行是否打扰了律师（是否产生收件箱项）。静默成功为 false。 */
  notified?: boolean;
};

/**
 * 生成 runId 与文件名。
 * 文件名前缀用 ISO 时间戳（把 `:` 换成 `-`，Windows 也能落盘），
 * 这样按文件名排序 == 按时间排序，list 不需要读每个文件。
 */
export function automationRunFileName(
  record: Pick<AutomationRunRecord, "startedAt" | "runId">,
): string {
  const stamp = record.startedAt.replace(/[:.]/g, "-");
  return `${stamp}__${record.runId}.json`;
}

/**
 * 落一条运行记录并按保留上限裁剪。失败静默：
 * 运行历史是运维观测，不是交付路径，不能因为写它把一次真正的办件打挂。
 */
export function appendAutomationRun(
  workspaceDir: string,
  record: AutomationRunRecord,
  opts: { keep?: number } = {},
): void {
  try {
    const dir = automationRunsDir(workspaceDir, record.automationId);
    fs.mkdirSync(dir, { recursive: true });
    writeJsonAtomic(path.join(dir, automationRunFileName(record)), record);
    pruneAutomationRuns(workspaceDir, record.automationId, opts.keep);
  } catch {
    /* best-effort */
  }
}

/** 读最近 limit 条，**新在前**。文件不存在时返回空数组（区分「从未跑过」与「跑过没事」）。 */
export function listAutomationRuns(
  workspaceDir: string,
  automationId: string,
  limit = AUTOMATION_RUN_RETENTION,
): AutomationRunRecord[] {
  const max = Math.max(0, Math.floor(limit) || 0);
  if (max === 0) {
    return [];
  }
  let names: string[];
  try {
    names = fs.readdirSync(automationRunsDir(workspaceDir, automationId));
  } catch {
    return [];
  }
  const files = names
    .filter((n) => n.endsWith(".json"))
    .toSorted()
    .toReversed();
  const out: AutomationRunRecord[] = [];
  for (const name of files) {
    if (out.length >= max) {
      break;
    }
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(automationRunsDir(workspaceDir, automationId), name), "utf8"),
      ) as AutomationRunRecord;
      if (raw && typeof raw === "object") {
        out.push(raw);
      }
    } catch {
      // 单条损坏不该让整段历史不可读——跳过它，保留其余。
    }
  }
  return out;
}

/** 按保留上限裁剪，返回删除条数。 */
export function pruneAutomationRuns(
  workspaceDir: string,
  automationId: string,
  keep: number = AUTOMATION_RUN_RETENTION,
): number {
  const limit = Math.max(0, Math.floor(keep) || 0);
  let names: string[];
  try {
    names = fs.readdirSync(automationRunsDir(workspaceDir, automationId));
  } catch {
    return 0;
  }
  const files = names
    .filter((n) => n.endsWith(".json"))
    .toSorted()
    .toReversed();
  const doomed = files.slice(limit);
  let removed = 0;
  for (const name of doomed) {
    try {
      fs.unlinkSync(path.join(automationRunsDir(workspaceDir, automationId), name));
      removed += 1;
    } catch {
      /* 另一进程已删 */
    }
  }
  return removed;
}

/** 删自动办件时连带清理历史；不清理会留下永远读不到的孤儿目录。 */
export function deleteAutomationRunHistory(workspaceDir: string, automationId: string): void {
  try {
    fs.rmSync(automationRunsDir(workspaceDir, automationId), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

export type AutomationRunStats = {
  total: number;
  okCount: number;
  failedCount: number;
  skippedCount: number;
  blockedCount: number;
  /** 缺数据导致的跳过/部分完成次数——决定这个常设工作可不可信的信号。 */
  missingDataCount: number;
  lastRunAt?: string;
  lastOkAt?: string;
  lastFailureAt?: string;
  /** 最近一条失败的错误码，供 UI 直接显示。 */
  lastErrorCode?: string;
};

/** 把一段运行历史压成律师能用的几个数（给设置页与准入量表用）。 */
export function summarizeAutomationRuns(runs: AutomationRunRecord[]): AutomationRunStats {
  const stats: AutomationRunStats = {
    total: runs.length,
    okCount: 0,
    failedCount: 0,
    skippedCount: 0,
    blockedCount: 0,
    missingDataCount: 0,
  };
  for (const run of runs) {
    if (run.status === "ok") {
      stats.okCount += 1;
      stats.lastOkAt ??= run.finishedAt ?? run.startedAt;
    }
    if (run.status === "failed") {
      stats.failedCount += 1;
      stats.lastFailureAt ??= run.finishedAt ?? run.startedAt;
      stats.lastErrorCode ??= run.errorCode;
    }
    if (run.status === "skipped") {
      stats.skippedCount += 1;
    }
    if (run.status === "blocked") {
      stats.blockedCount += 1;
    }
    if (run.missingData && run.missingData.length > 0) {
      stats.missingDataCount += 1;
    }
    stats.lastRunAt ??= run.finishedAt ?? run.startedAt;
  }
  return stats;
}

/**
 * 自动化准入量表（策略文档 I6）。
 *
 * 「连续 3 次带源链接、无越权、失败可恢复」才是可以扩面的信号。
 * 这里只做**可判定**的那部分：至少跑过 3 次、最近 3 次没有失败、
 * 且没有反复缺数据。不满足时给律师一句人话，而不是一个布尔。
 */
export const AUTOMATION_PROMOTION_MIN_RUNS = 3;

export type AutomationPromotionVerdict = {
  ready: boolean;
  /** 律师可读的一句结论。 */
  message: string;
  reasons: string[];
  /**
   * 这条结论建立在什么之上：用了几条、总共几条。
   *
   * 为什么必须显式给出（对齐试点协议的样本纪律）：结论只取「最近 3 次」这个窗口，
   * 而窗口不交代覆盖率时，20 次里最后 3 次干净与总共 3 次干净看起来一样。
   * 协议把这类错误说得很清楚——**只算后半段会引入采样偏差**，曲线看着像变好，
   * 实际只是覆盖变了。
   */
  basis: { usedRuns: number; totalRuns: number };
};

export function assessAutomationPromotion(runs: AutomationRunRecord[]): AutomationPromotionVerdict {
  const used = Math.min(runs.length, AUTOMATION_PROMOTION_MIN_RUNS);
  const recent = runs.slice(0, AUTOMATION_PROMOTION_MIN_RUNS);
  const basis = { usedRuns: used, totalRuns: runs.length };
  const reasons: string[] = [];
  if (runs.length < AUTOMATION_PROMOTION_MIN_RUNS) {
    // 证据不足 ≠ 有问题：这句刻意与下面的「失败/缺资料」区分开（协议要求两者是不同的句子）。
    reasons.push(`还需要再成功跑 ${AUTOMATION_PROMOTION_MIN_RUNS - runs.length} 次才有依据。`);
  }
  const failed = recent.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    reasons.push(`最近 ${AUTOMATION_PROMOTION_MIN_RUNS} 次里有 ${failed.length} 次失败。`);
  }
  const missing = recent.filter((r) => (r.missingData?.length ?? 0) > 0);
  if (missing.length > 0) {
    reasons.push(`最近 ${AUTOMATION_PROMOTION_MIN_RUNS} 次里有 ${missing.length} 次遇到资料缺失。`);
  }
  const coverage = `（依据最近 ${used} 次，共 ${runs.length} 次记录）`;
  if (reasons.length === 0) {
    return {
      ready: true,
      message: `最近 ${used} 次连续办成${coverage}。`,
      reasons: [],
      basis,
    };
  }
  return { ready: false, message: `${reasons[0] ?? ""}${coverage}`, reasons, basis };
}
