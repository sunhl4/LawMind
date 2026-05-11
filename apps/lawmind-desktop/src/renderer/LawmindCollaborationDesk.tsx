import type { ReactNode } from "react";
import { countActiveDelegations, LawmindCollabPanel } from "./lawmind-records-collab-panels";
import type { CollabSummaryState } from "./LawmindSettingsCollaboration";
import { LawmindSettingsCollaboration } from "./LawmindSettingsCollaboration";
import type { CollabEvent, DelegationRow } from "./lawmind-app-data";

export type CollaborationDeskTab = "overview" | "workflows";

type Props = {
  config: { apiBase: string } | null;
  collabSummarySettings: CollabSummaryState;
  selectedAssistantId: string;
  delegations: DelegationRow[];
  collabEvents: CollabEvent[];
  collabTab: "delegations" | "timeline";
  onSelectCollabTab: (tab: "delegations" | "timeline") => void;
  formatRelativeTime: (iso: string) => string;
  onRefreshCollaboration: () => void | Promise<void>;
  /** 从委派列表打开目标助手会话 */
  onOpenDelegationTargetChat?: (delegation: DelegationRow) => void | Promise<void>;
  deskTab: CollaborationDeskTab;
  onDeskTabChange: (tab: CollaborationDeskTab) => void;
};

/**
 * 顶栏「协作」页：状态一览（委派 / 动态）与团队工作流分栏，匹配「先看现场、再操作」的习惯。
 */
export function LawmindCollaborationDesk(props: Props): ReactNode {
  const {
    config,
    collabSummarySettings,
    selectedAssistantId,
    delegations,
    collabEvents,
    collabTab,
    onSelectCollabTab,
    formatRelativeTime,
    onRefreshCollaboration,
    onOpenDelegationTargetChat,
    deskTab,
    onDeskTabChange,
  } = props;

  const activeDel = countActiveDelegations(delegations);

  return (
    <div className="lm-collab-desk">
      <header className="lm-collab-desk-header">
        <div className="lm-collab-desk-intro">
          <h1 className="lm-collab-desk-title">协作</h1>
          <p className="lm-collab-desk-lead">
            多助手委派与协作事件在此汇总；需要按模板排队执行时，请切到「团队工作流」。
          </p>
        </div>
        <nav className="lm-tabs lm-collab-desk-tabs" aria-label="协作分区">
          <button
            type="button"
            className={`lm-tab ${deskTab === "overview" ? "active" : ""}`}
            aria-current={deskTab === "overview" ? "true" : undefined}
            onClick={() => onDeskTabChange("overview")}
          >
            状态一览
            {activeDel > 0 ? (
              <span className="lm-tab-inline-count" title="进行中的委派">
                {activeDel}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className={`lm-tab ${deskTab === "workflows" ? "active" : ""}`}
            aria-current={deskTab === "workflows" ? "true" : undefined}
            onClick={() => onDeskTabChange("workflows")}
          >
            团队工作流
          </button>
        </nav>
      </header>

      {deskTab === "overview" ? (
        <div className="lm-collab-desk-overview">
          <LawmindCollaborationStatusStrip
            collabSummarySettings={collabSummarySettings}
            activeDelegations={activeDel}
            onRefresh={() => void onRefreshCollaboration()}
          />
          <section className="lm-collab-desk-panel-wrap" aria-label="委派任务与协作动态">
            <h2 className="lm-collab-desk-panel-heading">委派任务与协作动态</h2>
            <LawmindCollabPanel
              collabTab={collabTab}
              delegations={delegations}
              collabEvents={collabEvents}
              onSelectCollabTab={onSelectCollabTab}
              formatRelativeTime={formatRelativeTime}
              onOpenDelegationTargetChat={onOpenDelegationTargetChat}
              variant="desk"
            />
          </section>
        </div>
      ) : (
        <div className="lm-collab-desk-workflows">
          {config ? (
            <LawmindSettingsCollaboration
              collabSummarySettings={collabSummarySettings}
              apiBase={config.apiBase}
              selectedAssistantId={selectedAssistantId}
              deskLayout="workflowsColumn"
            />
          ) : (
            <div className="lm-callout lm-callout-warn lm-collab-desk-workflows-config" role="status">
              <p className="lm-callout-body">
                请先完成本地 API 与项目连接，再在「团队工作流」中加载模板与后台任务。
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LawmindCollaborationStatusStrip(props: {
  collabSummarySettings: CollabSummaryState;
  activeDelegations: number;
  onRefresh: () => void;
}): ReactNode {
  const { collabSummarySettings, activeDelegations, onRefresh } = props;

  if (collabSummarySettings === undefined) {
    return (
      <div className="lm-collab-status-strip" aria-busy="true" aria-label="加载协作状态">
        <div className="lm-shimmer lm-shimmer-line lm-collab-status-shimmer" />
      </div>
    );
  }

  if (collabSummarySettings === null) {
    return (
      <div className="lm-callout lm-callout-warn lm-collab-status-callout" role="status">
        <p className="lm-callout-body">无法连接本地服务，请确认后端已启动后点刷新。</p>
        <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onRefresh}>
          重试
        </button>
      </div>
    );
  }

  const { collaborationEnabled, delegationCount, collaborationHint } = collabSummarySettings;

  return (
    <div className="lm-collab-status-strip">
      <div className="lm-collab-status-strip-main">
        <span
          className={
            collaborationEnabled ? "lm-pill lm-pill-success" : "lm-pill lm-pill-neutral"
          }
        >
          {collaborationEnabled ? "多助手协作已开启" : "多助手协作已关闭"}
        </span>
        <span className="lm-collab-status-meta">服务端登记委派 {delegationCount} 条</span>
        {activeDelegations > 0 ? (
          <span className="lm-pill lm-pill-info" title="进行中的委派任务">
            进行中 {activeDelegations}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="lm-btn lm-btn-ghost lm-btn-sm"
        onClick={onRefresh}
        title="从本地 API 刷新委派列表与协作事件"
      >
        刷新状态
      </button>
      {collaborationHint ? (
        <p className="lm-collab-status-hint lm-settings-hint">{collaborationHint}</p>
      ) : null}
    </div>
  );
}
