import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "./api-client";
import { useLawmindAutomationsNavContext } from "./app/LawmindShellContexts";

type Schedule =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "once"; runAt: string };

type Automation = {
  id: string;
  title: string;
  enabled: boolean;
  matterId: string;
  instruction?: string;
  schedule: Schedule;
  nextRunAt: string;
  lastRunAt?: string;
  lastResultSummary?: string;
};

type InboxItem = {
  id: string;
  automationId: string;
  status?: string;
};

export type AutomationsSidebarMatter = {
  matterId: string;
  title: string;
};

type Props = {
  apiBase: string;
  matterTitles?: AutomationsSidebarMatter[];
};

function scheduleLabel(s: Schedule): string {
  if (s.kind === "daily") {
    return `每天 ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  }
  if (s.kind === "weekly") {
    const days = ["日", "一", "二", "三", "四", "五", "六"];
    return `每周${days[s.weekday] ?? "?"} ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  }
  return `单次 ${s.runAt.slice(0, 16).replace("T", " ")}`;
}

export function LawmindAutomationsSidebarList(props: Props): ReactNode {
  const { apiBase, matterTitles = [] } = props;
  const { selectedAutomationId, setSelectedAutomationId, automationsListVersion } =
    useLawmindAutomationsNavContext();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [pendingByAutomation, setPendingByAutomation] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const matterTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of matterTitles) {
      const id = m.matterId.trim();
      if (!id) {
        continue;
      }
      map.set(id, m.title.trim() || id);
    }
    return map;
  }, [matterTitles]);

  const refresh = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    setLoading(true);
    try {
      const list = await apiGetJson<{ automations: Automation[]; inbox: InboxItem[] }>(
        apiBase,
        "/api/automations",
      );
      const items = list.automations ?? [];
      setAutomations(items);
      const pending: Record<string, number> = {};
      for (const item of list.inbox ?? []) {
        if (item.status && item.status !== "open") {
          continue;
        }
        pending[item.automationId] = (pending[item.automationId] ?? 0) + 1;
      }
      setPendingByAutomation(pending);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "无法加载交办任务"));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void refresh();
  }, [refresh, automationsListVersion]);

  return (
    <div
      className="lm-matter-sidebar-list lm-matter-sidebar-list--fill lm-automations-sidebar-list"
      role="navigation"
      aria-label="交办任务列表"
      data-testid="lm-automations-sidebar-list"
    >
      <div className="lm-matter-sidebar-list-head">
        <span className="lm-matter-sidebar-list-title">交办任务</span>
        <span className="lm-matter-sidebar-list-count">{automations.length}</span>
      </div>
      {error ? <p className="lm-meta lm-matter-sidebar-empty">{error}</p> : null}
      {!error && loading && automations.length === 0 ? (
        <p className="lm-meta lm-matter-sidebar-empty">加载中…</p>
      ) : null}
      {!error && !loading && automations.length === 0 ? (
        <p className="lm-meta lm-matter-sidebar-empty">还没有交办任务</p>
      ) : null}
      {automations.length > 0 ? (
        <ul className="lm-matter-sidebar-list-ul">
          {automations.map((a) => {
            const matterTitle = matterTitleById.get(a.matterId.trim()) ?? a.matterId;
            const pending = pendingByAutomation[a.id] ?? 0;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className={`lm-matter-sidebar-row${selectedAutomationId === a.id ? " active" : ""}`}
                  onClick={() => setSelectedAutomationId(a.id)}
                  data-testid={`lm-automations-sidebar-row-${a.id}`}
                  title={a.instruction?.trim() || a.title}
                >
                  <span className="lm-matter-sidebar-row-title">{a.title}</span>
                  <span className="lm-matter-sidebar-row-meta">
                    {a.enabled ? "已开启" : "已暂停"} · {scheduleLabel(a.schedule)}
                    {matterTitle ? ` · ${matterTitle}` : ""}
                    {pending > 0 ? ` · ${pending} 待拍板` : ""}
                    {a.lastRunAt
                      ? ` · 上次 ${a.lastRunAt.slice(0, 16).replace("T", " ")}`
                      : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
