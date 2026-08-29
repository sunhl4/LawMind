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
  const { view, apiBase, taskId, citationMode = "assisted" } = props;
  if (!view) {
    return null;
  }

  const kind = citationModeBannerKind(citationMode, view);
  const modeLabel =
    citationMode === "grounded" ? "严格援引" : citationMode === "off" ? "关闭" : "辅助标注";

  if (kind === "skip") {
    return <div className="lm-meta lm-citation-skip">引用模式：关闭</div>;
  }

  if (kind === "memory") {
    return (
      <div className="lm-meta lm-citation-memory" data-testid="lm-citation-mode-memory">
        引用：无检索快照 · {modeLabel}
      </div>
    );
  }

  if (kind === "pending" && !view.checked) {
    return (
      <div className="lm-callout lm-callout-warn lm-citation-pending" role="status" data-testid="lm-citation-mode-pending">
        <div className="lm-callout-title">缺源 · 待核实引用</div>
        <p className="lm-callout-body">无检索快照·将拦导出</p>
      </div>
    );
  }

  if (!view.checked) {
    return (
      <div
        className="lm-callout lm-callout-warn lm-citation-pending"
        role="status"
        data-testid="lm-citation-mode-nosnapshot"
      >
        <div className="lm-callout-title">缺源 · 无检索快照</div>
        <p className="lm-callout-body">未对照检索</p>
      </div>
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
        <p className="lm-callout-body">下列出处未出现在本次检索结果中：</p>
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
      </div>
    );
  }

  if ((view.unanchoredSections?.length ?? 0) > 0) {
    const pending = kind === "pending";
    return (
      <div
        className={
          pending
            ? "lm-callout lm-callout-danger lm-citation-unanchored"
            : "lm-callout lm-callout-warn lm-citation-unanchored"
        }
        role={pending ? "alert" : "status"}
        data-testid={pending ? "lm-citation-mode-pending" : "lm-citation-unanchored"}
      >
        <div className="lm-callout-title">
          {pending ? "未锚定 · 将拦导出" : "未锚定 · 部分章节缺引用"}
        </div>
        <ul className="lm-citation-warn-list">
          {(view.unanchoredSections ?? []).map((s) => (
            <li key={s.heading}>「{s.heading}」</li>
          ))}
        </ul>
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
