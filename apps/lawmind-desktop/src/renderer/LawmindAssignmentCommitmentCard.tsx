import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  RiskLevel,
  TaskExecutionPlanStep,
  TaskLifecycleStatus,
} from "../../../../src/lawmind/types.ts";
import {
  detectAppliedPreferenceIds,
  type ExecutablePreference,
} from "../../../../src/lawmind/memory/executable-preferences.ts";
import { apiGetJson, apiSendJson } from "./api-client";
import { resolveTaskStatusLabel } from "./lawmind-execution-status-label";
import { lawyerAudienceLabel, lawyerDeliverableTypeLabel } from "./lawmind-lawyer-labels";

type AssignmentSummary = {
  taskId: string;
  title?: string;
  instruction?: string;
  summary: string;
  status: TaskLifecycleStatus;
  statusLabel?: string;
  riskLevel: RiskLevel;
  requiresConfirmation?: boolean;
  matterId?: string;
  deliverableType?: string;
  audience?: string;
  acceptanceCriteria?: string[];
  executionPlan?: TaskExecutionPlanStep[];
  reviewStatus?: "pending" | "approved" | "rejected" | "modified";
};

type AppliedPreference = { text: string; capturedAt?: string; id?: string; source?: string };

type Props = {
  apiBase: string;
  taskId: string;
  onOpenReview?: (target?: { taskId?: string; matterId?: string }) => void;
  /** Latest assistant reply — used to surface「本轮已应用」核对. */
  assistantReply?: string;
};

function riskLabel(risk: RiskLevel): string {
  if (risk === "high") {
    return "高风险";
  }
  if (risk === "medium") {
    return "中风险";
  }
  return "常规";
}

export function LawmindAssignmentCommitmentCard(props: Props): ReactNode {
  const { apiBase, taskId, onOpenReview, assistantReply } = props;
  const [task, setTask] = useState<AssignmentSummary | null>(null);
  const [prefs, setPrefs] = useState<AppliedPreference[]>([]);
  const [clearBusyId, setClearBusyId] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  const reloadPrefs = useCallback(async () => {
    try {
      const payload = await apiGetJson<{ ok?: boolean; preferences?: AppliedPreference[] }>(
        apiBase,
        "/api/lawyer-profile/applied-preferences",
      );
      setPrefs(Array.isArray(payload.preferences) ? payload.preferences : []);
      setPrefsError(null);
    } catch {
      setPrefs([]);
    }
  }, [apiBase]);

  useEffect(() => {
    let cancelled = false;
    void apiGetJson<{ ok?: boolean; task?: AssignmentSummary }>(
      apiBase,
      `/api/tasks/${encodeURIComponent(taskId)}`,
    )
      .then((payload) => {
        if (!cancelled) {
          setTask(payload.ok && payload.task ? payload.task : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTask(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, taskId]);

  useEffect(() => {
    let cancelled = false;
    void reloadPrefs().then(() => {
      if (cancelled) {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reloadPrefs]);

  const appliedThisTurn = useMemo(() => {
    if (!assistantReply?.trim() || prefs.length === 0) {
      return [] as string[];
    }
    const executable = prefs
      .filter((p): p is AppliedPreference & { id: string } => Boolean(p.id?.trim()))
      .map(
        (p): ExecutablePreference => ({
          id: p.id,
          text: p.text,
          capturedAt: p.capturedAt,
          source: p.source === "profile" ? "profile" : "json",
        }),
      );
    return detectAppliedPreferenceIds(assistantReply, executable);
  }, [assistantReply, prefs]);

  const clearPref = useCallback(
    async (id: string) => {
      setClearBusyId(id);
      setPrefsError(null);
      try {
        await apiSendJson(apiBase, `/api/lawyer-profile/applied-preferences/${encodeURIComponent(id)}`, "DELETE");
        await reloadPrefs();
      } catch {
        setPrefsError("清除习惯失败");
      } finally {
        setClearBusyId(null);
      }
    },
    [apiBase, reloadPrefs],
  );

  if (!task) {
    return null;
  }

  const steps = task.executionPlan ?? [];
  const done = steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  const reviewable =
    task.reviewStatus === "pending" ||
    task.reviewStatus === "modified" ||
    task.status === "drafted";
  const deliverableLabel = lawyerDeliverableTypeLabel(task.deliverableType);
  const audienceLabel = lawyerAudienceLabel(task.audience);

  return (
    <section className="lm-assignment-commitment" aria-label="当前交办">
      <div className="lm-assignment-commitment-head">
        <div>
          <span className="lm-assignment-kicker">当前交办</span>
          <strong>{task.title?.trim() || task.summary}</strong>
        </div>
        <span className="lm-assignment-status">
          {task.statusLabel ??
            resolveTaskStatusLabel({
              status: task.status,
              reviewStatus: task.reviewStatus,
            })}
        </span>
      </div>
      <div className="lm-assignment-meta">
        {task.matterId ? <span>案件：{task.matterId}</span> : <span>暂未归案</span>}
        <span>风险：{riskLabel(task.riskLevel)}</span>
        {deliverableLabel ? <span>交付物：{deliverableLabel}</span> : null}
        {audienceLabel ? <span>面向：{audienceLabel}</span> : null}
      </div>
      {prefs.length > 0 ? (
        <div className="lm-assignment-prefs" aria-label="已按你的习惯">
          <span className="lm-assignment-kicker">已按你的习惯</span>
          <ul>
            {prefs.slice(0, 4).map((p) => {
              const id = p.id?.trim();
              const clearable = Boolean(id && !id.startsWith("profile_"));
              return (
                <li key={id || p.text}>
                  <span>{p.text}</span>
                  {clearable ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-ghost lm-btn-sm"
                      disabled={clearBusyId === id}
                      aria-label={`清除习惯：${p.text}`}
                      onClick={() => void clearPref(id!)}
                    >
                      {clearBusyId === id ? "…" : "清除"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {prefsError ? <p className="lm-meta lm-error">{prefsError}</p> : null}
        </div>
      ) : null}
      {appliedThisTurn.length > 0 ? (
        <p className="lm-assignment-applied-check" aria-label="本轮已核对">
          本轮已核对：
          {appliedThisTurn
            .map((id) => prefs.find((p) => p.id === id)?.text?.trim() || id)
            .join("；")}
        </p>
      ) : null}
      {task.instruction?.trim() ? (
        <p className="lm-assignment-instruction">{task.instruction}</p>
      ) : null}
      {steps.length > 0 ? (
        <div className="lm-assignment-plan" aria-label={`执行步骤 ${done}/${steps.length}`}>
          <span className="lm-meta">
            执行步骤 {done}/{steps.length}
          </span>
          <ol>
            {steps.map((step) => (
              <li key={step.id} data-status={step.status}>
                {step.label}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="lm-assignment-actions">
        {task.requiresConfirmation ? (
          <span className="lm-meta">高影响动作将先征得你的确认</span>
        ) : (
          <span className="lm-meta">完成标准：形成可核验、可审核的交付物</span>
        )}
        {reviewable && onOpenReview ? (
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            data-testid="lm-commitment-open-review"
            onClick={() => onOpenReview({ taskId, matterId: task.matterId })}
          >
            进入文书台
          </button>
        ) : null}
      </div>
    </section>
  );
}
