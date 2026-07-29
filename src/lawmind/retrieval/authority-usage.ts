/**
 * Authority call metering for Doctor (C1-4 / G4).
 * Stores counts only — never query text or secrets.
 */

import fs from "node:fs";
import path from "node:path";
import type { AuthorityProviderId } from "./authority-provider.js";

export type AuthorityUsageDay = {
  day: string;
  ok: number;
  error: number;
  byStatus: Record<string, number>;
  byProvider: Record<string, number>;
};

export type AuthorityUsageSummary = {
  day: string;
  ok: number;
  error: number;
  total: number;
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
  return {
    day,
    ok,
    error,
    total,
    message:
      total === 0
        ? "今日尚无权威库调用记录。"
        : `今日权威调用 ${total} 次（成功 ${ok} / 失败 ${error}）。不含查询正文。`,
  };
}
