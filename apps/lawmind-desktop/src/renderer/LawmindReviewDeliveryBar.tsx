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
   * writing：文书台默认 — 导出优先，通过/驳回弱化为次要；
   * signoff：侧栏完整签批（仍保留，正式拍板主路径在「在办」）。
   */
  variant?: "writing" | "signoff";
  /** 文书台 → 在办：正式签批入口 */
  onOpenAgentsDesk?: () => void;
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
  } = props;

  const status = reviewStatus ?? "pending";
  const approved = status === "approved";
  const writing = variant === "writing";
  const gateBlocked =
    acceptance != null && acceptance.deliverableType != null && !acceptance.ready;
  const gateSummary = buildRenderGateSummary({ reviewStatus: status, acceptance });

  const step2Done = status !== "pending";
  const step3Ready = approved && !gateBlocked;

  let primaryLabel = writing ? "导出" : "请先签批";
  let primaryAction: (() => void) | null = null;
  let primaryDisabled = true;

  if (!approved) {
    primaryLabel = "导出";
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
          {step3Ready ? " · 可导出" : step2Done ? " · 待导出" : ""}
        </span>
        {gateSummary && approved ? (
          <span className="lm-review-delivery-gate-hint" title={gateSummary}>
            {gateSummary}
          </span>
        ) : null}
        {writing && status === "pending" && onOpenAgentsDesk ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-small"
            onClick={onOpenAgentsDesk}
            title="正式通过 / 驳回请在在办完成"
          >
            回在办
          </button>
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
              title={writing ? "也可在「在办」驳回" : undefined}
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
              className={writing ? "lm-review-toolbar-ghost" : "lm-review-toolbar-primary"}
              disabled={actionBusy || Boolean(approveDisabled)}
              title={
                approveDisabled
                  ? "请先完成律师必核清单"
                  : writing
                    ? "正式签批建议回「在办」；此处可补记通过"
                    : undefined
              }
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
          title={!approved ? (writing ? "需先完成签批（建议回在办）" : "需先将签批标为「通过」") : undefined}
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
