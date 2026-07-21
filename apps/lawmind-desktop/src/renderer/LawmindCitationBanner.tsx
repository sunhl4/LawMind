import type { ReactNode } from "react";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import { citationModeBannerKind, type CitationMode } from "../../../../src/lawmind/policy/citation-mode.ts";
import { looksLikeOpaqueSourceId } from "../../../../src/lawmind/sources/citation-display.ts";
import { LawmindSourcePill } from "./LawmindSourcePreview";

type Props = {
  view: DraftCitationIntegrityView | null | undefined;
  /**
   * Required for hover-preview wiring; without it we still render the banner
   * but suppress the source-pill popovers (legacy callers).
   */
  apiBase?: string;
  taskId?: string;
  /** When false (Solo), remind that export is not blocked; Firm+ hard-blocks render. */
  citationGateStrict?: boolean;
  /** Skills E4 — grounded / assisted / off */
  citationMode?: CitationMode;
};

/**
 * Provenance hint: draft section citations vs persisted research bundle.
 * Firm+ may hard-block export via citationGateStrict; Solo remains advisory unless grounded.
 */
export function LawmindCitationBanner(props: Props): ReactNode {
  const { view, apiBase, taskId, citationGateStrict, citationMode = "assisted" } = props;
  if (!view) {
    return null;
  }

  const kind = citationModeBannerKind(citationMode, view);
  const modeLabel =
    citationMode === "grounded" ? "严格援引" : citationMode === "off" ? "关闭" : "辅助标注";

  const editionHint =
    citationGateStrict === true
      ? "律所版：缺源或长段未锚定将在导出 Word 时被拦截（不影响签批）。"
      : citationGateStrict === false
        ? "独立版：引用提示默认不阻断签批；严格援引模式下导出仍可能被拦截。"
        : null;

  if (kind === "skip") {
    return <div className="lm-meta lm-citation-skip">引用模式：关闭（不对照检索快照）。</div>;
  }

  if (kind === "memory") {
    return (
      <div className="lm-meta lm-citation-memory" data-testid="lm-citation-mode-memory">
        引用：模型记忆 / 无检索快照对照 · 模式 {modeLabel}
        {editionHint ? <span className="lm-citation-edition-hint"> — {editionHint}</span> : null}
      </div>
    );
  }

  if (kind === "pending" && !view.checked) {
    return (
      <div className="lm-callout lm-callout-warn lm-citation-pending" role="status" data-testid="lm-citation-mode-pending">
        <div className="lm-callout-title">待核实引用</div>
        <p className="lm-callout-body">
          严格援引模式：尚无检索快照，导出 Word 将被拦截。请先完成检索或改为辅助标注。
        </p>
      </div>
    );
  }

  if (!view.checked) {
    return (
      <div className="lm-meta lm-citation-skip">引用：无检索快照，未对照。</div>
    );
  }

  if (view.missingSourceIds.length > 0) {
    const renderCite = (id: string): ReactNode =>
      apiBase ? (
        <LawmindSourcePill
          apiBase={apiBase}
          taskId={taskId}
          sourceId={id}
          label={looksLikeOpaqueSourceId(id) ? "出处未入库" : id}
        />
      ) : (
        <span className="lm-legal-cite-missing">出处未入库</span>
      );

    return (
      <div className="lm-callout lm-callout-danger lm-citation-warn" role="alert" data-testid="lm-citation-mode-danger">
        <div className="lm-callout-title">引用待核实 · {modeLabel}</div>
        <p className="lm-callout-body">
          下列出处未出现在本次检索结果中，请核对法条 / 案号是否写对：
        </p>
        <ul className="lm-citation-warn-list">
          {view.sectionsWithIssues.map((s) => (
            <li key={s.heading}>
              「{s.heading}」
              <span className="lm-source-pill-list">
                {s.missing.map((id) => (
                  <span key={id}>{renderCite(id)} </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
        {editionHint ? <p className="lm-meta lm-citation-edition-hint">{editionHint}</p> : null}
      </div>
    );
  }

  if ((view.unanchoredSections?.length ?? 0) > 0) {
    return (
      <div
        className={
          kind === "pending"
            ? "lm-callout lm-callout-warn lm-citation-unanchored"
            : "lm-callout lm-callout-warn lm-citation-unanchored"
        }
        role="status"
        data-testid={kind === "pending" ? "lm-citation-mode-pending" : "lm-citation-mode-verified"}
      >
        <div className="lm-callout-title">
          {kind === "pending" ? "待核实 · 部分章节缺少引用" : "部分章节缺少引用"}
        </div>
        <p className="lm-callout-body">
          以下章节正文较长但未标注检索来源，请核对后再定稿：
        </p>
        <ul className="lm-citation-warn-list">
          {(view.unanchoredSections ?? []).map((s) => (
            <li key={s.heading}>「{s.heading}」</li>
          ))}
        </ul>
        {editionHint ? <p className="lm-meta lm-citation-edition-hint">{editionHint}</p> : null}
      </div>
    );
  }

  if (view.ok || kind === "verified") {
    return (
      <div className="lm-meta lm-citation-ok" data-testid="lm-citation-mode-verified">
        出处已核实 · {modeLabel}
      </div>
    );
  }

  return null;
}
