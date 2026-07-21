import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson } from "../api-client";
import type { ActionSummaryPayload } from "../lawmind-requires-action";
import { apiListFleetPlaybooks } from "../lawmind-review-campaign-api";
import {
  readHomeMigrationBannerDismissed,
  writeHomeMigrationBannerDismissed,
  writePreferClassicChatHome,
} from "../lawmind-home-prefs";

type Props = {
  apiBase: string;
  onOpenNeedsDecision: () => void;
  onOpenWorkspace: () => void;
  onOpenAgents: () => void;
  onOpenReview?: () => void;
  onOpenIntake?: () => void;
  onOpenGrowthInbox?: () => void;
  onOpenAppearanceSettings?: () => void;
};

/**
 * Skills E11 — Solo cockpit home (epic-shell-after light layout).
 */
export function HomeView(props: Props): ReactNode {
  const {
    apiBase,
    onOpenNeedsDecision,
    onOpenWorkspace,
    onOpenAgents,
    onOpenReview,
    onOpenIntake,
    onOpenGrowthInbox,
    onOpenAppearanceSettings,
  } = props;
  const [summary, setSummary] = useState<ActionSummaryPayload | null>(null);
  const [playbookCount, setPlaybookCount] = useState(0);
  const [metricsTotal, setMetricsTotal] = useState(0);
  const [adoptionPending, setAdoptionPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showMigration, setShowMigration] = useState(
    () => !readHomeMigrationBannerDismissed(),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      apiGetJson<ActionSummaryPayload>(apiBase, "/api/action-summary").catch(() => null),
      apiListFleetPlaybooks(apiBase).catch(() => null),
      apiGetJson<{
        ok?: boolean;
        doctor?: { productMetricsSummary?: { total?: number } };
      }>(apiBase, "/api/health").catch(() => null),
      apiGetJson<{ ok?: boolean; items?: unknown[] }>(
        apiBase,
        "/api/memory/adoption?state=pending",
      ).catch(() => null),
    ]).then(([s, pb, health, adoption]) => {
      if (cancelled) {
        return;
      }
      setSummary(s);
      setPlaybookCount(pb?.playbooks?.length ?? 0);
      setMetricsTotal(health?.doctor?.productMetricsSummary?.total ?? 0);
      setAdoptionPending(Array.isArray(adoption?.items) ? adoption.items.length : 0);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const pendingApprovals = summary?.pendingApprovals ?? 0;
  const pendingReviews = summary?.pendingReviewDrafts?.length ?? 0;
  const chatActions = summary?.chatRequiresActionCount ?? 0;
  const decisions =
    summary?.requiresDecisionTotal ?? pendingApprovals + chatActions + (summary?.pendingToolApprovals ?? 0);
  const activeJobs = summary?.activeJobs ?? 0;
  const reviewDrafts = summary?.pendingReviewDrafts ?? [];
  const toolApprovals = summary?.toolApprovals ?? [];
  const chatRequires = summary?.chatRequiresActions ?? [];
  const automations = summary?.automationInbox ?? [];

  const decisionCards: Array<{ key: string; title: string; summary: string }> = [];
  for (const t of toolApprovals.slice(0, 4)) {
    const rawTitle = t.title?.trim() || "";
    decisionCards.push({
      key: `tool:${t.actionId}`,
      title: rawTitle && !/^[a-z]+(?:_[a-z0-9]+)+$/.test(rawTitle) ? rawTitle : "待批准事项",
      summary: t.summary || "有操作待您确认后继续办理",
    });
  }
  for (const c of chatRequires.slice(0, 4)) {
    const first = c.actions[0];
    decisionCards.push({
      key: `chat:${c.sessionId}`,
      title: c.title || "对话待拍板",
      summary: first?.summary || first?.title || `${c.actions.length} 项待处理`,
    });
  }
  if (decisionCards.length === 0 && decisions > 0) {
    decisionCards.push({
      key: "aggregate",
      title: "有事项待你拍板",
      summary: `澄清 / 工具批准 / 事项审批共 ${decisions} 项`,
    });
  }

  return (
    <div className="lm-home-view" data-testid="lm-home-view" aria-label="驾驶舱">
      <header className="lm-home-view-head">
        <div>
          <h2>驾驶舱</h2>
          <p className="lm-meta">全局掌控 · 智能协同 · 高效决策</p>
        </div>
        <div className="lm-home-head-actions">
          {onOpenIntake ? (
            <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onOpenIntake}>
              新建事项
            </button>
          ) : (
            <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onOpenWorkspace}>
              新建事项
            </button>
          )}
          <button type="button" className="lm-btn lm-btn-accent lm-btn-sm" onClick={onOpenWorkspace}>
            打开对话
          </button>
        </div>
      </header>

      {showMigration ? (
        <div className="lm-callout lm-callout-info" role="status" data-testid="lm-home-migration-banner">
          <p className="lm-callout-body">
            新装默认打开本驾驶舱。若更习惯「打开即对话」，可一键切回经典布局（设置 → 外观亦可随时改）。
          </p>
          <div className="lm-home-col-actions">
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              data-testid="lm-home-use-classic"
              onClick={() => {
                writePreferClassicChatHome(true);
                writeHomeMigrationBannerDismissed();
                setShowMigration(false);
                onOpenWorkspace();
              }}
            >
              使用经典对话首页
            </button>
            {onOpenAppearanceSettings ? (
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                onClick={onOpenAppearanceSettings}
              >
                打开外观设置
              </button>
            ) : null}
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              data-testid="lm-home-migration-dismiss"
              onClick={() => {
                writeHomeMigrationBannerDismissed();
                setShowMigration(false);
              }}
            >
              知道了
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="lm-meta" aria-busy="true">
          加载中…
        </p>
      ) : null}

      <div className="lm-home-columns">
        <section className="lm-home-col" aria-labelledby="lm-home-decisions">
          <button type="button" className="lm-home-hero" onClick={onOpenNeedsDecision}>
            <div>
              <h3 id="lm-home-decisions">要我拍板</h3>
              <p className="lm-meta">澄清 / 工具批准 / 事项审批</p>
            </div>
            <span className="lm-home-hero-value" data-testid="lm-home-decisions-count">
              {decisions}
            </span>
          </button>
          <ul className="lm-home-card-list">
            {decisionCards.length === 0 ? (
              <li className="lm-home-card lm-home-card--empty">
                <p className="lm-meta">暂无待拍板事项。</p>
              </li>
            ) : (
              decisionCards.slice(0, 5).map((card) => (
                <li key={card.key} className="lm-home-card">
                  <div className="lm-home-card-body">
                    <strong>{card.title}</strong>
                    <p className="lm-meta">{card.summary}</p>
                  </div>
                  <button type="button" className="lm-btn lm-btn-accent lm-btn-sm" onClick={onOpenNeedsDecision}>
                    批准
                  </button>
                </li>
              ))
            )}
          </ul>
          <button type="button" className="lm-home-col-foot" onClick={onOpenNeedsDecision}>
            查看全部拍板事项
          </button>
        </section>

        <section className="lm-home-col" aria-labelledby="lm-home-triage">
          <button
            type="button"
            className="lm-home-hero"
            onClick={onOpenReview && pendingReviews > 0 ? onOpenReview : onOpenIntake ?? onOpenWorkspace}
          >
            <div>
              <h3 id="lm-home-triage">今日期限</h3>
              <p className="lm-meta">待审文书与分诊交办</p>
            </div>
            <span className="lm-home-hero-value" data-testid="lm-home-pending-reviews">
              {pendingReviews}
            </span>
          </button>
          <ul className="lm-home-card-list">
            {reviewDrafts.length === 0 ? (
              <li className="lm-home-card lm-home-card--empty">
                <p className="lm-meta">暂无待审文书。新材料可先分诊再交办。</p>
              </li>
            ) : (
              reviewDrafts.slice(0, 5).map((d, idx) => (
                <li key={d.taskId} className="lm-home-card lm-home-card--timeline">
                  <span className="lm-home-time">
                    {d.createdAt
                      ? new Date(d.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : `${9 + idx}:00`}
                  </span>
                  <div className="lm-home-card-body">
                    <strong>{d.title || "待审文书"}</strong>
                    <p className="lm-meta">
                      {d.reviewStatus === "modified" ? "律师已改稿" : "待签批"}
                    </p>
                  </div>
                  {onOpenReview ? (
                    <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onOpenReview}>
                      文书台
                    </button>
                  ) : null}
                </li>
              ))
            )}
            {automations.slice(0, 2).map((a) => (
              <li key={a.id} className="lm-home-card">
                <div className="lm-home-card-body">
                  <strong>{a.title || "自动办件"}</strong>
                  <p className="lm-meta">{a.summary || a.status}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="lm-home-col-actions">
            {onOpenIntake ? (
              <button type="button" className="lm-btn lm-btn-sm" onClick={onOpenIntake}>
                去对话分诊
              </button>
            ) : (
              <button type="button" className="lm-btn lm-btn-sm" onClick={onOpenWorkspace}>
                去对话
              </button>
            )}
            {onOpenReview && pendingReviews > 0 ? (
              <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onOpenReview}>
                进文书台
              </button>
            ) : null}
          </div>
        </section>

        <section className="lm-home-col" aria-labelledby="lm-home-campaigns">
          <button type="button" className="lm-home-hero" onClick={onOpenAgents}>
            <div>
              <h3 id="lm-home-campaigns">进行中的专案组</h3>
              <p className="lm-meta">
                Fleet Playbook <strong data-testid="lm-home-playbook-count">{playbookCount}</strong> 套
              </p>
            </div>
            <span className="lm-home-hero-value">{activeJobs}</span>
          </button>
          <ul className="lm-home-card-list">
            <li className="lm-home-card">
              <div className="lm-home-card-body">
                <strong>审查专案组</strong>
                <p className="lm-meta">文书台可一键跑五角色，聚合 Safety Score</p>
                <div className="lm-home-progress" aria-hidden="true">
                  <span style={{ width: playbookCount > 0 ? "72%" : "18%" }} />
                </div>
              </div>
            </li>
            {activeJobs > 0 ? (
              <li className="lm-home-card">
                <div className="lm-home-card-body">
                  <strong>在办任务</strong>
                  <p className="lm-meta">{activeJobs} 个任务进行中</p>
                  <div className="lm-home-progress" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, 20 + activeJobs * 12)}%` }} />
                  </div>
                </div>
              </li>
            ) : (
              <li className="lm-home-card lm-home-card--empty">
                <p className="lm-meta">暂无进行中专案。可从文书台启动审查专案组。</p>
              </li>
            )}
          </ul>
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            onClick={onOpenAgents}
            data-testid="lm-home-open-agents"
          >
            打开在办
          </button>
        </section>
      </div>

      <section className="lm-home-quick" aria-label="快捷入口">
        <h3>快捷入口</h3>
        <div className="lm-home-quick-grid">
          {onOpenIntake ? (
            <button type="button" className="lm-home-quick-item" onClick={onOpenIntake}>
              <strong>交办分诊</strong>
              <span className="lm-meta">新材料先分诊再执行</span>
            </button>
          ) : null}
          {onOpenReview ? (
            <button type="button" className="lm-home-quick-item" onClick={onOpenReview}>
              <strong>文书台</strong>
              <span className="lm-meta">签批与专案组审查</span>
            </button>
          ) : null}
          <button type="button" className="lm-home-quick-item" onClick={onOpenAgents}>
            <strong>在办专案组</strong>
            <span className="lm-meta">查看进行中任务</span>
          </button>
          <button type="button" className="lm-home-quick-item" onClick={onOpenNeedsDecision}>
            <strong>待我拍板</strong>
            <span className="lm-meta">澄清与工具批准</span>
          </button>
          <button
            type="button"
            className="lm-home-quick-item"
            onClick={onOpenWorkspace}
            data-testid="lm-home-open-chat"
          >
            <strong>打开对话</strong>
            <span className="lm-meta">下达任务与续聊</span>
          </button>
        </div>
      </section>

      <section className="lm-home-growth" aria-labelledby="lm-home-growth" data-testid="lm-home-growth">
        <div>
          <h3 id="lm-home-growth">成长与指标</h3>
          <p className="lm-meta">
            产品事件 <strong data-testid="lm-home-metrics-total">{metricsTotal}</strong>
            {" · "}
            待采纳记忆 <strong data-testid="lm-home-adoption-pending">{adoptionPending}</strong>
          </p>
        </div>
        {onOpenGrowthInbox ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            onClick={onOpenGrowthInbox}
            data-testid="lm-home-open-growth"
          >
            打开成长收件箱
          </button>
        ) : null}
      </section>

      {decisions === 0 && pendingReviews === 0 ? (
        <p className="lm-home-empty lm-meta" data-testid="lm-home-empty">
          暂无待办。可在对话下达任务，或填表交办后走分诊确认。
        </p>
      ) : null}

      <button
        type="button"
        className="lm-home-chat-fab"
        onClick={onOpenWorkspace}
        aria-label="打开对话"
      >
        打开对话
      </button>
    </div>
  );
}
