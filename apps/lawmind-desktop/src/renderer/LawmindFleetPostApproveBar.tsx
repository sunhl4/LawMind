/**
 * 签批通过后的导出条（从 Fleet 办理区抽出）。
 */
import type { ReactNode } from "react";
import type { PostApproveExportState } from "./lawmind-post-approve-export";
import { toWorkspaceRelativePath } from "./lawmind-workspace-relpath";

export type LawmindFleetPostApproveBarProps = {
  state: PostApproveExportState;
  workspaceDir?: string;
  onExport: () => void;
  /** 合同审阅稿（tracked changes）；有则显示次按钮 */
  onExportTracked?: () => void;
  trackedBusy?: boolean;
  onOpenReview?: (taskId: string, matterId?: string) => void;
  onShowArtifact?: (outputPath: string) => void;
  onDismiss: () => void;
  onOpenError: (message: string) => void;
  onOpenHealth?: () => void;
  onSaveAsAutomation?: () => void;
  saveAsAutomationBusy?: boolean;
  saveAsAutomationHint?: string | null;
};

export function LawmindFleetPostApproveBar(props: LawmindFleetPostApproveBarProps): ReactNode {
  const {
    state,
    workspaceDir,
    onExport,
    onExportTracked,
    trackedBusy = false,
    onOpenReview,
    onShowArtifact,
    onDismiss,
    onOpenError,
    onOpenHealth,
    onSaveAsAutomation,
    saveAsAutomationBusy = false,
    saveAsAutomationHint,
  } = props;

  return (
    <div
      className="lm-callout lm-callout-info lm-fleet-post-approve"
      role="status"
      data-testid="lm-fleet-post-approve"
    >
      <p className="lm-callout-title">已通过：{state.title}</p>
      <p className="lm-callout-body">
        {state.status === "ok" && state.outputPath
          ? `已导出 ${state.outputPath.split(/[\\/]/).pop()}`
          : state.status === "error"
            ? state.errorMessage
            : state.status === "exporting"
              ? "正在导出 Word…"
              : "导出 Word"}
      </p>
      <div className="lm-fleet-post-approve-actions">
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-btn-sm"
          data-testid="lm-fleet-post-approve-export"
          disabled={state.status === "exporting"}
          onClick={() => onExport()}
        >
          {state.status === "exporting"
            ? "导出中…"
            : state.status === "ok"
              ? "再次导出"
              : "导出 Word"}
        </button>
        {onExportTracked ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-fleet-post-approve-tracked"
            disabled={trackedBusy || state.status === "exporting"}
            onClick={() => onExportTracked()}
          >
            {trackedBusy ? "审阅稿…" : "导出审阅稿"}
          </button>
        ) : null}
        {onOpenReview ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-fleet-post-approve-review"
            onClick={() => onOpenReview(state.taskId, state.matterId)}
          >
            去改稿
          </button>
        ) : null}
        {onSaveAsAutomation ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-fleet-save-automation"
            disabled={saveAsAutomationBusy}
            onClick={() => onSaveAsAutomation()}
          >
            {saveAsAutomationBusy ? "保存中…" : "存成自动办件"}
          </button>
        ) : null}
        {state.matterWriteFailed && onOpenHealth ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            data-testid="lm-fleet-post-approve-health"
            onClick={() => onOpenHealth()}
          >
            打开系统健康
          </button>
        ) : null}
        {state.status === "ok" && state.outputPath ? (
          <>
            {(() => {
              const rel = toWorkspaceRelativePath(workspaceDir, state.outputPath);
              if (!rel || !window.lawmindDesktop?.openWithSystem) {
                return null;
              }
              return (
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-sm"
                  data-testid="lm-fleet-post-approve-word"
                  title="用本机 Word / WPS 打开（不回写）"
                  onClick={() => {
                    void window.lawmindDesktop
                      ?.openWithSystem?.({ root: "workspace", path: rel })
                      .then((r) => {
                        if (r && !r.ok) {
                          onOpenError(r.error ?? "无法用系统应用打开该文件");
                        }
                      });
                  }}
                >
                  用 Word 打开
                </button>
              );
            })()}
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              onClick={() => {
                const p = state.outputPath!;
                if (onShowArtifact) {
                  onShowArtifact(p);
                } else if (typeof window !== "undefined") {
                  void window.lawmindDesktop?.showItemInFolder?.(p);
                }
              }}
            >
              文件夹
            </button>
          </>
        ) : null}
        {saveAsAutomationHint ? (
          <p className="lm-meta" role="status" data-testid="lm-fleet-save-automation-hint">
            {saveAsAutomationHint}
          </p>
        ) : null}
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm"
          data-testid="lm-fleet-post-approve-dismiss"
          onClick={() => onDismiss()}
        >
          关闭
        </button>
      </div>
    </div>
  );
}
