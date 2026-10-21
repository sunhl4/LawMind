/**
 * Authority call metering for Doctor (C1-4 / G4).
 * Stores counts only — never query text or secrets.
 */

import fs from "node:fs";
import path from "node:path";
import type { AuthorityCallOutcome } from "./authority-outcome.js";
import type { AuthorityProviderId } from "./authority-provider.js";

export type AuthorityUsageDay = {
  day: string;
  ok: number;
  error: number;
  byStatus: Record<string, number>;
  byProvider: Record<string, number>;
  /** New records only; older ok/error totals cannot be reclassified retrospectively. */
  byOutcome?: Record<string, number>;
  hits?: number;
};

export type AuthorityUsageSummary = {
  day: string;
  ok: number;
  error: number;
  total: number;
  byOutcome: Record<string, number>;
  hits: number;
  unclassified: number;
  /** Lawyer-facing one-liner */
  message: string;
};

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function authorityUsagePath(workspaceDir: string): string {
  return path.join(workspaceDir, "ops", "authority-usage.json");
}

function readStore(workspaceDir: string): { days: AuthorityUsageDay[] } {
  const p = authorityUsagePath(workspaceDir);
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { days?: AuthorityUsageDay[] };
    return { days: Array.isArray(raw.days) ? raw.days : [] };
  } catch {
    return { days: [] };
  }
}

function writeStore(workspaceDir: string, store: { days: AuthorityUsageDay[] }): void {
  const p = authorityUsagePath(workspaceDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, p);
}

export function recordAuthorityUsage(
  workspaceDir: string,
  event: {
    ok: boolean;
    httpStatus?: number;
    provider: AuthorityProviderId;
    outcome?: AuthorityCallOutcome;
  },
): AuthorityUsageDay {
  const store = readStore(workspaceDir);
  const day = dayKey();
  let row = store.days.find((d) => d.day === day);
  if (!row) {
    row = { day, ok: 0, error: 0, byStatus: {}, byProvider: {} };
    store.days.push(row);
  }
  if (event.ok) {
    row.ok += 1;
  } else {
    row.error += 1;
  }
  if (event.outcome) {
    row.byOutcome ??= {};
    row.byOutcome[event.outcome.status] = (row.byOutcome[event.outcome.status] ?? 0) + 1;
    row.hits = (row.hits ?? 0) + event.outcome.hitCount;
  }
  const statusKey = event.httpStatus != null ? String(event.httpStatus) : event.ok ? "ok" : "error";
  row.byStatus[statusKey] = (row.byStatus[statusKey] ?? 0) + 1;
  row.byProvider[event.provider] = (row.byProvider[event.provider] ?? 0) + 1;
  // Keep last 14 days
  store.days = store.days.toSorted((a, b) => a.day.localeCompare(b.day)).slice(-14);
  writeStore(workspaceDir, store);
  return row;
}

export function buildAuthorityUsageSummary(workspaceDir: string): AuthorityUsageSummary {
  const day = dayKey();
  const store = readStore(workspaceDir);
  const row = store.days.find((d) => d.day === day);
  const ok = row?.ok ?? 0;
  const error = row?.error ?? 0;
  const total = ok + error;
  const byOutcome = row?.byOutcome ?? {};
  const classified = Object.values(byOutcome).reduce((sum, n) => sum + n, 0);
  const unclassified = Math.max(0, total - classified);
  return {
    day,
    ok,
    error,
    total,
    byOutcome,
    hits: row?.hits ?? 0,
    unclassified,
    message:
      total === 0
        ? "今日尚无权威库调用记录。"
        : classified > 0
          ? `今日权威调用 ${total} 次（有结果 ${byOutcome.ok ?? 0} / 正常无命中 ${byOutcome.empty ?? 0} / 服务异常 ${classified - (byOutcome.ok ?? 0) - (byOutcome.empty ?? 0)}${unclassified ? ` / 旧记录未分类 ${unclassified}` : ""}）。不含查询正文。`
          : `今日权威调用 ${total} 次（旧口径成功 ${ok} / 失败或无命中 ${error}；服务状态未分类）。不含查询正文。`,
  };
}
