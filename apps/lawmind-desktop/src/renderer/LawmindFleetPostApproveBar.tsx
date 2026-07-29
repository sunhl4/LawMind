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
  onOpenReview?: (taskId: string, matterId?: string) => void;
  onShowArtifact?: (outputPath: string) => void;
  onDismiss: () => void;
  onOpenError: (message: string) => void;
};

export function LawmindFleetPostApproveBar(props: LawmindFleetPostApproveBarProps): ReactNode {
  const {
    state,
    workspaceDir,
    onExport,
    onOpenReview,
    onShowArtifact,
    onDismiss,
    onOpenError,
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
            : "可直接导出 Word，或进入文书台核对后再导出。"}
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
        {onOpenReview ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-fleet-post-approve-review"
            onClick={() => onOpenReview(state.taskId, state.matterId)}
          >
            去文书台
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
