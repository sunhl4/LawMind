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
  /** 导出始终走 strict 验收门禁；UI 不再提供 ?strict=false 绕过入口。 */
  onExportWord: () => void;
  onExportTrackedWord?: () => void;
  onShowInFolder?: (path: string) => void;
  onOpenWithSystem?: (path: string) => void | Promise<void>;
  packExportEnabled?: boolean;
  onDownloadPack?: () => void;
  packBusy?: boolean;
  /**
   * writing：文书台 — 改稿/预览/导出；本地出稿不进待拍板；
   * signoff：完整签批条（高级区或兜底路径）。
   */
  variant?: "writing" | "signoff";
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
    readiness = null,
  } = props;

  const status = reviewStatus ?? "pending";
  const approved = status === "approved";
  const writing = variant === "writing";
  const gateBlocked =
    acceptance != null && acceptance.deliverableType != null && !acceptance.ready;
  const gateSummary = buildRenderGateSummary({ reviewStatus: status, acceptance });

  const step2Done = status !== "pending";
  const step3Ready = !gateBlocked && readiness?.readyToExport !== false;

  let primaryLabel = writing ? "导出" : "请先签批";
  let primaryAction: (() => void) | null = null;
  let primaryDisabled = true;

  const hardBlockExport =
    !writing &&
    approved &&
    readiness != null &&
    !readiness.readyToExport &&
    readiness.blockers.some((b) => b.code === "checklist" || b.code === "citation");

  if (writing) {
    if (gateBlocked) {
      // 验收门禁是核心卖点：UI 不提供绕过入口，阻塞时禁导出并提示补齐。
      primaryLabel = "不可导出";
      primaryDisabled = true;
    } else {
      primaryLabel = actionBusy ? "导出中…" : "导出审查意见书";
      primaryDisabled = actionBusy;
      primaryAction = () => onExportWord();
    }
  } else if (!approved) {
    primaryLabel = "导出";
    primaryDisabled = true;
  } else if (hardBlockExport) {
    primaryLabel = "不可导出";
    primaryDisabled = true;
  } else if (gateBlocked) {
    primaryLabel = "不可导出";
    primaryDisabled = true;
  } else {
    primaryLabel = actionBusy ? "导出中…" : "导出审查意见书";
    primaryDisabled = actionBusy;
    primaryAction = () => onExportWord();
  }

  return (
    <section
      className={`lm-review-delivery-bar lm-review-delivery-bar-compact${writing ? " lm-review-delivery-bar-writing" : ""}`}
      aria-label={writing ? "导出与交付" : "审阅与交付"}
    >
      <div className="lm-review-delivery-head">
        <span className="lm-review-delivery-status" role="status">
          {reviewStatusDisplayLabel(status)}
          {step3Ready ? " · 可导出" : step2Done ? " · 待导出" : writing ? " · 改稿" : ""}
        </span>
        {gateSummary && (writing || approved) ? (
          <span className="lm-review-delivery-gate-hint" title={gateSummary}>
            {gateSummary}
          </span>
        ) : null}
      </div>
      {writing && gateBlocked ? (
        <p
          className="lm-meta lm-review-export-blockers"
          role="status"
          data-testid="lm-review-export-blockers"
        >
          出稿检查未通过：阻塞 {acceptance?.blockerCount ?? 0}
          {(acceptance?.placeholderCount ?? 0) > 0
            ? ` · 占位 ${acceptance?.placeholderCount}`
            : ""}
          。请先处理上方「出稿检查」阻塞项后再严格导出。
        </p>
      ) : null}
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

      <div className="lm-review-delivery-actions">
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
        {writing || approved ? (
          <button
            type="button"
            className="lm-review-toolbar-primary lm-review-toolbar-primary-accent"
            disabled={primaryDisabled}
            title={
              writing
                ? "导出到本机，不发给对方"
                : !approved
                  ? "需先将签批标为「通过」"
                  : hardBlockExport
                    ? readiness?.summaryZh ?? "必核或引用未就绪，不可导出"
                    : undefined
            }
            onClick={() => primaryAction?.()}
          >
            {primaryLabel}
          </button>
        ) : null}
        {onExportTrackedWord && (writing || approved) ? (
          <button
            type="button"
            className="lm-review-toolbar-ghost"
            disabled={actionBusy}
            title="导出修订稿"
            onClick={() => onExportTrackedWord()}
          >
            {actionBusy ? "导出中…" : "导出合同审阅稿"}
          </button>
        ) : null}
        {packExportEnabled || lastOutputPath?.trim() || (writing && status !== "pending") ? (
          <details className="lm-review-delivery-more" data-testid="lm-review-delivery-more">
            <summary className="lm-review-toolbar-ghost">更多交付</summary>
            <div className="lm-review-delivery-more-menu">
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
          </details>
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
