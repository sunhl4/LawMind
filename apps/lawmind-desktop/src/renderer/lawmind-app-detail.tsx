import type { ArtifactDraft, TaskRecord } from "../../../../src/lawmind/types.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { TaskCheckpoint } from "../../../../src/lawmind/tasks/checkpoints.ts";
import { LawmindCitationBanner } from "./LawmindCitationBanner";
import { LawmindTaskCheckpoints } from "./LawmindTaskCheckpoints";

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
}> {
  const rel = kind === "task" ? `/api/tasks/${encodeURIComponent(id)}` : `/api/drafts/${encodeURIComponent(id)}`;
  const response = await fetch(`${apiBase}${rel}`);
  const json = (await response.json()) as {
    ok?: boolean;
    error?: string;
    task?: TaskRecord;
    draft?: ArtifactDraft;
    citationIntegrity?: DraftCitationIntegrityView;
    checkpoints?: TaskCheckpoint[];
  };
  if (!response.ok || !json.ok) {
    throw new Error(json.error || "加载详情失败");
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
  canUseFilesystemBridge: boolean;
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
    canUseFilesystemBridge,
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
      <div className="lm-wizard" style={{ maxWidth: 560 }}>
        <h2>
          {detailKind === "task" ? "任务详情" : "草稿详情"}
          {detailId ? (
            <span className="lm-meta" style={{ marginLeft: 8 }}>
              {" "}
              - {detailId}
            </span>
          ) : null}
        </h2>
        {detailLoading && <div className="lm-meta">加载中…</div>}
        {detailError && <div className="lm-error">{detailError}</div>}
        {!detailLoading && detailTask && (
          <div className="lm-detail-body">
            {detailTask.title && (
              <div className="lm-detail-kv">
                <span>任务名称</span>
                {detailTask.title}
              </div>
            )}
            <div className="lm-detail-kv">
              <span>{detailTask.kind === "agent.instruction" ? "用户指令" : "摘要"}</span>
              {detailTask.summary}
            </div>
            <div className="lm-detail-kv">
              <span>状态</span>
              {detailTask.kind === "agent.instruction" ? "对话" : detailTask.status}
            </div>
            {detailTask.matterId && (
              <div className="lm-detail-kv">
                <span>案件 matterId</span>
                {detailTask.matterId}
              </div>
            )}
            <div className="lm-detail-kv">
              <span>类型 kind</span>
              {detailTask.kind}
            </div>
            {detailTask.sessionId && (
              <div className="lm-detail-kv">
                <span>会话 sessionId</span>
                {detailTask.sessionId}
              </div>
            )}
            {detailTask.outputPath && (
              <div className="lm-detail-kv">
                <span>交付路径 outputPath</span>
                {detailTask.outputPath}
              </div>
            )}
            {detailTask.assistantId && (
              <div className="lm-detail-kv">
                <span>助手</span>
                {detailTask.assistantId}
              </div>
            )}
            <div className="lm-detail-kv">
              <span>创建时间</span>
              {formatLocaleDateTime(detailTask.createdAt)}
            </div>
            <div className="lm-detail-kv">
              <span>更新时间</span>
              {formatLocaleDateTime(detailTask.updatedAt)}
            </div>
            <LawmindTaskCheckpoints checkpoints={detailCheckpoints} />
          </div>
        )}
        {!detailLoading && detailDraft && (
          <div className="lm-detail-body">
            <LawmindCitationBanner view={detailCitationIntegrity} />
            <div className="lm-detail-kv">
              <span>标题</span>
              {detailDraft.title}
            </div>
            {detailDraft.matterId && (
              <div className="lm-detail-kv">
                <span>案件 matterId</span>
                {detailDraft.matterId}
              </div>
            )}
            <div className="lm-detail-kv">
              <span>审核</span>
              {detailDraft.reviewStatus}
            </div>
            {detailDraft.outputPath && (
              <div className="lm-detail-kv">
                <span>交付路径</span>
                {detailDraft.outputPath}
              </div>
            )}
            <div className="lm-detail-kv">
              <span>摘要</span>
              {detailDraft.summary}
            </div>
          </div>
        )}
        <div className="lm-wizard-actions" style={{ flexWrap: "wrap", gap: 8 }}>
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
