import type { ReactNode } from "react";
import type {
  AcceptanceReport,
  DeliverableReadiness,
} from "../../../../src/lawmind/deliverables/index.ts";
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
  /** Skills E6 — disable approve until checklist complete */
  approveDisabled?: boolean;
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
  /**
   * writing：文书台 — 改稿/预览/导出；正式通过·驳回·需修改在「在办」；
   * signoff：完整签批条（高级区或兜底路径）。
   */
  variant?: "writing" | "signoff";
  /** 文书台 → 在办：正式签批入口 */
  onOpenAgentsDesk?: () => void;
  /** 一览：签批 / 验收 / 必核 / 引用是否可交付 */
  readiness?: DeliverableReadiness | null;
};

export function LawmindReviewDeliveryBar(props: Props): ReactNode {
  const {
    reviewStatus,
    acceptance,
    actionBusy,
    lastOutputPath,
    onApprove,
    approveDisabled,
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
    variant = "writing",
    onOpenAgentsDesk,
    readiness = null,
  } = props;

  const status = reviewStatus ?? "pending";
  const approved = status === "approved";
  const writing = variant === "writing";
  const gateBlocked =
    acceptance != null && acceptance.deliverableType != null && !acceptance.ready;
  const gateSummary = buildRenderGateSummary({ reviewStatus: status, acceptance });

  const step2Done = status !== "pending";
  const step3Ready = approved && !gateBlocked && readiness?.readyToExport !== false;

  let primaryLabel = writing ? "导出" : "请先签批";
  let primaryAction: (() => void) | null = null;
  let primaryDisabled = true;

  const hardBlockExport =
    approved &&
    readiness != null &&
    !readiness.readyToExport &&
    readiness.blockers.some((b) => b.code === "checklist" || b.code === "citation");

  if (!approved) {
    primaryLabel = "导出";
    primaryDisabled = true;
  } else if (hardBlockExport) {
    primaryLabel = "不可导出";
    primaryDisabled = true;
  } else if (gateBlocked) {
    primaryLabel = "仍要导出";
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
    <section
      className={`lm-review-delivery-bar lm-review-delivery-bar-compact${writing ? " lm-review-delivery-bar-writing" : ""}`}
      aria-label={writing ? "导出与交付" : "审阅与交付"}
    >
      <div className="lm-review-delivery-head">
        <span className="lm-review-delivery-status" role="status">
          {reviewStatusDisplayLabel(status)}
          {step3Ready ? " · 可导出" : step2Done ? " · 待导出" : writing ? " · 改稿预览" : ""}
        </span>
        {gateSummary && approved ? (
          <span className="lm-review-delivery-gate-hint" title={gateSummary}>
            {gateSummary}
          </span>
        ) : null}
      </div>
      {readiness?.summaryZh ? (
        <p
          className={`lm-meta lm-review-readiness${readiness.readyToExport ? " lm-review-readiness-ok" : ""}`}
          role="status"
          data-testid="lm-deliverable-readiness"
          data-ready={readiness.readyToExport ? "true" : "false"}
        >
          {readiness.summaryZh}
        </p>
      ) : null}

      {writing && status === "pending" ? (
        <p className="lm-meta lm-review-writing-hint" role="note">
          此处改稿、批注并预览交付样式；正式通过 / 驳回 / 需修改请回「在办」。
        </p>
      ) : null}

      <div className="lm-review-delivery-actions">
        {writing && status === "pending" && onOpenAgentsDesk ? (
          <button
            type="button"
            className="lm-review-toolbar-primary"
            onClick={onOpenAgentsDesk}
            title="在办处理通过、驳回或需修改；无需打开全文预览的批复也在那里"
          >
            回到在办签批
          </button>
        ) : null}
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
        {!writing && status === "pending" ? (
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
              disabled={actionBusy || Boolean(approveDisabled)}
              title={approveDisabled ? "请先完成律师必核清单" : undefined}
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
          title={
            !approved
              ? writing
                ? "导出需先在「在办」完成签批通过"
                : "需先将签批标为「通过」"
              : hardBlockExport
                ? readiness?.summaryZh ?? "必核或引用未就绪，不可导出"
                : undefined
          }
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
            {actionBusy ? "导出中…" : "带修订"}
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
            title={lastOutputPath}
          >
            文件夹
          </button>
        ) : null}
        {lastOutputPath?.trim() &&
        onOpenWithSystem &&
        /\.docx?$/i.test(lastOutputPath) ? (
          <button
            type="button"
            className="lm-review-toolbar-ghost"
            title="用本机 Word / WPS 打开（不回写）"
            onClick={() => void onOpenWithSystem(lastOutputPath)}
          >
            Word
          </button>
        ) : null}
      </div>

      {lastOutputPath?.trim() ? (
        <p className="lm-meta lm-review-export-path" role="status" title={lastOutputPath}>
          {lastOutputPath.split(/[\\/]/).pop()}
        </p>
      ) : null}
      {writing ? null : (
        <p className="lm-meta lm-review-disclaimer">{LAWMIND_ATTORNEY_DISCLAIMER_SHORT}</p>
      )}
    </section>
  );
}
