import { useState, type ReactNode } from "react";
import { lawmindDocUrl } from "./lawmind-public-urls.js";
import {
  LocalServiceDisconnectCallout,
  workflowJobStatusLabel,
  workflowJobStatusPillClass,
} from "./settings/collaboration/lawmind-collab-job-ui.js";
import { MAX_RECENT_JOB_SSE, type CollabSummaryState } from "./settings/collaboration/lawmind-collab-types.js";
import { useLawmindCollabTemplates } from "./settings/collaboration/useLawmindCollabTemplates.js";
import { useLawmindCollabWorkflowJobs } from "./settings/collaboration/useLawmindCollabWorkflowJobs.js";

export type { CollabSummaryState } from "./settings/collaboration/lawmind-collab-types.js";

type Props = {
  collabSummarySettings: CollabSummaryState;
  /** 用于加载 / 运行工作区团队工作流模板 */
  apiBase?: string;
  selectedAssistantId?: string;
  /** 顶栏「协作 → 团队工作流」分栏：省略首页级摘要与长说明，锚点落在运行区。 */
  deskLayout?: "full" | "workflowsColumn";
  /**
   * 与协作页顶部模型横条对齐：提交 `POST /api/collaboration/workflow-run` 时的 `modelId`。
   * 未设置时沿用工作区默认模型解析。
   */
  workflowAgentModelId?: string;
  workflowModelLabel?: string;
  onReconnectLocalService?: () => void | Promise<void>;
  localServiceReconnecting?: boolean;
};

/**
 * 「在办 → 按流程办」嵌入区：流程选择、执行与近期结果。
 * 设置弹窗内请使用 {@link LawmindSettingsCollaborationBrief}。
 */
export function LawmindSettingsCollaboration(props: Props): ReactNode {
  const {
    collabSummarySettings,
    apiBase,
    selectedAssistantId = "",
    deskLayout = "full",
    workflowAgentModelId = "",
    workflowModelLabel,
    onReconnectLocalService,
    localServiceReconnecting = false,
  } = props;
  const workflowsOnly = deskLayout === "workflowsColumn";
  const [matterId, setMatterId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const collaborationEnabled = collabSummarySettings?.collaborationEnabled;
  const { templates, templatesError, templatesLoading } = useLawmindCollabTemplates(
    apiBase,
    collaborationEnabled,
  );
  const {
    runBusy,
    runResult,
    activeJobId,
    notificationHint,
    cancelPendingMessage,
    activeProgress,
    recentJobs,
    recentJobsError,
    copyHint,
    cancelBackgroundJob,
    copyActiveJobId,
    runWorkflow,
    testSystemNotification,
  } = useLawmindCollabWorkflowJobs({
    apiBase,
    collaborationEnabled,
    matterId,
    selectedTemplateId,
    selectedAssistantId,
    workflowAgentModelId,
  });

  return (
    <div
      className={
        workflowsOnly
          ? "lm-collab-workflows-column"
          : "lm-settings-section lm-collab-hub-in-page"
      }
      id={workflowsOnly ? undefined : "lawmind-collaboration-hub"}
    >
      {!workflowsOnly ? (
        <div className="lm-settings-section-title">协作与多助手流程</div>
      ) : null}
      <div className="lm-settings-group lm-settings-surface">
        {collabSummarySettings === undefined ? (
          <div
            className="lm-settings-loading"
            aria-busy="true"
            aria-label="加载协作状态"
            id={workflowsOnly ? "lawmind-collaboration-hub" : undefined}
          >
            <div className="lm-shimmer lm-shimmer-line" />
            <div className="lm-shimmer lm-shimmer-line lm-shimmer-short" />
          </div>
        ) : collabSummarySettings === null ? (
          <LocalServiceDisconnectCallout
            id={workflowsOnly ? "lawmind-collaboration-hub" : undefined}
            onReconnect={onReconnectLocalService}
            busy={localServiceReconnecting}
          />
        ) : (
          <>
            {!workflowsOnly ? (
              <>
                <div className="lm-settings-row">
                  <span className="lm-settings-key">多助手协作</span>
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
                  可按固定步骤把工作交给不同助手接力，必要时在流程里衔接、互检。助手互审不能替代律师终审；对外发出前请务必在「文书台」通过。
                </p>
                <details className="lm-settings-hint">
                  <summary>管理员：如何配置流程</summary>
                  <p>
                    在工作区放入流程模板文件（如{" "}
                    <code className="lm-md-code">lawmind/workflows/*.json</code>
                    ），保存后回到本页即可选用。也可在「设置 → 助手与岗位」配置各助手的岗位与互审对象。
                  </p>
                </details>
              </>
            ) : null}
            {collabSummarySettings.collaborationEnabled && apiBase ? (
              <div
                className="lm-settings-subblock lm-collab-workflow-run"
                id={workflowsOnly ? "lawmind-collaboration-hub" : undefined}
              >
                <div className="lm-settings-subtitle">
                  {workflowsOnly ? "开始执行" : "按流程执行"}
                </div>
                <p className="lm-settings-hint lm-collab-lead">
                  选好要办的事，点开始即可；完成后可在下方查看结果。
                </p>
                {workflowModelLabel && !workflowsOnly ? (
                  <p className="lm-meta lm-collab-workflow-model-label">
                    当前使用模型：<strong>{workflowModelLabel}</strong>
                  </p>
                ) : null}
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
                    <div className="lm-collab-empty-title">还没有可用的流程</div>
                    <p className="lm-collab-empty-body">
                      请管理员或同事配置办案流程后，再回到本页选择执行。
                    </p>
                    {!workflowsOnly ? (
                      <details className="lm-collab-empty-body lm-collab-empty-tip">
                        <summary>管理员配置说明</summary>
                        <p>在工作区放入流程模板文件，例如：</p>
                        <code className="lm-collab-empty-code">
                          workspace/lawmind/workflows/my-flow.json
                        </code>
                        <p>保存后回到本页，列表会自动加载。</p>
                      </details>
                    ) : null}
                  </div>
                ) : null}
                {templates && templates.length > 0 ? (
                  <>
                    <label className="lm-field lm-field-tight">
                      <span>要办的事</span>
                      <select
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                      >
                        <option value="">请选择…</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="lm-field lm-field-tight">
                      <span>关联案件（可选）</span>
                      <input
                        type="text"
                        value={matterId}
                        onChange={(e) => setMatterId(e.target.value)}
                        placeholder="填写案件名称或编号，便于材料归入该案"
                      />
                    </label>
                    <div className="lm-settings-actions lm-collab-actions">
                      <button
                        type="button"
                        className={`lm-btn lm-btn-sm ${runBusy || !selectedTemplateId ? "lm-btn-secondary" : "lm-btn-accent"}`}
                        disabled={runBusy || !selectedTemplateId}
                        onClick={() => void runWorkflow()}
                      >
                        {runBusy ? "执行中…" : "开始执行"}
                      </button>
                      {runBusy && activeJobId ? (
                        <button
                          type="button"
                          className="lm-btn lm-btn-ghost lm-btn-sm"
                          onClick={() => void cancelBackgroundJob()}
                        >
                          取消执行
                        </button>
                      ) : null}
                      {!workflowsOnly && window.lawmindDesktop?.showNotification ? (
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
                          {workflowsOnly ? (
                            <span className="lm-collab-job-status-text">正在办理，请稍候…</span>
                          ) : activeProgress && activeProgress.total > 0 ? (
                            <span className="lm-collab-job-status-text">
                              进度 {activeProgress.completed}/{activeProgress.total} 步
                              {activeProgress.running.length > 0
                                ? ` · 正在：${activeProgress.running.join("、")}`
                                : ""}
                            </span>
                          ) : (
                            <span className="lm-collab-job-status-text">已开始执行，请稍候…</span>
                          )}
                          {!workflowsOnly ? (
                            <button
                              type="button"
                              className="lm-btn lm-btn-ghost lm-btn-sm"
                              onClick={() => void copyActiveJobId()}
                            >
                              复制 ID
                            </button>
                          ) : null}
                        </div>
                        {!workflowsOnly && activeProgress && activeProgress.total > 0 ? (
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
                <div className="lm-settings-subtitle">
                  {workflowsOnly ? "最近执行" : "近期任务"}
                </div>
                {!workflowsOnly ? (
                  <details className="lm-collab-details">
                    <summary>实时更新说明</summary>
                    <p className="lm-collab-details-body">
                      运行中条目会在列表内尽量用实时连接刷新进度；为保证可靠，也会定期与后台对账。
                      当前最多并行 {MAX_RECENT_JOB_SSE} 路（不含你正在跑的这条任务）。
                    </p>
                  </details>
                ) : null}
                {recentJobsError ? (
                  <div className="lm-callout lm-callout-danger" role="alert">
                    <p className="lm-callout-body">{recentJobsError}</p>
                  </div>
                ) : null}
                {recentJobs && recentJobs.length === 0 && !recentJobsError ? (
                  <p className="lm-settings-hint">
                    {workflowsOnly
                      ? "还没有执行记录。开始执行一套流程后，进度会出现在这里。"
                      : "暂无后台任务记录；运行一次工作流后将显示在此处。"}
                  </p>
                ) : null}
                {recentJobs && recentJobs.length > 0 ? (
                  <ul className="lm-collab-recent-jobs">
                    {recentJobs.map((r) => {
                      const flowName =
                        templates?.find((t) => t.id === r.workflowId)?.name ?? r.workflowId;
                      return (
                      <li key={r.jobId} className="lm-collab-recent-row">
                        <div className="lm-collab-recent-row-top">
                          <span className="lm-collab-recent-workflow" title={flowName}>
                            {flowName}
                          </span>
                          <span className={workflowJobStatusPillClass(r.status)}>
                            {workflowJobStatusLabel(r.status)}
                          </span>
                        </div>
                        <div className="lm-collab-recent-row-bottom">
                          {r.cancelRequested &&
                          (r.status === "queued" || r.status === "running") ? (
                            <span className="lm-collab-recent-jobs-flag">正在取消…</span>
                          ) : null}
                          {!workflowsOnly &&
                          r.progress &&
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
                        {r.gateDecisions?.[0]?.reason ? (
                          <div className="lm-collab-recent-row-bottom">
                            <span className="lm-meta">{r.gateDecisions[0].reason}</span>
                          </div>
                        ) : null}
                      </li>
                      );
                    })}
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
                    <div className="lm-collab-report-label">
                      {workflowsOnly ? "执行摘要" : "运行输出"}
                    </div>
                    <pre className="lm-collab-workflow-report">{runResult}</pre>
                  </div>
                ) : null}
              </div>
            ) : workflowsOnly ? (
              <div
                id="lawmind-collaboration-hub"
                className="lm-callout lm-callout-warn"
                role="status"
              >
                <p className="lm-callout-body">
                  {!collabSummarySettings.collaborationEnabled
                    ? "请先在「设置 → 助手与岗位」中开启多助手协作，再回到本页执行团队流程。"
                    : "本地服务尚未就绪，请先完成连接后再执行流程。"}
                </p>
              </div>
            ) : null}
            {!workflowsOnly ? (
              <p className="lm-settings-hint">
                集成与外部系统边界见{" "}
                <a
                  href={lawmindDocUrl("LAWMIND-INTEGRATIONS")}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  官方说明
                </a>
                。
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

type BriefProps = {
  collabSummarySettings: CollabSummaryState;
  onOpenCollaborationPage: () => void;
  onReconnectLocalService?: () => void | Promise<void>;
  localServiceReconnecting?: boolean;
};

/**
 * 设置弹窗内的协作摘要与入口（完整 UI 在顶部「在办」）。
 */
export function LawmindSettingsCollaborationBrief(props: BriefProps): ReactNode {
  const {
    collabSummarySettings,
    onOpenCollaborationPage,
    onReconnectLocalService,
    localServiceReconnecting = false,
  } = props;

  return (
    <div className="lm-settings-section lm-settings-advanced-page">
      <p className="lm-settings-lead">签批与接力在「在办」处理。这里只看状态与入口。</p>
      <div className="lm-settings-group lm-settings-surface">
        {collabSummarySettings === undefined ? (
          <div className="lm-settings-loading" aria-busy="true" aria-label="加载协作状态">
            <div className="lm-shimmer lm-shimmer-line" />
            <div className="lm-shimmer lm-shimmer-line lm-shimmer-short" />
          </div>
        ) : collabSummarySettings === null ? (
          <LocalServiceDisconnectCallout
            onReconnect={onReconnectLocalService}
            busy={localServiceReconnecting}
          />
        ) : (
          <>
            <div className="lm-settings-row">
              <span className="lm-settings-key">多助手协作</span>
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
              <span className="lm-settings-key">进行中的委派</span>
              <span className="lm-settings-val">{collabSummarySettings.delegationCount}</span>
            </div>
            {collabSummarySettings.collaborationHint ? (
              <p className="lm-settings-caption">{collabSummarySettings.collaborationHint}</p>
            ) : null}
            <div className="lm-settings-actions">
              <button
                type="button"
                className="lm-btn lm-btn-accent lm-btn-sm"
                onClick={() => onOpenCollaborationPage()}
              >
                去「在办」处理
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
