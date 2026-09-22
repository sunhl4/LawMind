import type { MatterOverview } from "../../../../src/lawmind/types.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { HistoryItem, TaskRow } from "./lawmind-app-data";
import { loadMatterOverviewsPayload } from "./lawmind-app-data";
import type { TimeRangeFilter } from "./lawmind-time-range";

export const RECORDS_DESK_UNLINKED = "__lawmind_records_unlinked__";

export function rangeStartMs(range: TimeRangeFilter): number | null {
  if (range === "all") {
    return null;
  }
  const now = Date.now();
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === "7d") {
    return now - 7 * 86400000;
  }
  return now - 30 * 86400000;
}

export type MatterSidebarRow = {
  key: string;
  matterId: string | null;
  title: string;
  subline?: string;
  latestUpdatedAt?: string;
  openHint?: string;
};

function maxIso(a?: string, b?: string): string | undefined {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return (Date.parse(a) || 0) >= (Date.parse(b) || 0) ? a : b;
}

export function buildMatterSidebarRows(
  overviews: MatterOverview[],
  tasks: TaskRow[],
  history: HistoryItem[],
): MatterSidebarRow[] {
  const acc = new Map<string, MatterSidebarRow>();

  for (const o of overviews) {
    const title = o.displayName?.trim() || o.matterId;
    acc.set(o.matterId, {
      key: o.matterId,
      matterId: o.matterId,
      title: title.length <= 36 ? title : `${title.slice(0, 18)}…${title.slice(-10)}`,
      subline:
        o.displayName?.trim() && o.displayName.trim() !== o.matterId ? o.matterId : o.topIssue?.trim() || undefined,
      latestUpdatedAt: o.latestUpdatedAt,
      openHint: undefined,
    });
  }

  const touchMatter = (matterId: string | undefined, updatedAt: string) => {
    const raw = matterId?.trim();
    if (!raw) {
      const key = RECORDS_DESK_UNLINKED;
      const existing = acc.get(key);
      const nextUpdated = maxIso(existing?.latestUpdatedAt, updatedAt);
      acc.set(key, {
        key,
        matterId: null,
        title: "未关联案件",
        subline: "任务或交付未写入案件编号",
        latestUpdatedAt: nextUpdated,
      });
      return;
    }
    if (!acc.has(raw)) {
      acc.set(raw, {
        key: raw,
        matterId: raw,
        title: raw.length <= 22 ? raw : `${raw.slice(0, 10)}…${raw.slice(-6)}`,
        latestUpdatedAt: updatedAt,
      });
    } else {
      const row = acc.get(raw)!;
      row.latestUpdatedAt = maxIso(row.latestUpdatedAt, updatedAt);
    }
  };

  for (const t of tasks) {
    touchMatter(t.matterId, t.updatedAt);
  }
  for (const h of history) {
    touchMatter(h.matterId, h.updatedAt);
  }

  const rows = [...acc.values()];
  rows.sort((a, b) => {
    const ua = a.key === RECORDS_DESK_UNLINKED ? 1 : 0;
    const ub = b.key === RECORDS_DESK_UNLINKED ? 1 : 0;
    if (ua !== ub) {
      return ua - ub;
    }
    const ta = Date.parse(a.latestUpdatedAt ?? "") || 0;
    const tb = Date.parse(b.latestUpdatedAt ?? "") || 0;
    return tb - ta;
  });
  return rows;
}

export function useLawmindRecordsDeskMatters(options: {
  enabled: boolean;
  apiBase: string;
  matterRefreshVersion: number;
  tasks: TaskRow[];
  history: HistoryItem[];
}) {
  const { enabled, apiBase, matterRefreshVersion, tasks, history } = options;
  const [overviews, setOverviews] = useState<MatterOverview[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [matterQuery, setMatterQuery] = useState("");
  const [matterTimeRange, setMatterTimeRange] = useState<TimeRangeFilter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const loadOverviews = useCallback(async () => {
    if (!enabled || !apiBase) {
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      setOverviews(await loadMatterOverviewsPayload(apiBase, matterRefreshVersion));
    } catch {
      setListError("案件列表加载失败");
      setOverviews([]);
    } finally {
      setListLoading(false);
    }
  }, [enabled, apiBase, matterRefreshVersion]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void loadOverviews();
  }, [enabled, loadOverviews]);

  const baseRows = useMemo(() => buildMatterSidebarRows(overviews, tasks, history), [overviews, tasks, history]);

  const sidebarRows = useMemo(() => {
    const q = matterQuery.trim().toLowerCase();
    const start = rangeStartMs(matterTimeRange);
    return baseRows.filter((row) => {
      if (start !== null) {
        const t = Date.parse(row.latestUpdatedAt ?? "");
        if (!Number.isFinite(t) || t < start) {
          return false;
        }
      }
      if (!q) {
        return true;
      }
      const hay = [row.key, row.title, row.subline ?? "", row.matterId ?? ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [baseRows, matterQuery, matterTimeRange]);

  useEffect(() => {
    if (!enabled) {
      setSelectedKey(null);
      return;
    }
    if (sidebarRows.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !sidebarRows.some((r) => r.key === selectedKey)) {
      setSelectedKey(sidebarRows[0].key);
    }
  }, [enabled, sidebarRows, selectedKey]);

  return {
    /** 经时间范围 / 搜索过滤后的行（用于左栏可选列表） */
    sidebarRows,
    /** 未过滤的聚合行（展示名映射、加入案件列表应使用此项，避免筛选导致名称滞后） */
    sidebarRowsAll: baseRows,
    selectedKey,
    setSelectedKey,
    matterQuery,
    setMatterQuery,
    matterTimeRange,
    setMatterTimeRange,
    listLoading,
    listError,
  };
}
