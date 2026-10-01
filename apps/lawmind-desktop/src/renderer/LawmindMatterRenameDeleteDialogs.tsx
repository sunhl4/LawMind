import { useCallback, useEffect, useRef, useState } from "react";
import { apiGetJson, errorMessage, messageFromOkFalseBody } from "./api-client";
import { apiPost } from "./lawmind-api-routes.ts";

type MatterDeletePlanOptions = {
  deleteMaterials: boolean;
  deleteTasks: boolean;
  deleteSessions: boolean;
  deleteUnapprovedDrafts: boolean;
};

type MatterDeletePlan = {
  matterId: string;
  displayName: string;
  scenario: "empty_shell" | "active" | "closed" | "missing";
  volume: { caseDir: boolean; matterDir: boolean; userFileCount: number };
  tasks: number;
  sessions: { count: number; sampleTitles: string[] };
  drafts: { total: number; protectedCount: number; unprotectedCount: number };
  openDeadlines: number;
  openQueueItems: number;
  pendingApprovals: number;
  replicaCloud: boolean;
  suggested: MatterDeletePlanOptions;
  warnings: string[];
  alwaysKept: string[];
};

const SCENARIO_LABEL: Record<MatterDeletePlan["scenario"], string> = {
  empty_shell: "空壳卷",
  active: "在办",
  closed: "已结案",
  missing: "目录已不存在",
};

export type LawmindMatterDeleteDialogProps = {
  open: { matterId: string; label: string } | null;
  apiBase: string;
  onClose: () => void;
  onSuccess?: (matterId: string) => void;
  onListChanged?: () => void;
};

export function LawmindMatterDeleteDialog({
  open,
  apiBase,
  onClose,
  onSuccess,
  onListChanged,
}: LawmindMatterDeleteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [confirmMatterId, setConfirmMatterId] = useState("");
  const [plan, setPlan] = useState<MatterDeletePlan | null>(null);
  const [options, setOptions] = useState<MatterDeletePlanOptions>({
    deleteMaterials: false,
    deleteTasks: false,
    deleteSessions: false,
    deleteUnapprovedDrafts: false,
  });
  const deleteSubmitLockRef = useRef(false);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setDeleteErr(null);
    setBusy(false);
    setConfirmMatterId("");
    setPlan(null);
    deleteSubmitLockRef.current = false;

    const base = apiBase.trim();
    const mid = open.matterId.trim();
    if (!base || !mid) {
      return undefined;
    }
    let cancelled = false;
    setPlanBusy(true);
    void (async () => {
      try {
        const j = await apiGetJson<{ ok: boolean; plan?: MatterDeletePlan; error?: string }>(
          base,
          `/api/matters/delete-plan?matterId=${encodeURIComponent(mid)}`,
        );
        if (cancelled) {
          return;
        }
        if (!j.ok || !j.plan) {
          setDeleteErr(j.error ?? "无法加载删除盘点");
          return;
        }
        setPlan(j.plan);
        setOptions(j.plan.suggested);
      } catch (e) {
        if (!cancelled) {
          setDeleteErr(errorMessage(e, "无法加载删除盘点"));
        }
      } finally {
        if (!cancelled) {
          setPlanBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, apiBase]);

  const submit = useCallback(async () => {
    const base = apiBase.trim();
    const mid = open?.matterId?.trim();
    if (!base || !mid) {
      return;
    }
    if (deleteSubmitLockRef.current) {
      return;
    }
    deleteSubmitLockRef.current = true;
    setDeleteErr(null);
    setBusy(true);
    try {
      const j = await apiPost(base, "/api/matters/delete", {
        matterId: mid,
        deleteMaterials: options.deleteMaterials,
        deleteTasks: options.deleteTasks,
        deleteSessions: options.deleteSessions,
        deleteUnapprovedDrafts: options.deleteUnapprovedDrafts,
      });
      if (!j.ok) {
        setDeleteErr(messageFromOkFalseBody(j, "删除失败"));
        return;
      }
      onClose();
      onSuccess?.(mid);
      onListChanged?.();
    } catch (e) {
      setDeleteErr(errorMessage(e, "删除失败"));
    } finally {
      deleteSubmitLockRef.current = false;
      setBusy(false);
    }
  }, [apiBase, open?.matterId, onClose, onSuccess, onListChanged, options]);

  if (!open) {
    return null;
  }
  const confirmationRequiredId = open.matterId.trim();
  const confirmMatched = confirmMatterId.trim() === confirmationRequiredId;

  return (
    <div
      className="lm-wizard-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="删除案件"
      style={{ zIndex: 21_000 }}
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div className="lm-wizard lm-modal-matter-delete" onClick={(e) => e.stopPropagation()}>
        <h2>删除案件</h2>
        <p className="lm-meta">
          当前案件：<strong>{open.label}</strong>（<code className="lm-meta">{open.matterId}</code>）
        </p>
        {planBusy ? <p className="lm-meta">正在盘点本案在 LawMind 内的存量…</p> : null}
        {plan ? (
          <>
            <p className="lm-meta">
              场景：<strong>{SCENARIO_LABEL[plan.scenario]}</strong>。将移除案件列表与卷宗目录（
              <code className="lm-meta">{`cases/${open.matterId}`}</code>、
              <code className="lm-meta">{`matters/${open.matterId}`}</code>
              {plan.replicaCloud ? "、副本云同步包" : ""}）。程序与设置不动。
            </p>
            <ul className="lm-meta lm-delete-plan-inventory">
              {plan.volume.userFileCount > 0 ? (
                <li>{plan.volume.userFileCount} 个材料或卷宗文件</li>
              ) : null}
              {plan.tasks > 0 ? <li>{plan.tasks} 条历史任务</li> : null}
              {plan.sessions.count > 0 ? (
                <li>
                  {plan.sessions.count} 段绑定对话
                  {plan.sessions.sampleTitles.length > 0
                    ? `（如「${plan.sessions.sampleTitles[0]}」）`
                    : ""}
                </li>
              ) : null}
              {plan.drafts.unprotectedCount > 0 ? (
                <li>{plan.drafts.unprotectedCount} 份未交付草稿</li>
              ) : null}
              {plan.drafts.protectedCount > 0 ? (
                <li>{plan.drafts.protectedCount} 份已交付/已批准草稿（始终保留）</li>
              ) : null}
              {plan.openDeadlines > 0 ? <li>{plan.openDeadlines} 条未完成期限</li> : null}
              {plan.volume.userFileCount === 0 &&
              plan.tasks === 0 &&
              plan.sessions.count === 0 &&
              plan.drafts.total === 0 &&
              plan.openDeadlines === 0 ? (
                <li>未发现材料、任务、对话或未完成期限（空壳或近空壳）</li>
              ) : null}
            </ul>
            {plan.warnings.length > 0 ? (
              <div className="lm-callout lm-callout-warn" role="status">
                <ul className="lm-callout-body">
                  {plan.warnings.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <fieldset className="lm-delete-plan-options" disabled={busy || planBusy}>
              <legend className="lm-meta">请选择要一并删除的内容</legend>
              <label className="lm-firstrun-confirm-row">
                <input
                  type="checkbox"
                  checked={options.deleteMaterials}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, deleteMaterials: e.target.checked }))
                  }
                />
                <span>删除材料与卷宗文件（cases/ 下用户文件）</span>
              </label>
              <label className="lm-firstrun-confirm-row">
                <input
                  type="checkbox"
                  checked={options.deleteTasks}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, deleteTasks: e.target.checked }))
                  }
                />
                <span>删除历史任务记录</span>
              </label>
              <label className="lm-firstrun-confirm-row">
                <input
                  type="checkbox"
                  checked={options.deleteSessions}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, deleteSessions: e.target.checked }))
                  }
                />
                <span>删除绑定本案的对话（含转写）</span>
              </label>
              <label className="lm-firstrun-confirm-row">
                <input
                  type="checkbox"
                  checked={options.deleteUnapprovedDrafts}
                  onChange={(e) =>
                    setOptions((prev) => ({
                      ...prev,
                      deleteUnapprovedDrafts: e.target.checked,
                    }))
                  }
                />
                <span>删除未批准且未导出的草稿</span>
              </label>
            </fieldset>
            {plan.alwaysKept.length > 0 ? (
              <p className="lm-meta">
                始终保留：{plan.alwaysKept.join("、")}。未勾选的对话会解除案件关联但保留记录。
              </p>
            ) : null}
          </>
        ) : null}
        <label className="lm-field-match-confirm">
          <span>
            输入案件编号 <code className="lm-meta">{confirmationRequiredId}</code> 以确认删除
          </span>
          <input
            className="lm-input"
            value={confirmMatterId}
            onChange={(event) => setConfirmMatterId(event.target.value)}
            placeholder={confirmationRequiredId}
            disabled={busy || planBusy}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {deleteErr ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{deleteErr}</p>
          </div>
        ) : null}
        <div className="lm-wizard-actions">
          <button type="button" className="lm-btn lm-btn-secondary" disabled={busy} onClick={() => onClose()}>
            取消
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-destructive"
            disabled={busy || planBusy || !confirmMatched || !plan}
            onClick={() => void submit()}
          >
            {busy ? "删除中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
