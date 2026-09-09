import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { openJobEventStream } from "./lawmind-job-stream";
import { useSseSubscription } from "./useSseSubscription";
import { confirmDialog } from "./lawmind-confirm-dialog";

type ToolApprovalRow = {
  actionId: string;
  title: string;
  summary: string;
};

type JobRow = {
  jobId: string;
  status: string;
  matterId?: string;
  templateId?: string;
  updatedAt?: string;
};

type DelegationRow = {
  delegationId: string;
  status: string;
  toAssistant: string;
  task?: string;
  updatedAt?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  apiBase: string;
  matterId?: string | null;
  tab?: "jobs" | "approvals" | "delegations";
};

export function LawmindTaskDrawer({
  open,
  onClose,
  apiBase,
  matterId,
  tab: initialTab = "jobs",
}: Props): ReactNode {
  const [tab, setTab] = useState<"jobs" | "approvals" | "delegations">(initialTab);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [approvals, setApprovals] = useState<ToolApprovalRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [delegations, setDelegations] = useState<DelegationRow[]>([]);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);
  const [cancelHint, setCancelHint] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState<boolean | null>(null);
  const jobEventSourcesRef = useRef<Map<string, () => void>>(new Map());

  const cancelDelegation = async (id: string) => {
    setCancelBusyId(id);
    setCancelHint(null);
    try {
      await apiSendJson(apiBase, `/api/delegations/${encodeURIComponent(id)}`, "DELETE");
      setCancelHint("已撤销委派。");
      await refresh();
    } catch (e) {
      setCancelHint(errorMessage(e, "撤销失败"));
    } finally {
      setCancelBusyId(null);
    }
  };

  const refresh = async (): Promise<void> => {
    const q = matterId ? `?matterId=${encodeURIComponent(matterId)}&limit=30` : "?limit=30";
    setRefreshing(true);
    try {
      const [j, s, d] = await Promise.all([
        apiGetJson<{ ok: boolean; jobs?: JobRow[] }>(apiBase, `/api/jobs${q}`),
        apiGetJson<{ ok: boolean; toolApprovals?: ToolApprovalRow[] }>(
          apiBase,
          `/api/action-summary${matterId ? `?matterId=${encodeURIComponent(matterId)}` : ""}`,
        ),
        apiGetJson<{ ok: boolean; delegations?: DelegationRow[] }>(
          apiBase,
          `/api/delegations?status=active&limit=20`,
        ),
      ]);
      setJobs(j.jobs ?? []);
      setApprovals(s.toolApprovals ?? []);
      setDelegations(d.delegations ?? []);
    } finally {
      setRefreshing(false);
    }
  };

  const { connected: sseConnectedFromHook } = useSseSubscription(
    apiBase,
    ["task:*", "review:*", "fs:change", "approval:update", "delegation:update"],
    () => {
      void refresh();
    },
    {
      enabled: open,
      onOpen: () => setSseConnected(true),
      onError: () => setSseConnected(false),
      onClose: () => setSseConnected(false),
    },
  );

  useEffect(() => {
    if (sseConnected === null) {
      setSseConnected(sseConnectedFromHook);
    }
  }, [sseConnected, sseConnectedFromHook]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setTab(initialTab);
    void refresh();
  }, [open, apiBase, matterId, initialTab]);

  useEffect(() => {
    if (!open || sseConnected === true) {
      return;
    }
    // SSE 未连接或断开时按原间隔降级轮询。
    const t = window.setInterval(() => void refresh(), 8_000);
    return () => window.clearInterval(t);
  }, [open, sseConnected]);

  useEffect(() => {
    if (!open || tab !== "jobs" || !apiBase) {
      for (const es of jobEventSourcesRef.current.values()) {
        es();
      }
      jobEventSourcesRef.current.clear();
      return;
    }
    const running = jobs
      .filter((j) => j.status === "queued" || j.status === "running")
      .slice(0, 3)
      .map((j) => j.jobId);
    const wanted = new Set(running);
    for (const [jid, es] of jobEventSourcesRef.current.entries()) {
      if (!wanted.has(jid)) {
        es();
        jobEventSourcesRef.current.delete(jid);
      }
    }
    for (const jobId of running) {
      if (jobEventSourcesRef.current.has(jobId)) {
        continue;
      }
      const close = openJobEventStream({
        apiBase,
        jobId,
        onMessage: (data) => {
          const job = data.job as JobRow | undefined;
          if (!job?.jobId) {
            return;
          }
          setJobs((prev) =>
            prev.map((row) =>
              row.jobId === job.jobId
                ? {
                    ...row,
                    status: job.status ?? row.status,
                    updatedAt: job.updatedAt ?? row.updatedAt,
                  }
                : row,
            ),
          );
          if (
            job.status === "completed" ||
            job.status === "failed" ||
            job.status === "cancelled"
          ) {
            jobEventSourcesRef.current.get(jobId)?.();
            jobEventSourcesRef.current.delete(jobId);
            void refresh();
          }
        },
        onError: () => {
          jobEventSourcesRef.current.get(jobId)?.();
          jobEventSourcesRef.current.delete(jobId);
        },
      });
      jobEventSourcesRef.current.set(jobId, close);
    }
    return () => {
      for (const es of jobEventSourcesRef.current.values()) {
        es();
      }
      jobEventSourcesRef.current.clear();
    };
  }, [
    open,
    tab,
    apiBase,
    jobs
      .filter((j) => j.status === "queued" || j.status === "running")
      .map((j) => j.jobId)
      .join(","),
  ]);

  if (!open) {
    return null;
  }

  return (
    <div className="lm-task-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="lm-task-drawer"
        role="dialog"
        aria-label="任务与确认"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="lm-task-drawer-head">
          <h3>任务抽屉</h3>
          <button type="button" className="lm-btn lm-btn-ghost lm-btn-small" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="lm-task-drawer-tabs" role="tablist" aria-label="任务抽屉分类">
          <button
            type="button"
            role="tab"
            id="lm-task-tab-jobs"
            aria-selected={tab === "jobs"}
            aria-controls="lm-task-panel-jobs"
            className={tab === "jobs" ? "lm-tab lm-tab-active" : "lm-tab"}
            onClick={() => setTab("jobs")}
          >
            后台任务
          </button>
          <button
            type="button"
            role="tab"
            id="lm-task-tab-approvals"
            aria-selected={tab === "approvals"}
            aria-controls="lm-task-panel-approvals"
            className={tab === "approvals" ? "lm-tab lm-tab-active" : "lm-tab"}
            onClick={() => setTab("approvals")}
          >
            工具确认 ({approvals.length})
          </button>
          <button
            type="button"
            role="tab"
            id="lm-task-tab-delegations"
            aria-selected={tab === "delegations"}
            aria-controls="lm-task-panel-delegations"
            className={tab === "delegations" ? "lm-tab lm-tab-active" : "lm-tab"}
            onClick={() => setTab("delegations")}
          >
            委派 ({delegations.length})
          </button>
        </div>
        {tab === "jobs" ? (
          <ul className="lm-task-drawer-list" role="tabpanel" id="lm-task-panel-jobs" aria-labelledby="lm-task-tab-jobs" aria-busy={refreshing || undefined}>
            {jobs.length === 0 ? (
              <li className="lm-meta">暂无任务</li>
            ) : (
              jobs.map((j) => (
                <li key={j.jobId}>
                  <span className="lm-task-drawer-status">{j.status}</span>
                  <span>{j.templateId ?? j.jobId}</span>
                </li>
              ))
            )}
          </ul>
        ) : null}
        {tab === "approvals" ? (
          <ul className="lm-task-drawer-list" role="tabpanel" id="lm-task-panel-approvals" aria-labelledby="lm-task-tab-approvals" aria-busy={refreshing || undefined}>
            {approvals.length === 0 ? (
              <li className="lm-meta">暂无待确认工具</li>
            ) : (
              approvals.map((a) => (
                <li key={a.actionId}>
                  <strong>{a.title}</strong>
                  <p className="lm-meta">{a.summary}</p>
                </li>
              ))
            )}
          </ul>
        ) : null}
        {tab === "delegations" ? (
          <ul className="lm-task-drawer-list" role="tabpanel" id="lm-task-panel-delegations" aria-labelledby="lm-task-tab-delegations" aria-busy={refreshing || undefined}>
            {delegations.length === 0 ? (
              <li className="lm-meta">暂无进行中的委派</li>
            ) : (
              delegations.map((d) => (
                <li key={d.delegationId}>
                  <span className="lm-task-drawer-status">{d.status}</span>
                  <span>
                    → {d.toAssistant}
                    {d.task ? ` · ${d.task.slice(0, 48)}` : ""}
                  </span>
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    disabled={cancelBusyId === d.delegationId}
                    onClick={() => {
                      void (async () => {
                        const ok = await confirmDialog({
                          title: "确定撤销该委派？",
                          confirmLabel: "撤销",
                        });
                        if (ok) {
                          await cancelDelegation(d.delegationId);
                        }
                      })();
                    }}
                  >
                    {cancelBusyId === d.delegationId ? "撤销中…" : "撤销"}
                  </button>
                </li>
              ))
            )}
            {cancelHint ? (
              <li className="lm-meta" role="status">
                {cancelHint}
              </li>
            ) : null}
          </ul>
        ) : null}
      </aside>
    </div>
  );
}
