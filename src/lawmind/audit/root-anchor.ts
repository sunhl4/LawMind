/**
 * 审计根哈希外锚（append-only）。
 *
 * 每条 chained 事件落盘时，把当日链的最新根哈希（该事件的 eventHash）追加到
 * `audit/audit-root.log`（含时间戳）。外锚独立于按日轮转的 jsonl：
 * 尾部截断某日链文件后，文件尾链哈希与外锚记录的最新根哈希不一致即可被发现。
 *
 * 注意：外锚与链文件同处工作区，防的是「只改链文件」的篡改/撕档与意外截断；
 * 同时改写两个文件或异机锚定（导出到外系统）属于后续工作。
 */

import fs from "node:fs";
import path from "node:path";
import {
  verifyAuditHashChain,
  type AuditChainVerifyResult,
  type AuditEventWithIntegrity,
} from "./hash-chain.js";

export type AuditRootAnchorEntry = {
  v: 1;
  timestamp: string;
  /** 对应的按日审计文件日期（YYYY-MM-DD，即 jsonl 文件名）。 */
  date: string;
  /** 写入该锚点时当日链的根哈希（最新一条 chained 事件的 eventHash）。 */
  rootHash: string;
  eventId: string;
};

export function auditRootAnchorPath(auditDir: string): string {
  return path.join(auditDir, "audit-root.log");
}

/** 追加外锚。调用方须持有审计文件锁，与链 append 处于同一临界区。 */
export function appendAuditRootAnchor(
  auditDir: string,
  entry: { date: string; rootHash: string; eventId: string },
): void {
  const line: AuditRootAnchorEntry = { v: 1, timestamp: new Date().toISOString(), ...entry };
  fs.appendFileSync(auditRootAnchorPath(auditDir), `${JSON.stringify(line)}\n`, "utf8");
}

export function readAuditRootAnchors(auditDir: string): AuditRootAnchorEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(auditRootAnchorPath(auditDir), "utf8");
  } catch {
    return [];
  }
  const out: AuditRootAnchorEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Partial<AuditRootAnchorEntry>;
      if (
        parsed.v === 1 &&
        typeof parsed.date === "string" &&
        typeof parsed.rootHash === "string" &&
        typeof parsed.timestamp === "string"
      ) {
        out.push({
          v: 1,
          timestamp: parsed.timestamp,
          date: parsed.date,
          rootHash: parsed.rootHash,
          eventId: typeof parsed.eventId === "string" ? parsed.eventId : "",
        });
      }
    } catch {
      // skip bad line
    }
  }
  return out;
}

/** 某日期的最新一条外锚（无则 null）。 */
export function latestAuditRootAnchor(auditDir: string, date: string): AuditRootAnchorEntry | null {
  const all = readAuditRootAnchors(auditDir);
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].date === date) {
      return all[i];
    }
  }
  return null;
}

export type AuditFileAnchorVerify = {
  ok: boolean;
  chainedCount: number;
  brokenAt?: number;
  reason?: AuditChainVerifyResult["reason"] | "anchor_mismatch";
  /** 外锚最新根哈希与文件尾链哈希不一致 → 疑似尾部截断（或外锚被改）。 */
  tailTruncationSuspected: boolean;
  anchor: AuditRootAnchorEntry | null;
};

/** 校验单个按日审计文件：全链 HMAC/legacy + 连续性 + 与外锚比对的尾部截断检测。 */
export function verifyAuditFileWithAnchor(
  auditFilePath: string,
  opts?: { key?: Buffer | null },
): AuditFileAnchorVerify {
  const auditDir = path.dirname(auditFilePath);
  const date = path.basename(auditFilePath).replace(/\.jsonl$/, "");
  let events: AuditEventWithIntegrity[] = [];
  try {
    events = fs
      .readFileSync(auditFilePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as AuditEventWithIntegrity);
  } catch {
    /* 文件不存在按空链处理：有外锚即判截断 */
  }
  const chained = events.filter((e) => typeof e.eventHash === "string" && e.eventHash.length > 0);
  const anchor = latestAuditRootAnchor(auditDir, date);
  const chain = verifyAuditHashChain(chained, opts);
  if (!chain.ok) {
    return {
      ok: false,
      chainedCount: chained.length,
      brokenAt: chain.brokenAt,
      reason: chain.reason,
      tailTruncationSuspected: false,
      anchor,
    };
  }
  const tailHash = chained.length > 0 ? (chained[chained.length - 1].eventHash ?? "") : "";
  if (anchor && anchor.rootHash !== tailHash) {
    return {
      ok: false,
      chainedCount: chained.length,
      reason: "anchor_mismatch",
      tailTruncationSuspected: true,
      anchor,
    };
  }
  return { ok: true, chainedCount: chained.length, tailTruncationSuspected: false, anchor };
}

export type AuditWorkspaceTailAnchorSummary = {
  ok: boolean;
  /** 有外锚记录、纳入比对的日期数。 */
  checkedDays: number;
  /** 外锚与文件尾不一致（疑似尾部截断）的日期。 */
  truncatedDays: string[];
  /** 链本身校验失败（篡改/断链/密钥不可用）的日期。 */
  brokenDays: string[];
};

/** 扫描 auditDir 下所有有外锚的日期文件，汇总尾部截断/断链疑似（无外锚的 legacy 日期不参与）。 */
export function verifyAuditWorkspaceTailAnchors(
  auditDir: string,
  opts?: { key?: Buffer | null },
): AuditWorkspaceTailAnchorSummary {
  const dates = [...new Set(readAuditRootAnchors(auditDir).map((a) => a.date))].toSorted();
  const truncatedDays: string[] = [];
  const brokenDays: string[] = [];
  for (const date of dates) {
    const result = verifyAuditFileWithAnchor(path.join(auditDir, `${date}.jsonl`), opts);
    if (result.tailTruncationSuspected) {
      truncatedDays.push(date);
    } else if (!result.ok) {
      brokenDays.push(date);
    }
  }
  return {
    ok: truncatedDays.length === 0 && brokenDays.length === 0,
    checkedDays: dates.length,
    truncatedDays,
    brokenDays,
  };
}
