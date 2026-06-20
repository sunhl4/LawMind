import { useMemo, useState, type ReactNode } from "react";
import { lawmindDocUrl } from "./lawmind-public-urls.js";
import { LawmindWorkflowLibrary } from "./LawmindWorkflowLibrary";
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
 * 顶栏「协作」主区：协作摘要、`GET /api/collaboration/summary` 状态、团队工作流模板与运行、近期 Job 等。
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
    fetchRecentJobs,
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

  const selectedTemplate = useMemo(() => {
    if (!templates?.length || !selectedTemplateId) {
      return undefined;
    }
    return templates.find((t) => t.id === selectedTemplateId);
  }, [templates, selectedTemplateId]);

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
        <div className="lm-settings-section-title">协作与多智能体流程</div>
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
              </>
            ) : null}
            {workflowsOnly && collabSummarySettings.collaborationEnabled && apiBase ? (
              <p className="lm-settings-hint lm-collab-workflows-lead">
                流程模板来自工作区{" "}
                <code className="lm-md-code">lawmind/workflows/*.json</code>
                。与本页顶部「多任务共用模型」所选推理入口一致：<strong>下方「运行所选模板」会向服务器传入当前模型 ID</strong>
                ，与主对话、委派打开的会话对齐；可按需与工作区内聊天交办并行。
              </p>
            ) : null}
            {collabSummarySettings.collaborationEnabled && apiBase ? (
              <div
                className="lm-settings-subblock lm-collab-workflow-run"
                id={workflowsOnly ? "lawmind-collaboration-hub" : undefined}
              >
                <div className="lm-settings-subtitle">工作流库</div>
                <LawmindWorkflowLibrary
                  apiBase={apiBase}
                  matterId={matterId.trim() || undefined}
                  onWorkflowStarted={() => void fetchRecentJobs()}
                  compact={workflowsOnly}
                />
                <div className="lm-settings-subtitle">团队工作流（后台）</div>
                <p className="lm-settings-hint lm-collab-lead">
                  选一模板即按序自动执行；各步可对应不同智能体；完成后可收到通知并在此查看汇总。
                </p>
                {workflowModelLabel ? (
                  <p className="lm-meta lm-collab-workflow-model-label">
                    当前工作流模型：<strong>{workflowModelLabel}</strong>
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
                    <div className="lm-collab-empty-title">暂无工作流模板</div>
                    <p className="lm-collab-empty-body">
                      在项目中新建目录并放入 JSON，例如：
                    </p>
                    <code className="lm-collab-empty-code">workspace/lawmind/workflows/my-flow.json</code>
                    <p className="lm-collab-empty-body lm-collab-empty-tip">
                      保存后回到本页（顶部「工作流」），列表会自动加载。
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
                        {r.executionState ? (
                          <div className="lm-collab-recent-row-bottom">
                            <span className="lm-meta">
                              状态：{r.executionState.phase} / {r.executionState.status}
                            </span>
                            {r.gateDecisions?.[0]?.reason ? (
                              <span className="lm-meta">{r.gateDecisions[0].reason}</span>
                            ) : null}
                          </div>
                        ) : null}
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
            ) : workflowsOnly ? (
              <div
                id="lawmind-collaboration-hub"
                className="lm-callout lm-callout-warn"
                role="status"
              >
                <p className="lm-callout-body">
                  {!collabSummarySettings.collaborationEnabled
                    ? "请先在「设置 → 智能体」中开启多助手协作，再回到本页运行团队工作流。"
                    : "请先完成本地 API 连接。"}
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
            ) : (
              <details className="lm-collab-desk-integrations">
                <summary>集成与外部系统边界</summary>
                <p className="lm-settings-hint lm-collab-desk-integrations-body">
                  详见{" "}
                  <a
                    href={lawmindDocUrl("LAWMIND-INTEGRATIONS")}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    官方说明
                  </a>
                  。
                </p>
              </details>
            )}
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
 * 设置弹窗内的协作摘要与入口（完整工作流 UI 在顶部「协作」页）。
 */
export function LawmindSettingsCollaborationBrief(props: BriefProps): ReactNode {
  const {
    collabSummarySettings,
    onOpenCollaborationPage,
    onReconnectLocalService,
    localServiceReconnecting = false,
  } = props;

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
          <LocalServiceDisconnectCallout
            onReconnect={onReconnectLocalService}
            busy={localServiceReconnecting}
          />
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
              本页仅显示协作开关与委派摘要。<strong>团队工作流、运行模板与近期后台任务</strong>
              在顶部导航「<strong>工作流</strong>」页；岗位与互审关系在「智能体」中配置。
            </p>
            <div className="lm-settings-actions">
              <button
                type="button"
                className="lm-btn lm-btn-accent lm-btn-sm"
                onClick={() => onOpenCollaborationPage()}
              >
                打开工作流
              </button>
            </div>
            <p className="lm-settings-hint">
              集成与外部系统边界见{" "}
              <a href={lawmindDocUrl("LAWMIND-INTEGRATIONS")} target="_blank" rel="noreferrer noopener">
                官方说明
              </a>
              ；界面与 API 对照见文档{" "}
              <a href={lawmindDocUrl("LAWMIND-COLLABORATION-UI-API-MAP")} target="_blank" rel="noreferrer noopener">
                LAWMIND-COLLABORATION-UI-API-MAP
              </a>
              。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
