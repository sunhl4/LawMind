import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { lawmindDocUrl } from "./lawmind-public-urls.js";

export type CollabSummaryState =
  | undefined
  | null
  | {
      collaborationEnabled: boolean;
      collaborationHint?: string;
      delegationCount: number;
    };

type WorkflowTemplateRow = {
  id: string;
  name: string;
  description: string;
  stepCount: number;
};

type WorkflowJobListItem = {
  jobId: string;
  status: string;
  workflowId: string;
  createdAt: string;
  error?: string;
  cancelRequested?: boolean;
  progress?: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    runningStepIds: string[];
    updatedAt?: string;
  };
};

/** 近期任务列表中，除「当前运行中」任务外，最多并发 SSE 路数（避免浏览器连接过多）。 */
const MAX_RECENT_JOB_SSE = 2;
/** 存在在途任务时低频次拉齐列表，作为 SSE 断线或未覆盖窗口的保险（类「最终一致」对齐）。 */
const RECENT_JOBS_RECONCILE_MS = 72_000;

function workflowJobStatusLabel(status: string): string {
  const map: Record<string, string> = {
    queued: "排队中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return map[status] ?? status;
}

function workflowJobStatusPillClass(status: string): string {
  switch (status) {
    case "completed":
      return "lm-pill lm-pill-success";
    case "running":
      return "lm-pill lm-pill-info";
    case "queued":
      return "lm-pill lm-pill-neutral";
    case "failed":
      return "lm-pill lm-pill-danger";
    case "cancelled":
      return "lm-pill lm-pill-warn";
    default:
      return "lm-pill lm-pill-neutral";
  }
}

type Props = {
  collabSummarySettings: CollabSummaryState;
  /** 用于加载 / 运行工作区团队工作流模板 */
  apiBase?: string;
  selectedAssistantId?: string;
};

/**
 * Settings panel block: collaboration toggle summary from GET /api/collaboration/summary.
 */
export function LawmindSettingsCollaboration(props: Props): ReactNode {
  const { collabSummarySettings, apiBase, selectedAssistantId = "" } = props;
  const [templates, setTemplates] = useState<WorkflowTemplateRow[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [matterId, setMatterId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [notificationHint, setNotificationHint] = useState<string | null>(null);
  const [cancelPendingMessage, setCancelPendingMessage] = useState<string | null>(null);
  const [activeProgress, setActiveProgress] = useState<{
    total: number;
    completed: number;
    running: string[];
  } | null>(null);
  const [recentJobs, setRecentJobs] = useState<WorkflowJobListItem[] | null>(null);
  const [recentJobsError, setRecentJobsError] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const workflowPollRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const recentJobEventSourcesRef = useRef(new Map<string, EventSource>());
  const notifiedTerminalJobsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!apiBase || !collabSummarySettings?.collaborationEnabled) {
      setTemplates(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const j = await apiGetJson<{ ok?: boolean; templates?: WorkflowTemplateRow[] }>(
          apiBase,
          "/api/collaboration/workflow-templates",
        );
        if (cancelled) {
          return;
        }
        if (j.ok && Array.isArray(j.templates)) {
          setTemplates(j.templates);
          setTemplatesError(null);
        } else {
          setTemplates([]);
          setTemplatesError("无法加载工作流模板列表");
        }
      } catch (e) {
        if (!cancelled) {
          setTemplates([]);
          setTemplatesError(errorMessage(e, "加载失败"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, collabSummarySettings?.collaborationEnabled]);

  useEffect(() => {
    return () => {
      if (workflowPollRef.current) {
        clearTimeout(workflowPollRef.current);
        workflowPollRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      for (const [, es] of recentJobEventSourcesRef.current) {
        es.close();
      }
      recentJobEventSourcesRef.current.clear();
    };
  }, []);

  const fetchRecentJobs = useCallback(async () => {
    if (!apiBase || !collabSummarySettings?.collaborationEnabled) {
      return;
    }
    try {
      const j = await apiGetJson<{ ok?: boolean; jobs?: WorkflowJobListItem[] }>(apiBase, "/api/jobs?limit=8");
      if (j.ok && Array.isArray(j.jobs)) {
        setRecentJobs(j.jobs);
        setRecentJobsError(null);
      } else {
        setRecentJobs([]);
        setRecentJobsError("无法加载近期任务");
      }
    } catch (e) {
      setRecentJobs(null);
      setRecentJobsError(errorMessage(e, "加载近期任务失败"));
    }
  }, [apiBase, collabSummarySettings?.collaborationEnabled]);

  useEffect(() => {
    void fetchRecentJobs();
  }, [fetchRecentJobs]);

  useEffect(() => {
    if (!runBusy && activeJobId === null) {
      void fetchRecentJobs();
    }
  }, [runBusy, activeJobId, fetchRecentJobs]);

  useEffect(() => {
    if (!apiBase || !collabSummarySettings?.collaborationEnabled) {
      return;
    }
    const needsReconcile =
      runBusy ||
      (recentJobs?.some((r) => r.status === "queued" || r.status === "running") ?? false);
    if (!needsReconcile) {
      return;
    }
    const t = window.setInterval(() => {
      void fetchRecentJobs();
    }, RECENT_JOBS_RECONCILE_MS);
    return () => clearInterval(t);
  }, [apiBase, collabSummarySettings?.collaborationEnabled, runBusy, recentJobs, fetchRecentJobs]);

  useEffect(() => {
    if (!apiBase || !collabSummarySettings?.collaborationEnabled) {
      for (const [, es] of recentJobEventSourcesRef.current) {
        es.close();
      }
      recentJobEventSourcesRef.current.clear();
      return;
    }
    if (typeof EventSource === "undefined") {
      return;
    }

    const base = apiBase.replace(/\/?$/u, "");
    const watchIds = (recentJobs ?? [])
      .filter(
        (r) =>
          (r.status === "queued" || r.status === "running") && r.jobId !== activeJobId,
      )
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_RECENT_JOB_SSE)
      .map((r) => r.jobId);

    const wanted = new Set(watchIds);

    for (const [jid, es] of recentJobEventSourcesRef.current.entries()) {
      if (!wanted.has(jid)) {
        es.close();
        recentJobEventSourcesRef.current.delete(jid);
      }
    }

    for (const streamJobId of watchIds) {
      if (recentJobEventSourcesRef.current.has(streamJobId)) {
        continue;
      }
      try {
        const es = new EventSource(
          `${base}/api/jobs/${encodeURIComponent(streamJobId)}/stream`,
        );
        recentJobEventSourcesRef.current.set(streamJobId, es);
        es.addEventListener("message", (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data) as { ok?: boolean; job?: WorkflowJobListItem };
            const job = data.job;
            if (!job) {
              return;
            }
            setRecentJobs((prev) => {
              if (!prev) {
                return prev;
              }
              return prev.map((row) =>
                row.jobId === streamJobId
                  ? {
                      ...row,
                      status: job.status,
                      error: job.error,
                      cancelRequested: job.cancelRequested,
                      progress: job.progress,
                    }
                  : row,
              );
            });
            if (
              job.status === "completed" ||
              job.status === "failed" ||
              job.status === "cancelled"
            ) {
              es.close();
              recentJobEventSourcesRef.current.delete(streamJobId);
              void fetchRecentJobs();
            }
          } catch {
            /* ignore */
          }
        });
        es.addEventListener("error", () => {
          es.close();
          recentJobEventSourcesRef.current.delete(streamJobId);
          void fetchRecentJobs();
        });
      } catch {
        /* ignore */
      }
    }
  }, [apiBase, collabSummarySettings?.collaborationEnabled, recentJobs, activeJobId, fetchRecentJobs]);

  const cancelBackgroundJob = useCallback(async () => {
    if (!apiBase || !activeJobId?.trim()) {
      return;
    }
    try {
      const res = await fetch(
        `${apiBase}/api/jobs/${encodeURIComponent(activeJobId.trim())}/cancel`,
        { method: "POST" },
      );
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setNotificationHint(typeof j.error === "string" ? j.error : `取消失败（HTTP ${res.status}）`);
        return;
      }
      setCancelPendingMessage("已发送取消请求：当前步骤结束后将停止（单次委派仍会跑完）。");
    } catch (e) {
      setNotificationHint(errorMessage(e, "取消失败"));
    }
  }, [apiBase, activeJobId]);

  const copyActiveJobId = useCallback(async () => {
    if (!activeJobId?.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(activeJobId.trim());
      setCopyHint("已复制任务 ID");
      window.setTimeout(() => setCopyHint(null), 2000);
    } catch {
      setNotificationHint("无法复制到剪贴板，请手动复制下方报告中的信息。");
    }
  }, [activeJobId]);

  const runWorkflow = useCallback(async () => {
    if (!apiBase || !selectedTemplateId.trim()) {
      return;
    }
    if (workflowPollRef.current) {
      clearTimeout(workflowPollRef.current);
      workflowPollRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setRunBusy(true);
    setRunResult(null);
    setNotificationHint(null);
    setCancelPendingMessage(null);
    setActiveProgress(null);
    setCopyHint(null);
    setActiveJobId(null);
    notifiedTerminalJobsRef.current.clear();
    let polling = false;
    try {
      const idempotencyKey = [
        selectedTemplateId.trim(),
        matterId.trim() || "-",
        selectedAssistantId.trim() || "-",
      ].join("|");
      const j = await apiSendJson<
        | { ok: true; jobId: string; async?: boolean }
        | { ok: true; status?: string; report?: string; workflowId?: string },
        Record<string, unknown>
      >(apiBase, "/api/collaboration/workflow-run", "POST", {
        templateId: selectedTemplateId.trim(),
        ...(matterId.trim() ? { matterId: matterId.trim() } : {}),
        ...(selectedAssistantId.trim() ? { assistantId: selectedAssistantId.trim() } : {}),
        async: true,
        idempotencyKey,
      });
      if (!j.ok) {
        setRunResult(JSON.stringify(j, null, 2));
        return;
      }
      if ("jobId" in j && typeof j.jobId === "string") {
        polling = true;
        setActiveJobId(j.jobId);
        setRunResult("后台运行中，完成后将尝试系统通知…");
        const jobId = j.jobId;
        let terminalHandled = false;

        const closeEventSource = () => {
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
        };

        async function finish(text: string, notifyBody: string) {
          if (terminalHandled) {
            return;
          }
          terminalHandled = true;
          closeEventSource();
          if (workflowPollRef.current) {
            clearTimeout(workflowPollRef.current);
            workflowPollRef.current = null;
          }
          setRunBusy(false);
          setActiveJobId(null);
          setActiveProgress(null);
          setCancelPendingMessage(null);
          setRunResult(text);
          const desk = window.lawmindDesktop;
          const alreadyNotified = notifiedTerminalJobsRef.current.has(jobId);
          if (!alreadyNotified) {
            notifiedTerminalJobsRef.current.add(jobId);
          }
          if (!alreadyNotified && desk?.showNotification) {
            const res = await desk.showNotification({
              title: "LawMind 团队工作流",
              body: notifyBody,
              openSettingsOnClick: true,
            });
            if (!res?.ok) {
              setNotificationHint(
                res?.error === "notifications_not_supported"
                  ? "系统通知不可用或未开启权限，请直接查看下方报告。"
                  : "未能弹出系统通知，请留意下方报告。",
              );
            } else {
              setNotificationHint(null);
            }
          } else if (!alreadyNotified && !desk?.showNotification) {
            setNotificationHint("当前环境无桌面通知桥接，请查看下方报告。");
          }
        }

        type JobSnap = {
          status: string;
          error?: string;
          cancelRequested?: boolean;
          progress?: {
            totalSteps: number;
            completedSteps: number;
            failedSteps: number;
            runningStepIds: string[];
          };
          result?: { report: string; status: string; workflowId?: string };
        };

        const applyJobUpdate = (job: JobSnap | undefined): boolean => {
          if (!job) {
            return true;
          }
          if (job.status === "queued" || job.status === "running") {
            setCancelPendingMessage(
              job.cancelRequested
                ? "已请求取消：当前步骤结束后将停止（单次委派仍会跑完）。"
                : null,
            );
            if (job.progress && job.progress.totalSteps > 0) {
              setActiveProgress({
                total: job.progress.totalSteps,
                completed: job.progress.completedSteps,
                running: job.progress.runningStepIds,
              });
            } else {
              setActiveProgress(null);
            }
            return true;
          }
          if (job.status === "cancelled") {
            const text = job.result?.report
              ? `状态：cancelled\n\n${job.result.report}`
              : `已取消：${job.error ?? "cancelled"}`;
            void finish(text, "后台工作流已取消。");
            return false;
          }
          if (job.status === "completed" && job.result?.report) {
            void finish(
              `状态：${job.result.status ?? "completed"}\n\n${job.result.report}`,
              "工作流已完成，可在下方查看报告。",
            );
            return false;
          }
          const err = job.error?.trim() || job.status;
          void finish(`失败：${err}`, `工作流失败：${err}`);
          return false;
        };

        const pollOnce = async (): Promise<boolean> => {
          try {
            const st = await apiGetJson<{ ok?: boolean; job?: JobSnap }>(apiBase, `/api/jobs/${jobId}`);
            const job = st.job;
            if (!job) {
              return true;
            }
            return applyJobUpdate(job);
          } catch (e) {
            if (workflowPollRef.current) {
              clearTimeout(workflowPollRef.current);
              workflowPollRef.current = null;
            }
            setRunBusy(false);
            setActiveJobId(null);
            setActiveProgress(null);
            setCancelPendingMessage(null);
            setRunResult(errorMessage(e, "查询任务状态失败"));
            return false;
          }
        };

        let pollOrdinal = 0;
        const clearPoll = () => {
          if (workflowPollRef.current) {
            clearTimeout(workflowPollRef.current);
            workflowPollRef.current = null;
          }
        };
        const schedulePoll = () => {
          clearPoll();
          const baseMs = pollOrdinal < 5 ? 850 : pollOrdinal < 18 ? 1650 : 3400;
          const jitterFactor = 0.85 + Math.random() * 0.3;
          const delayMs = Math.round(baseMs * jitterFactor);
          pollOrdinal += 1;
          workflowPollRef.current = window.setTimeout(() => {
            void (async () => {
              const cont = await pollOnce();
              if (cont) {
                schedulePoll();
              }
            })();
          }, delayMs);
        };

        const openJobStream = (): boolean => {
          if (typeof EventSource === "undefined") {
            return false;
          }
          try {
            const base = apiBase.replace(/\/?$/u, "");
            const es = new EventSource(`${base}/api/jobs/${encodeURIComponent(jobId)}/stream`);
            eventSourceRef.current = es;
            es.addEventListener("open", () => {
              clearPoll();
              setRunResult("后台运行中（实时进度流已连接）…");
            });
            es.addEventListener("message", (ev: MessageEvent) => {
              try {
                const data = JSON.parse(ev.data) as { ok?: boolean; job?: JobSnap };
                const cont = applyJobUpdate(data.job);
                if (!cont) {
                  closeEventSource();
                }
              } catch {
                /* ignore */
              }
            });
            es.addEventListener("error", () => {
              closeEventSource();
              if (terminalHandled) {
                return;
              }
              void (async () => {
                const cont = await pollOnce();
                if (cont && !terminalHandled) {
                  schedulePoll();
                }
              })();
            });
            return true;
          } catch {
            return false;
          }
        };

        if (!openJobStream()) {
          const cont = await pollOnce();
          if (cont) {
            schedulePoll();
          }
        }
      } else if ("report" in j && typeof j.report === "string") {
        setRunResult(`状态：${j.status ?? "?"}\n\n${j.report}`);
      } else {
        setRunResult(JSON.stringify(j, null, 2));
      }
    } catch (e) {
      setRunResult(errorMessage(e, "运行失败"));
    } finally {
      if (!polling) {
        setRunBusy(false);
        setActiveJobId(null);
        setActiveProgress(null);
      }
    }
  }, [apiBase, matterId, selectedAssistantId, selectedTemplateId]);

  const testSystemNotification = useCallback(() => {
    void window.lawmindDesktop?.showNotification?.({
      title: "LawMind",
      body: "这是一条测试通知。若未看到，请检查系统通知权限。",
      openSettingsOnClick: false,
    });
  }, []);

  const templatesLoading =
    collabSummarySettings?.collaborationEnabled === true &&
    Boolean(apiBase) &&
    templates === null &&
    !templatesError;

  const selectedTemplate = useMemo(() => {
    if (!templates?.length || !selectedTemplateId) {
      return undefined;
    }
    return templates.find((t) => t.id === selectedTemplateId);
  }, [templates, selectedTemplateId]);

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">协作与多智能体流程</div>
      <div className="lm-settings-group lm-settings-surface">
        {collabSummarySettings === undefined ? (
          <div className="lm-settings-loading" aria-busy="true" aria-label="加载协作状态">
            <div className="lm-shimmer lm-shimmer-line" />
            <div className="lm-shimmer lm-shimmer-line lm-shimmer-short" />
          </div>
        ) : collabSummarySettings === null ? (
          <div className="lm-callout lm-callout-warn" role="status">
            <div className="lm-callout-title">无法连接到本地服务</div>
            <p className="lm-callout-body">请确认 LawMind 桌面后端已启动，再打开设置重试。</p>
          </div>
        ) : (
          <>
            <div className="lm-settings-row">
              <span className="lm-settings-key">多智能体协作</span>
              <span
                className={
                  collabSummarySettings.collaborationEnabled
                    ? "lm-pill lm-pill-success"
                    : "lm-pill lm-pill-neutral"
                }
              >
                {collabSummarySettings.collaborationEnabled ? "已开启" : "已关闭"}
              </span>
            </div>
            <div className="lm-settings-row">
              <span className="lm-settings-key">当前委派数</span>
              <span className="lm-settings-val">{collabSummarySettings.delegationCount}</span>
            </div>
            {collabSummarySettings.collaborationHint ? (
              <div className="lm-callout lm-callout-muted" role="note">
                <p className="lm-callout-body">{collabSummarySettings.collaborationHint}</p>
              </div>
            ) : null}
            <p className="lm-settings-hint">
              在工作区放置流程模板{" "}
              <code className="lm-md-code">lawmind/workflows/*.json</code>
              ，按步骤把任务交给不同智能体执行，必要时可在流程里衔接、互检。在「设置 → 智能体」可为各助手配置虚拟组织角色与互审对象（主办/协办等）；智能体互审不能替代律师终审。初稿与终稿的对外效力仍以您为准：请务必在顶部「审核」通过后再渲染或发出。
            </p>
            {collabSummarySettings.collaborationEnabled && apiBase ? (
              <div
                id="lawmind-settings-collaboration"
                className="lm-settings-subblock lm-collab-workflow-run"
              >
                <div className="lm-settings-subtitle">团队工作流（后台）</div>
                <p className="lm-settings-hint lm-collab-lead">
                  选一模板即按序自动执行；各步可对应不同智能体。完成后可收到通知并在此看汇总。与聊天里当面交办是两条线，可并行使用。
                </p>
                {templatesError && (
                  <div className="lm-callout lm-callout-danger" role="alert">
                    <p className="lm-callout-body">{templatesError}</p>
                  </div>
                )}
                {templatesLoading ? (
                  <div className="lm-settings-loading" aria-busy="true" aria-label="加载模板列表">
                    <div className="lm-shimmer lm-shimmer-line" />
                    <div className="lm-shimmer lm-shimmer-line lm-shimmer-short" />
                  </div>
                ) : null}
                {templates && templates.length === 0 && !templatesError ? (
                  <div className="lm-collab-empty">
                    <div className="lm-collab-empty-title">暂无工作流模板</div>
                    <p className="lm-collab-empty-body">
                      在项目中新建目录并放入 JSON，例如：
                    </p>
                    <code className="lm-collab-empty-code">workspace/lawmind/workflows/my-flow.json</code>
                    <p className="lm-collab-empty-body lm-collab-empty-tip">
                      保存后回到此处，列表会自动加载。
                    </p>
                  </div>
                ) : null}
                {templates && templates.length > 0 ? (
                  <>
                    <label className="lm-field lm-field-tight">
                      <span>模板</span>
                      <select
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                      >
                        <option value="">请选择…</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}（{t.stepCount} 步）
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedTemplate?.description ? (
                      <p className="lm-settings-hint lm-collab-template-desc">{selectedTemplate.description}</p>
                    ) : null}
                    <label className="lm-field lm-field-tight">
                      <span>案件 ID（可选）</span>
                      <input
                        type="text"
                        value={matterId}
                        onChange={(e) => setMatterId(e.target.value)}
                        placeholder="与案件工作区一致，如 matter-1"
                      />
                    </label>
                    <div className="lm-settings-actions lm-collab-actions">
                      <button
                        type="button"
                        className={`lm-btn lm-btn-sm ${runBusy || !selectedTemplateId ? "lm-btn-secondary" : "lm-btn-accent"}`}
                        disabled={runBusy || !selectedTemplateId}
                        onClick={() => void runWorkflow()}
                      >
                        {runBusy ? "运行中…" : "运行所选模板"}
                      </button>
                      {runBusy && activeJobId ? (
                        <button
                          type="button"
                          className="lm-btn lm-btn-ghost lm-btn-sm"
                          onClick={() => void cancelBackgroundJob()}
                        >
                          取消后台任务
                        </button>
                      ) : null}
                      {window.lawmindDesktop?.showNotification ? (
                        <button
                          type="button"
                          className="lm-btn lm-btn-ghost lm-btn-sm"
                          onClick={() => testSystemNotification()}
                        >
                          测试系统通知
                        </button>
                      ) : null}
                    </div>
                    {runBusy && activeJobId ? (
                      <div className="lm-collab-job-status" role="status" aria-live="polite">
                        <div className="lm-collab-job-status-row">
                          {activeProgress && activeProgress.total > 0 ? (
                            <span className="lm-collab-job-status-text">
                              步骤 {activeProgress.completed}/{activeProgress.total}
                              {activeProgress.running.length > 0
                                ? ` · 执行中 ${activeProgress.running.join(", ")}`
                                : ""}
                            </span>
                          ) : (
                            <span className="lm-collab-job-status-text">
                              已启动 · <code className="lm-md-code">{activeJobId}</code>
                            </span>
                          )}
                          <button
                            type="button"
                            className="lm-btn lm-btn-ghost lm-btn-sm"
                            onClick={() => void copyActiveJobId()}
                          >
                            复制 ID
                          </button>
                        </div>
                        {activeProgress && activeProgress.total > 0 ? (
                          <div
                            className="lm-collab-progress-track"
                            role="progressbar"
                            aria-valuenow={activeProgress.completed}
                            aria-valuemin={0}
                            aria-valuemax={activeProgress.total}
                          >
                            <div
                              className="lm-collab-progress-fill"
                              style={{
                                width: `${Math.min(100, (100 * activeProgress.completed) / activeProgress.total)}%`,
                              }}
                            />
                          </div>
                        ) : null}
                        {copyHint ? <span className="lm-collab-copy-hint">{copyHint}</span> : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div className="lm-settings-subtitle">近期任务</div>
                <details className="lm-collab-details">
                  <summary>实时更新说明</summary>
                  <p className="lm-collab-details-body">
                    运行中条目会在列表内尽量用实时连接刷新进度；为保证可靠，也会定期与后台对账。
                    当前最多并行 {MAX_RECENT_JOB_SSE} 路（不含你正在跑的这条任务）。
                  </p>
                </details>
                {recentJobsError ? (
                  <div className="lm-callout lm-callout-danger" role="alert">
                    <p className="lm-callout-body">{recentJobsError}</p>
                  </div>
                ) : null}
                {recentJobs && recentJobs.length === 0 && !recentJobsError ? (
                  <p className="lm-settings-hint">暂无后台任务记录；运行一次工作流后将显示在此处。</p>
                ) : null}
                {recentJobs && recentJobs.length > 0 ? (
                  <ul className="lm-collab-recent-jobs">
                    {recentJobs.map((r) => (
                      <li key={r.jobId} className="lm-collab-recent-row">
                        <div className="lm-collab-recent-row-top">
                          <span className="lm-collab-recent-workflow" title={r.workflowId}>
                            {r.workflowId}
                          </span>
                          <span className={workflowJobStatusPillClass(r.status)}>
                            {workflowJobStatusLabel(r.status)}
                          </span>
                        </div>
                        <div className="lm-collab-recent-row-bottom">
                          <code className="lm-md-code lm-collab-recent-id" title={r.jobId}>
                            {r.jobId.slice(0, 8)}…
                          </code>
                          {r.cancelRequested &&
                          (r.status === "queued" || r.status === "running") ? (
                            <span className="lm-collab-recent-jobs-flag">已请求取消</span>
                          ) : null}
                          {r.progress &&
                          r.progress.totalSteps > 0 &&
                          (r.status === "queued" || r.status === "running") ? (
                            <span className="lm-collab-recent-progress">
                              {r.progress.completedSteps}/{r.progress.totalSteps} 步
                            </span>
                          ) : null}
                          <time className="lm-collab-recent-jobs-time" dateTime={r.createdAt}>
                            {new Date(r.createdAt).toLocaleString()}
                          </time>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {cancelPendingMessage ? (
                  <div className="lm-callout lm-callout-info" role="status">
                    <p className="lm-callout-body">{cancelPendingMessage}</p>
                  </div>
                ) : null}
                {notificationHint ? (
                  <div className="lm-callout lm-callout-danger" role="alert">
                    <p className="lm-callout-body">{notificationHint}</p>
                  </div>
                ) : null}
                {runResult ? (
                  <div className="lm-collab-report-wrap">
                    <div className="lm-collab-report-label">运行输出</div>
                    <pre className="lm-collab-workflow-report">{runResult}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="lm-settings-hint">
              集成与外部系统边界见{" "}
              <a href={lawmindDocUrl("LAWMIND-INTEGRATIONS")} target="_blank" rel="noreferrer noopener">
                官方说明
              </a>
              。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
