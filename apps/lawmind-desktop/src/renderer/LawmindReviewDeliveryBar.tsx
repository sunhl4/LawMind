import type { ReactNode } from "react";
import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { buildRenderGateSummary } from "./lawmind-render-gate-summary";
import { reviewStatusDisplayLabel } from "./lawmind-review-display";
import { LAWMIND_ATTORNEY_DISCLAIMER_SHORT } from "./lawmind-attorney-disclaimer";

type Props = {
  reviewStatus: ArtifactDraft["reviewStatus"] | undefined;
  acceptance: AcceptanceReport | null;
  actionBusy: boolean;
  lastOutputPath?: string | null;
  onApprove: () => void;
  onReject: () => void;
  onModify: () => void;
  onReopen: () => void;
  onExportWord: (opts?: { strict?: boolean }) => void;
  onExportTrackedWord?: () => void;
  onShowInFolder?: (path: string) => void;
  onOpenWithSystem?: (path: string) => void | Promise<void>;
  packExportEnabled?: boolean;
  onDownloadPack?: () => void;
  packBusy?: boolean;
};

export function LawmindReviewDeliveryBar(props: Props): ReactNode {
  const {
    reviewStatus,
    acceptance,
    actionBusy,
    lastOutputPath,
    onApprove,
    onReject,
    onModify,
    onReopen,
    onExportWord,
    onExportTrackedWord,
    onShowInFolder,
    onOpenWithSystem,
    packExportEnabled,
    onDownloadPack,
    packBusy,
  } = props;

  const status = reviewStatus ?? "pending";
  const approved = status === "approved";
  const gateBlocked =
    acceptance != null && acceptance.deliverableType != null && !acceptance.ready;
  const gateSummary = buildRenderGateSummary({ reviewStatus: status, acceptance });

  const step2Done = status !== "pending";
  const step3Ready = approved && !gateBlocked;

  let primaryLabel = "请先通过签批";
  let primaryAction: (() => void) | null = null;
  let primaryDisabled = true;

  if (!approved) {
    primaryLabel = "请先通过签批";
    primaryDisabled = true;
  } else if (gateBlocked) {
    primaryLabel = "仍要导出 Word（已知晓待补项）";
    primaryDisabled = actionBusy;
    primaryAction = () => {
      const blockers = acceptance?.blockerCount ?? 0;
      const ok = window.confirm(
        `验收清单仍有 ${blockers} 项阻塞。\n\n您已签批「通过」。确认在知晓待补项的前提下仍导出 Word？`,
      );
      if (ok) {
        onExportWord({ strict: false });
      }
    };
  } else {
    primaryLabel = actionBusy ? "导出中…" : "导出 Word";
    primaryDisabled = actionBusy;
    primaryAction = () => onExportWord({ strict: true });
  }

  return (
    <section className="lm-review-delivery-bar lm-review-delivery-bar-compact" aria-label="审阅与交付">
      <div className="lm-review-delivery-head">
        <span className="lm-review-delivery-status" role="status">
          签批 · {reviewStatusDisplayLabel(status)}
          {step3Ready ? " · 可导出" : step2Done ? " · 待导出" : " · 待签批"}
        </span>
        {gateSummary && approved ? (
          <span className="lm-review-delivery-gate-hint" title={gateSummary}>
            {gateSummary}
          </span>
        ) : null}
      </div>

      <div className="lm-review-delivery-actions">
        {status !== "pending" ? (
          <button
            type="button"
            className="lm-review-toolbar-ghost"
            disabled={actionBusy}
            onClick={onReopen}
          >
            恢复待审核
          </button>
        ) : null}
        {status === "pending" ? (
          <>
            <button
              type="button"
              className="lm-review-toolbar-ghost"
              disabled={actionBusy}
              onClick={onReject}
            >
              驳回
            </button>
            <button
              type="button"
              className="lm-review-toolbar-ghost"
              disabled={actionBusy}
              onClick={onModify}
            >
              需修改
            </button>
            <button
              type="button"
              className="lm-review-toolbar-primary"
              disabled={actionBusy}
              onClick={onApprove}
            >
              通过
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="lm-review-toolbar-primary lm-review-toolbar-primary-accent"
          disabled={primaryDisabled}
          title={!approved ? "需先将签批标为「通过」" : undefined}
          onClick={() => primaryAction?.()}
        >
          {primaryLabel}
        </button>
        {onExportTrackedWord ? (
          <button
            type="button"
            className="lm-review-toolbar-ghost"
            disabled={actionBusy || !approved}
            title="将 Redline 提案写入 Word 修订痕迹；需本机 officecli，否则回退为普通 docx"
            onClick={() => onExportTrackedWord()}
          >
            {actionBusy ? "导出中…" : "导出带修订 Word"}
          </button>
        ) : null}
        {packExportEnabled && onDownloadPack ? (
          <button
            type="button"
            className="lm-review-toolbar-ghost"
            disabled={packBusy || !approved || gateBlocked}
            onClick={() => onDownloadPack()}
          >
            {packBusy ? "打包中…" : "材料包"}
          </button>
        ) : null}
        {lastOutputPath?.trim() && onShowInFolder ? (
          <button
            type="button"
            className="lm-review-toolbar-ghost"
            onClick={() => onShowInFolder(lastOutputPath)}
          >
            在文件夹中显示
          </button>
        ) : null}
        {lastOutputPath?.trim() &&
        onOpenWithSystem &&
        /\.docx?$/i.test(lastOutputPath) ? (
          <button
            type="button"
            className="lm-review-toolbar-ghost"
            title="用本机 Word / WPS 打开（不回写；改完需重新导入或手动覆盖）"
            onClick={() => void onOpenWithSystem(lastOutputPath)}
          >
            用 Word 打开
          </button>
        ) : null}
      </div>

      {lastOutputPath?.trim() ? (
        <p className="lm-meta lm-review-export-path" role="status" title={lastOutputPath}>
          已生成 {lastOutputPath.split(/[\\/]/).pop()}
        </p>
      ) : null}
      <p className="lm-meta lm-review-disclaimer">{LAWMIND_ATTORNEY_DISCLAIMER_SHORT}</p>
    </section>
  );
}
