import { useCallback, useEffect, useRef, useState } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "../../api-client.js";
import { apiPost } from "../../lawmind-api-routes.ts";
import { openJobEventStream } from "../../lawmind-job-stream.ts";
import type { WorkflowRunRequest } from "../../lawmind-api-request-types.ts";
import {
  MAX_RECENT_JOB_SSE,
  RECENT_JOBS_RECONCILE_MS,
  type WorkflowJobListItem,
} from "./lawmind-collab-types.js";

export type CollabActiveProgress = {
  total: number;
  completed: number;
  running: string[];
};

type UseLawmindCollabWorkflowJobsOpts = {
  apiBase?: string;
  collaborationEnabled?: boolean;
  matterId: string;
  selectedTemplateId: string;
  selectedAssistantId: string;
  workflowAgentModelId: string;
};

export function useLawmindCollabWorkflowJobs(opts: UseLawmindCollabWorkflowJobsOpts) {
  const {
    apiBase,
    collaborationEnabled,
    matterId,
    selectedTemplateId,
    selectedAssistantId,
    workflowAgentModelId,
  } = opts;

  const [runBusy, setRunBusy] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [notificationHint, setNotificationHint] = useState<string | null>(null);
  const [cancelPendingMessage, setCancelPendingMessage] = useState<string | null>(null);
  const [activeProgress, setActiveProgress] = useState<CollabActiveProgress | null>(null);
  const [recentJobs, setRecentJobs] = useState<WorkflowJobListItem[] | null>(null);
  const [recentJobsError, setRecentJobsError] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const workflowPollRef = useRef<number | null>(null);
  const eventSourceRef = useRef<(() => void) | null>(null);
  const recentJobEventSourcesRef = useRef(new Map<string, () => void>());
  const notifiedTerminalJobsRef = useRef(new Set<string>());

  useEffect(() => {
    return () => {
      if (workflowPollRef.current) {
        clearTimeout(workflowPollRef.current);
        workflowPollRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current();
        eventSourceRef.current = null;
      }
      for (const [, es] of recentJobEventSourcesRef.current) {
        es();
      }
      recentJobEventSourcesRef.current.clear();
    };
  }, []);

  const fetchRecentJobs = useCallback(async () => {
    if (!apiBase || !collaborationEnabled) {
      return;
    }
    try {
      const j = await apiGetJson<{ ok?: boolean; jobs?: WorkflowJobListItem[] }>(
        apiBase,
        "/api/jobs?limit=8",
      );
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
  }, [apiBase, collaborationEnabled]);

  useEffect(() => {
    void fetchRecentJobs();
  }, [fetchRecentJobs]);

  useEffect(() => {
    if (!runBusy && activeJobId === null) {
      void fetchRecentJobs();
    }
  }, [runBusy, activeJobId, fetchRecentJobs]);

  useEffect(() => {
    if (!apiBase || !collaborationEnabled) {
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
  }, [apiBase, collaborationEnabled, runBusy, recentJobs, fetchRecentJobs]);

  useEffect(() => {
    if (!apiBase || !collaborationEnabled) {
      for (const [, es] of recentJobEventSourcesRef.current) {
        es();
      }
      recentJobEventSourcesRef.current.clear();
      return;
    }

    const watchIds = (recentJobs ?? [])
      .filter(
        (r) => (r.status === "queued" || r.status === "running") && r.jobId !== activeJobId,
      )
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_RECENT_JOB_SSE)
      .map((r) => r.jobId);

    const wanted = new Set(watchIds);

    for (const [jid, es] of recentJobEventSourcesRef.current.entries()) {
      if (!wanted.has(jid)) {
        es();
        recentJobEventSourcesRef.current.delete(jid);
      }
    }

    for (const streamJobId of watchIds) {
      if (recentJobEventSourcesRef.current.has(streamJobId)) {
        continue;
      }
      const close = openJobEventStream({
        apiBase,
        jobId: streamJobId,
        onMessage: (data) => {
          const job = data.job as WorkflowJobListItem | undefined;
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
                    executionState: job.executionState,
                    gateDecisions: job.gateDecisions,
                  }
                : row,
            );
          });
          if (
            job.status === "completed" ||
            job.status === "failed" ||
            job.status === "cancelled"
          ) {
            recentJobEventSourcesRef.current.get(streamJobId)?.();
            recentJobEventSourcesRef.current.delete(streamJobId);
            void fetchRecentJobs();
          }
        },
        onError: () => {
          recentJobEventSourcesRef.current.get(streamJobId)?.();
          recentJobEventSourcesRef.current.delete(streamJobId);
          void fetchRecentJobs();
        },
      });
      recentJobEventSourcesRef.current.set(streamJobId, close);
    }
  }, [apiBase, collaborationEnabled, recentJobs, activeJobId, fetchRecentJobs]);

  const cancelBackgroundJob = useCallback(async () => {
    if (!apiBase || !activeJobId?.trim()) {
      return;
    }
    try {
      await apiSendJson(
        apiBase,
        `/api/jobs/${encodeURIComponent(activeJobId.trim())}/cancel`,
        "POST",
      );
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
      eventSourceRef.current();
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
        workflowAgentModelId.trim() || "-",
      ].join("|");
      const runBody: WorkflowRunRequest = {
        templateId: selectedTemplateId.trim(),
        ...(matterId.trim() ? { matterId: matterId.trim() } : {}),
        ...(selectedAssistantId.trim() ? { assistantId: selectedAssistantId.trim() } : {}),
        ...(workflowAgentModelId.trim() ? { modelId: workflowAgentModelId.trim() } : {}),
        async: true,
        idempotencyKey,
      };
      const j = await apiPost(apiBase, "/api/collaboration/workflow-run", runBody);
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
            eventSourceRef.current();
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
            const st = await apiGetJson<{ ok?: boolean; job?: JobSnap }>(
              apiBase,
              `/api/jobs/${jobId}`,
            );
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
          if (!apiBase) {
            return false;
          }
          try {
            const close = openJobEventStream({
              apiBase,
              jobId,
              onOpen: () => {
                clearPoll();
                setRunResult("后台运行中（实时进度流已连接）…");
              },
              onMessage: (data) => {
                const cont = applyJobUpdate(data.job as JobSnap | undefined);
                if (!cont) {
                  closeEventSource();
                }
              },
              onError: () => {
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
              },
            });
            eventSourceRef.current = close;
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
        const statusLabel = typeof j.status === "string" ? j.status : "?";
        setRunResult(`状态：${statusLabel}\n\n${j.report}`);
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
  }, [apiBase, matterId, selectedAssistantId, selectedTemplateId, workflowAgentModelId]);

  const testSystemNotification = useCallback(() => {
    void window.lawmindDesktop?.showNotification?.({
      title: "LawMind",
      body: "这是一条测试通知。若未看到，请检查系统通知权限。",
      openSettingsOnClick: false,
    });
  }, []);

  return {
    runBusy,
    runResult,
    activeJobId,
    notificationHint,
    cancelPendingMessage,
    activeProgress,
    recentJobs,
    recentJobsError,
    copyHint,
    fetchRecentJobs,
    cancelBackgroundJob,
    copyActiveJobId,
    runWorkflow,
    testSystemNotification,
  };
}
