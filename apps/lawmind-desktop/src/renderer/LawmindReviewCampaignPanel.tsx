import { useEffect, useState, type ReactNode } from "react";
import type { ReviewCampaign, ReviewCampaignRoleResult } from "./lawmind-review-campaign-api";
import {
  apiCreateReviewCampaign,
  apiGetCampaignReport,
  apiGetReviewCampaignByTask,
  apiRerunCampaignRole,
} from "./lawmind-review-campaign-api";

type Props = {
  apiBase: string;
  taskId: string;
  matterId?: string | null;
  campaign: ReviewCampaign | null;
  onCampaignChange: (c: ReviewCampaign | null) => void;
  busy?: boolean;
};

/**
 * Skills E2 — Sticky Safety Score + role tabs (Workbench meta column).
 */
export function LawmindReviewCampaignPanel(props: Props): ReactNode {
  const { apiBase, taskId, matterId, campaign, onCampaignChange } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMd, setReportMd] = useState<string | null>(null);
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null);
  const [preferFast, setPreferFast] = useState(() => {
    try {
      return localStorage.getItem("lm.campaignPreferFast") === "1";
    } catch {
      return false;
    }
  });

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
      const j = await apiCreateReviewCampaign(apiBase, {
        taskId,
        matterId,
        playbookId: "standard-contract-review",
        idempotencyKey: `campaign:${taskId}:standard-contract-review:${preferFast ? "fast" : "full"}`,
        runNow: true,
        preferFast,
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `review-campaign-${campaign.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
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

      {score ? (
        <div className="lm-review-campaign-scoreboard" aria-label="Contract Safety Score">
          <div
            className="lm-review-campaign-score"
            data-testid="lm-safety-score"
            data-score={score.score}
            title="Safety Score（越高越安全）"
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
              <span className="lm-review-campaign-score-label">Safety Score</span>
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
        <p className="lm-meta">一键跑五角色（Solo 串行启发式），聚合 Safety Score 与谈判优先级。</p>
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
      {error ? <p className="lm-error">{error}</p> : null}
      {campaign && campaign.roles.length > 0 ? (
        <>
          <div
            className="lm-review-campaign-tabs"
            role="tablist"
            aria-label="专案组角色"
            data-testid="lm-review-campaign-roles"
          >
            {campaign.roles.map((r) => (
              <button
                key={r.roleId}
                type="button"
                role="tab"
                aria-selected={r.roleId === activeRoleId}
                className={
                  r.roleId === activeRoleId
                    ? "lm-review-campaign-tab lm-review-campaign-tab--active"
                    : "lm-review-campaign-tab"
                }
                data-status={r.status}
                onClick={() => setActiveRoleId(r.roleId)}
              >
                {r.label}
                {typeof r.score === "number" ? (
                  <span className="lm-meta"> {r.score}</span>
                ) : null}
              </button>
            ))}
          </div>
          {activeRole ? (
            <div
              className="lm-review-campaign-role"
              role="tabpanel"
              data-status={activeRole.status}
              data-testid="lm-review-campaign-role-panel"
            >
              <div className="lm-review-campaign-role-head">
                <span>
                  {activeRole.label}
                  <span className="lm-meta"> · {activeRole.status}</span>
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
