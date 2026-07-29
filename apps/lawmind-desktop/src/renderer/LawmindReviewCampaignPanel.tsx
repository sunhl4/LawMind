import { useEffect, useState, type ReactNode } from "react";
import type { ReviewCampaign, ReviewCampaignRoleResult } from "./lawmind-review-campaign-api";
import {
  apiCancelReviewCampaign,
  apiCreateReviewCampaign,
  apiGetCampaignReport,
  apiGetReviewCampaignByTask,
  apiListFleetPlaybooks,
  apiRerunCampaignRole,
} from "./lawmind-review-campaign-api";
import { useEdition } from "./use-edition";

type Props = {
  apiBase: string;
  taskId: string;
  matterId?: string | null;
  campaign: ReviewCampaign | null;
  onCampaignChange: (c: ReviewCampaign | null) => void;
  busy?: boolean;
};

type PlaybookOption = { id: string; label: string; roleCount: number };

/**
 * Skills E2 — Sticky 风险分 + role tabs (Workbench meta column).
 */
export function LawmindReviewCampaignPanel(props: Props): ReactNode {
  const { apiBase, taskId, matterId, campaign, onCampaignChange } = props;
  const edition = useEdition(apiBase);
  const allowParallel =  edition.features.reviewCampaignParallel;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMd, setReportMd] = useState<string | null>(null);
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null);
  const [playbooks, setPlaybooks] = useState<PlaybookOption[]>([]);
  const [playbookId, setPlaybookId] = useState("standard-contract-review");
  const [preferFast, setPreferFast] = useState(() => {
    try {
      return localStorage.getItem("lm.campaignPreferFast") === "1";
    } catch {
      return false;
    }
  });
  const [preferParallel, setPreferParallel] = useState(() => {
    try {
      return localStorage.getItem("lm.campaignPreferParallel") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!apiBase) {
      return;
    }
    let cancelled = false;
    void apiListFleetPlaybooks(apiBase)
      .then((j) => {
        if (cancelled || !j.ok || !j.playbooks?.length) {
          return;
        }
        setPlaybooks(j.playbooks);
        setPlaybookId((prev) =>
          j.playbooks!.some((p) => p.id === prev) ? prev : j.playbooks![0].id,
        );
      })
      .catch(() => {
        /* keep default */
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (!apiBase || !taskId) {
      return;
    }
    let cancelled = false;
    void apiGetReviewCampaignByTask(apiBase, taskId, matterId)
      .then((j) => {
        if (!cancelled && j.ok && j.campaign) {
          onCampaignChange(j.campaign);
        }
      })
      .catch(() => {
        /* none yet */
      });
    return () => {
      cancelled = true;
    };
    // Load once per task; parent clears campaign on task switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [apiBase, taskId, matterId]);

  useEffect(() => {
    if (!campaign?.roles?.length) {
      setActiveRoleId(null);
      return;
    }
    if (!activeRoleId || !campaign.roles.some((r) => r.roleId === activeRoleId)) {
      setActiveRoleId(campaign.roles[0].roleId);
    }
  }, [campaign, activeRoleId]);

  const runCampaign = async () => {
    setBusy(true);
    setError(null);
    try {
      const pb = playbookId.trim() || "standard-contract-review";
      const j = await apiCreateReviewCampaign(apiBase, {
        taskId,
        matterId,
        playbookId: pb,
        idempotencyKey: `campaign:${taskId}:${pb}:${preferFast ? "fast" : "full"}:${preferParallel && allowParallel ? "par" : "ser"}`,
        runNow: true,
        preferFast,
        preferParallel: allowParallel && preferParallel,
      });
      if (!j.ok || !j.campaign) {
        throw new Error(j.error ?? "创建专案组失败");
      }
      onCampaignChange(j.campaign);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancelCampaign = async () => {
    if (!campaign) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const j = await apiCancelReviewCampaign(apiBase, campaign.id);
      if (!j.ok || !j.campaign) {
        throw new Error(j.error ?? "取消失败");
      }
      onCampaignChange(j.campaign);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rerun = async (roleId: string) => {
    if (!campaign) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const j = await apiRerunCampaignRole(apiBase, campaign.id, roleId);
      if (!j.ok || !j.campaign) {
        throw new Error(j.error ?? "重跑失败");
      }
      onCampaignChange(j.campaign);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadReport = async () => {
    if (!campaign) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const j = await apiGetCampaignReport(apiBase, campaign.id);
      if (!j.ok || !j.markdown) {
        throw new Error(j.error ?? "报告加载失败");
      }
      setReportMd(j.markdown);
      setReportOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    if (!reportMd || !campaign) {
      return;
    }
    const blob = new Blob([reportMd], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `review-campaign-${campaign.id}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyReport = async () => {
    if (!reportMd) {
      return;
    }
    try {
      await navigator.clipboard.writeText(reportMd);
    } catch {
      setError("复制失败");
    }
  };

  const score = campaign?.safetyScore;
  const activeRole: ReviewCampaignRoleResult | undefined = campaign?.roles.find(
    (r) => r.roleId === activeRoleId,
  );
  const canCancel =
    campaign != null &&
    (campaign.status === "draft" ||
      campaign.status === "queued" ||
      campaign.status === "running" ||
      campaign.roles.some((r) => r.status === "running" || r.status === "pending"));

  return (
    <section className="lm-review-campaign" aria-label="审查专案组" data-testid="lm-review-campaign">
      <header className="lm-review-campaign-head">
        <div>
          <span className="lm-assignment-kicker">文书台 · 专案组</span>
          <strong>审查专案组</strong>
        </div>
        <div className="lm-review-campaign-actions">
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            disabled={busy}
            onClick={() => void runCampaign()}
            data-testid="lm-review-campaign-run"
          >
            {campaign ? "重新跑专案组" : "用审查专案组"}
          </button>
          {canCancel ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              disabled={busy}
              onClick={() => void cancelCampaign()}
              data-testid="lm-review-campaign-cancel"
            >
              取消
            </button>
          ) : null}
          {campaign ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={busy}
              onClick={() => void loadReport()}
              data-testid="lm-review-campaign-report-btn"
            >
              报告
            </button>
          ) : null}
        </div>
      </header>

      <label className="lm-settings-row lm-review-campaign-playbook">
        <span className="lm-meta">审查模板</span>
        <select
          className="lm-input"
          value={playbookId}
          data-testid="lm-review-campaign-playbook"
          aria-label="审查模板"
          onChange={(e) => setPlaybookId(e.target.value)}
        >
          {(playbooks.length > 0
            ? playbooks
            : [{ id: "standard-contract-review", label: "标准合同审查", roleCount: 5 }]
          ).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.roleCount ? `（${p.roleCount} 角色）` : ""}
            </option>
          ))}
        </select>
      </label>

      {score ? (
        <div className="lm-review-campaign-scoreboard" aria-label="合同风险分">
          <div
            className="lm-review-campaign-score"
            data-testid="lm-safety-score"
            data-score={score.score}
            title="风险分（越高越安全）"
          >
            <div className="lm-safety-gauge" aria-hidden="true">
              <svg viewBox="0 0 72 72" width="72" height="72">
                <circle cx="36" cy="36" r="30" className="lm-safety-gauge-track" />
                <circle
                  cx="36"
                  cy="36"
                  r="30"
                  className="lm-safety-gauge-value"
                  style={{
                    strokeDasharray: `${(Math.max(0, Math.min(100, score.score)) / 100) * 188.4} 188.4`,
                  }}
                />
              </svg>
              <span className="lm-review-campaign-score-value">{score.score}</span>
            </div>
            <div>
              <span className="lm-review-campaign-score-label">风险分</span>
              <p className="lm-meta">/ 100 · 越高越安全</p>
            </div>
          </div>
          <div className="lm-review-campaign-counts">
            <span className="lm-sev-high">高 {score.high}</span>
            <span className="lm-sev-medium">中 {score.medium}</span>
            <span className="lm-sev-low">低 {score.low}</span>
            {campaign?.playbookLabel ? (
              <span className="lm-meta">{campaign.playbookLabel}</span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="lm-meta">选择审查模板后一键跑多角色，聚合风险分与谈判优先级。</p>
      )}

      <label className="lm-settings-row lm-settings-row-check lm-review-campaign-fast">
        <input
          type="checkbox"
          checked={preferFast}
          data-testid="lm-review-campaign-fast"
          onChange={(e) => {
            const on = e.target.checked;
            setPreferFast(on);
            try {
              localStorage.setItem("lm.campaignPreferFast", on ? "1" : "0");
            } catch {
              /* ignore */
            }
          }}
        />
        <span className="lm-meta">更快模式（跳过低权重角色，仍保留 ≥4 角色）</span>
      </label>
      {allowParallel ? (
        <label className="lm-settings-row lm-settings-row-check lm-review-campaign-parallel">
          <input
            type="checkbox"
            checked={preferParallel}
            data-testid="lm-review-campaign-parallel"
            onChange={(e) => {
              const on = e.target.checked;
              setPreferParallel(on);
              try {
                localStorage.setItem("lm.campaignPreferParallel", on ? "1" : "0");
              } catch {
                /* ignore */
              }
            }}
          />
          <span className="lm-meta">并行执行角色（律所版）</span>
        </label>
      ) : (
        <p className="lm-meta">当前版本串行执行角色（律所版可开并行）。</p>
      )}
      {error ? <p className="lm-error">{error}</p> : null}
      {campaign && campaign.roles.length > 0 ? (
        <>
          <div
            className="lm-review-campaign-tabs"
            role="tablist"
            aria-label="专案组角色"
            data-testid="lm-review-campaign-roles"
          >
            {campaign.roles.map((r) => {
              const tabId = `lm-review-campaign-tab-${r.roleId}`;
              return (
              <button
                key={r.roleId}
                type="button"
                role="tab"
                id={tabId}
                aria-selected={r.roleId === activeRoleId}
                aria-controls="lm-review-campaign-role-panel"
                tabIndex={r.roleId === activeRoleId ? 0 : -1}
                className={
                  r.roleId === activeRoleId
                    ? "lm-review-campaign-tab lm-review-campaign-tab--active"
                    : "lm-review-campaign-tab"
                }
                data-status={r.status}
                title={
                  r.boundAssistantName
                    ? `${r.label} · ${r.boundAssistantName}`
                    : `${r.label}（抽象角色，未绑定工作区助手）`
                }
                onClick={() => setActiveRoleId(r.roleId)}
              >
                {r.label}
                {r.boundAssistantName ? (
                  <span className="lm-meta lm-review-campaign-bound"> · {r.boundAssistantName}</span>
                ) : null}
                {typeof r.score === "number" ? (
                  <span className="lm-meta"> {r.score}</span>
                ) : null}
              </button>
              );
            })}
          </div>
          {activeRole ? (
            <div
              className="lm-review-campaign-role"
              role="tabpanel"
              id="lm-review-campaign-role-panel"
              aria-labelledby={`lm-review-campaign-tab-${activeRole.roleId}`}
              data-status={activeRole.status}
              data-testid="lm-review-campaign-role-panel"
              data-bound-assistant={activeRole.boundAssistantId ?? ""}
            >
              <div className="lm-review-campaign-role-head">
                <span>
                  {activeRole.label}
                  <span className="lm-meta"> · {activeRole.status}</span>
                  {activeRole.boundAssistantName ? (
                    <span className="lm-meta" data-testid="lm-review-campaign-bound-name">
                      {" "}
                      · 助手 {activeRole.boundAssistantName}
                    </span>
                  ) : (
                    <span className="lm-meta"> · 抽象角色</span>
                  )}
                </span>
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  disabled={busy}
                  onClick={() => void rerun(activeRole.roleId)}
                >
                  重跑
                </button>
              </div>
              {activeRole.summary ? <p className="lm-meta">{activeRole.summary}</p> : null}
              {activeRole.findings.slice(0, 5).map((f) => (
                <p key={f.title} className={`lm-review-campaign-finding lm-sev-${f.severity}`}>
                  [{f.severity}] {f.title}
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {score && score.negotiatePriority.length > 0 ? (
        <div className="lm-review-campaign-negotiate">
          <strong className="lm-meta">谈判优先级</strong>
          <ol>
            {score.negotiatePriority.slice(0, 5).map((n) => (
              <li key={`${n.priority}-${n.title}`}>
                [{n.severity}] {n.title}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {reportOpen && reportMd ? (
        <div className="lm-review-campaign-report-wrap">
          <div className="lm-review-campaign-actions">
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              data-testid="lm-review-campaign-download"
              onClick={downloadReport}
            >
              下载 Markdown
            </button>
            <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => void copyReport()}>
              复制
            </button>
          </div>
          <pre className="lm-review-campaign-report" data-testid="lm-review-campaign-report">
            {reportMd}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
