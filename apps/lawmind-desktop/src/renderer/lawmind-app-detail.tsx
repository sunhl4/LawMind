import type {
  ArtifactDraft,
  TaskExecutionPlanStep,
  TaskKind,
  TaskLifecycleStatus,
  TaskRecord,
} from "../../../../src/lawmind/types.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { TaskCheckpoint } from "../../../../src/lawmind/tasks/checkpoints.ts";
import { LawmindCitationBanner } from "./LawmindCitationBanner";
import { LawmindTaskCheckpoints } from "./LawmindTaskCheckpoints";
import { internalIdsTitle, pathBasename } from "./display-ids";
import { messageFromOkFalseBody, readJsonFromResponse, userMessageFromApiError } from "./api-client";

function taskKindCn(kind: TaskKind): string {
  const map: Record<TaskKind, string> = {
    "research.general": "通用检索整理",
    "research.legal": "法律专项检索",
    "research.hybrid": "通用与法律联合检索",
    "draft.word": "生成 Word 文书",
    "draft.ppt": "生成演示文稿",
    "summarize.case": "案件摘要",
    "analyze.contract": "合同审查",
    "agent.instruction": "对话交办",
    unknown: "待人工确认",
  };
  return map[kind];
}

function taskLifecycleCn(status: TaskLifecycleStatus): string {
  const map: Record<TaskLifecycleStatus, string> = {
    created: "已创建",
    confirmed: "已确认",
    researching: "检索中",
    researched: "检索完成",
    drafted: "已起草",
    reviewed: "已审阅",
    rejected: "已驳回",
    rendered: "已渲染",
    completed: "已结束",
  };
  return map[status];
}

function draftReviewCn(status: ArtifactDraft["reviewStatus"]): string {
  const map: Record<ArtifactDraft["reviewStatus"], string> = {
    pending: "待审核",
    approved: "已通过",
    rejected: "已驳回",
    modified: "已修改待再审",
  };
  return map[status];
}

export type DetailKind = "task" | "draft" | null;

export async function loadAppDetail(
  apiBase: string,
  kind: "task" | "draft",
  id: string,
): Promise<{
  task?: TaskRecord;
  draft?: ArtifactDraft;
  citationIntegrity?: DraftCitationIntegrityView;
  checkpoints?: TaskCheckpoint[];
  executionPlan?: TaskExecutionPlanStep[];
}> {
  const rel = kind === "task" ? `/api/tasks/${encodeURIComponent(id)}` : `/api/drafts/${encodeURIComponent(id)}`;
  const response = await fetch(`${apiBase}${rel}`);
  const json = await readJsonFromResponse<{
    ok?: boolean;
    error?: string;
    message?: string;
    task?: TaskRecord;
    draft?: ArtifactDraft;
    citationIntegrity?: DraftCitationIntegrityView;
    checkpoints?: TaskCheckpoint[];
    executionPlan?: TaskExecutionPlanStep[];
  }>(response);
  if (!response.ok) {
    throw new Error(userMessageFromApiError(response.status, json));
  }
  if (!json.ok) {
    throw new Error(messageFromOkFalseBody(json, "加载详情失败"));
  }
  return json;
}

type Props = {
  open: boolean;
  detailKind: DetailKind;
  detailId: string | null;
  detailLoading: boolean;
  detailError: string | null;
  detailTask: TaskRecord | null;
  detailDraft: ArtifactDraft | null;
  detailCitationIntegrity: DraftCitationIntegrityView | null;
  detailCheckpoints: TaskCheckpoint[] | null;
  detailExecutionPlan: TaskExecutionPlanStep[] | null;
  canUseFilesystemBridge: boolean;
  apiBase?: string;
  onClose: () => void;
  onPreviewArtifact: (outputPath?: string) => void;
  onOpenOutputInFolder: (outputPath?: string) => void;
  onUseTaskContext: (taskId: string, matterId: string | null) => void;
  formatLocaleDateTime: (iso: string) => string;
  artifactApiRelFromOutput: (outputPath?: string) => string | null;
};

export function LawmindDetailDialog(props: Props) {
  const {
    open,
    detailKind,
    detailId,
    detailLoading,
    detailError,
    detailTask,
    detailDraft,
    detailCitationIntegrity,
    detailCheckpoints,
    detailExecutionPlan,
    canUseFilesystemBridge,
    apiBase,
    onClose,
    onPreviewArtifact,
    onOpenOutputInFolder,
    onUseTaskContext,
    formatLocaleDateTime,
    artifactApiRelFromOutput,
  } = props;

  if (!open) {
    return null;
  }

  const outputPath = detailTask?.outputPath ?? detailDraft?.outputPath;
  const showPreview = Boolean(artifactApiRelFromOutput(outputPath));
  const showFolder = Boolean(outputPath && canUseFilesystemBridge);

  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="任务或草稿详情">
      <div className="lm-wizard lm-wizard--detail">
        <h2
          title={
            detailId
              ? internalIdsTitle([{ label: detailKind === "task" ? "任务记录" : "草稿", value: detailId }])
              : undefined
          }
        >
          {detailKind === "task" ? "任务详情" : "草稿详情"}
        </h2>
        {detailLoading && <div className="lm-meta">加载中…</div>}
        {detailError ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{detailError}</p>
          </div>
        ) : null}
        {!detailLoading && detailTask && (
          <div className="lm-detail-body">
            {detailTask.title && (
              <div className="lm-detail-kv">
                <span>任务名称</span>
                {detailTask.title}
              </div>
            )}
            <div className="lm-detail-kv">
              <span>{detailTask.kind === "agent.instruction" ? "用户指令" : "摘要说明"}</span>
              {detailTask.summary}
            </div>
            <div className="lm-detail-kv">
              <span>当前进度</span>
              {detailTask.kind === "agent.instruction" ? "对话回合" : taskLifecycleCn(detailTask.status)}
            </div>
            {detailTask.matterId ? (
              <div className="lm-detail-kv">
                <span>案件</span>
                <span title={`案件编号：${detailTask.matterId}`}>已关联案件工作台</span>
              </div>
            ) : null}
            <div className="lm-detail-kv">
              <span>任务类型</span>
              {taskKindCn(detailTask.kind)}
            </div>
            {detailTask.outputPath ? (
              <div className="lm-detail-kv">
                <span>交付产物</span>
                <span title={detailTask.outputPath}>{pathBasename(detailTask.outputPath)}</span>
              </div>
            ) : null}
            <div className="lm-detail-kv">
              <span>创建时间</span>
              {formatLocaleDateTime(detailTask.createdAt)}
            </div>
            <div className="lm-detail-kv">
              <span>更新时间</span>
              {formatLocaleDateTime(detailTask.updatedAt)}
            </div>
            {detailExecutionPlan && detailExecutionPlan.length > 0 && (
              <div className="lm-detail-kv lm-detail-kv--block">
                <span>执行步骤</span>
                <ul className="lm-detail-plan">
                  {detailExecutionPlan.map((s) => (
                    <li key={s.id}>
                      <span className={`lm-detail-plan-status lm-detail-plan-status--${s.status}`}>
                        {s.status === "done" ? "✓" : s.status === "skipped" ? "—" : "○"}
                      </span>{" "}
                      {s.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <LawmindTaskCheckpoints checkpoints={detailCheckpoints} />
            <details className="lm-detail-tech">
              <summary>技术信息（排查、对接用）</summary>
              <div className="lm-detail-kv">
                <span>内部编号</span>
                {detailTask.taskId}
              </div>
              {detailTask.matterId ? (
                <div className="lm-detail-kv">
                  <span>案件编号</span>
                  {detailTask.matterId}
                </div>
              ) : null}
              {detailTask.sessionId ? (
                <div className="lm-detail-kv">
                  <span>会话编号</span>
                  {detailTask.sessionId}
                </div>
              ) : null}
              {detailTask.assistantId ? (
                <div className="lm-detail-kv">
                  <span>助手配置 ID</span>
                  {detailTask.assistantId}
                </div>
              ) : null}
              <div className="lm-detail-kv">
                <span>引擎类型值</span>
                {detailTask.kind}
              </div>
              <div className="lm-detail-kv">
                <span>引擎状态值</span>
                {detailTask.status}
              </div>
              {detailTask.outputPath ? (
                <div className="lm-detail-kv">
                  <span>完整路径</span>
                  {detailTask.outputPath}
                </div>
              ) : null}
            </details>
          </div>
        )}
        {!detailLoading && detailDraft && (
          <div className="lm-detail-body">
            <LawmindCitationBanner
              view={detailCitationIntegrity}
              apiBase={apiBase}
              taskId={detailDraft.taskId}
            />
            <div className="lm-detail-kv">
              <span>标题</span>
              {detailDraft.title}
            </div>
            {detailDraft.matterId ? (
              <div className="lm-detail-kv">
                <span>案件</span>
                <span title={`案件编号：${detailDraft.matterId}`}>已关联案件工作台</span>
              </div>
            ) : null}
            <div className="lm-detail-kv">
              <span>审核阶段</span>
              {draftReviewCn(detailDraft.reviewStatus)}
            </div>
            {detailDraft.outputPath ? (
              <div className="lm-detail-kv">
                <span>交付产物</span>
                <span title={detailDraft.outputPath}>{pathBasename(detailDraft.outputPath)}</span>
              </div>
            ) : null}
            <div className="lm-detail-kv">
              <span>摘要</span>
              {detailDraft.summary}
            </div>
            <details className="lm-detail-tech">
              <summary>技术信息（排查、对接用）</summary>
              <div className="lm-detail-kv">
                <span>草稿 taskId</span>
                {detailDraft.taskId}
              </div>
              {detailDraft.matterId ? (
                <div className="lm-detail-kv">
                  <span>案件编号</span>
                  {detailDraft.matterId}
                </div>
              ) : null}
              <div className="lm-detail-kv">
                <span>模板 ID</span>
                {detailDraft.templateId}
              </div>
              <div className="lm-detail-kv">
                <span>输出格式</span>
                {detailDraft.output}
              </div>
              {detailDraft.deliverableType ? (
                <div className="lm-detail-kv">
                  <span>交付物类型</span>
                  {detailDraft.deliverableType}
                </div>
              ) : null}
              {detailDraft.outputPath ? (
                <div className="lm-detail-kv">
                  <span>完整路径</span>
                  {detailDraft.outputPath}
                </div>
              ) : null}
            </details>
          </div>
        )}
        <div className="lm-wizard-actions lm-wizard-actions--wrap">
          {showPreview && (
            <button type="button" className="lm-btn lm-btn-secondary" onClick={() => onPreviewArtifact(outputPath)}>
              预览交付物
            </button>
          )}
          {showFolder && (
            <button type="button" className="lm-btn lm-btn-secondary" onClick={() => onOpenOutputInFolder(outputPath)}>
              在文件夹中显示
            </button>
          )}
          {(detailTask || detailDraft) && (
            <button
              type="button"
              className="lm-btn"
              onClick={() =>
                onUseTaskContext(
                  detailTask?.taskId ?? detailDraft!.taskId,
                  detailTask?.matterId ?? detailDraft?.matterId ?? null,
                )
              }
            >
              用此任务上下文继续
            </button>
          )}
          <button type="button" className="lm-btn lm-btn-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
