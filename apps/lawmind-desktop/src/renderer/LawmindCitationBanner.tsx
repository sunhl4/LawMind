import type { ReactNode } from "react";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import { LawmindSourcePill } from "./LawmindSourcePreview";
import { shortenOpaqueId } from "./display-ids";

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
};

/**
 * Provenance hint: draft section citations vs persisted research bundle.
 * Firm+ may hard-block export via citationGateStrict; Solo remains advisory.
 */
export function LawmindCitationBanner(props: Props): ReactNode {
  const { view, apiBase, taskId, citationGateStrict } = props;
  if (!view) {
    return null;
  }
  if (!view.checked) {
    return (
      <div className="lm-meta lm-citation-skip">引用：无检索快照，未对照。</div>
    );
  }

  const editionHint =
    citationGateStrict === true
      ? "律所版：缺源或长段未锚定将在导出 Word 时被拦截（不影响签批）。"
      : citationGateStrict === false
        ? "独立版：引用提示不阻断签批与导出；请人工核对来源。"
        : null;

  if (view.missingSourceIds.length > 0) {
    // 缺失 ID 不一定在 bundle 内，但保留 hover 探查入口（无快照时显示 idle 状态即可）。
    const renderId = (id: string): ReactNode =>
      apiBase ? (
        <LawmindSourcePill apiBase={apiBase} taskId={taskId} sourceId={id} />
      ) : (
        <span className="lm-opaque-id-chip" title={id}>
          {shortenOpaqueId(id)}
        </span>
      );

    return (
      <div className="lm-callout lm-callout-danger lm-citation-warn" role="alert">
        <div className="lm-callout-title">引用不一致</div>
        <p className="lm-callout-body">
          以下条目未出现在本次检索结果中：
          <span className="lm-source-pill-list">
            {view.missingSourceIds.map((id) => (
              <span key={id}>{renderId(id)} </span>
            ))}
          </span>
        </p>
        <ul className="lm-citation-warn-list">
          {view.sectionsWithIssues.map((s) => (
            <li key={s.heading}>
              「{s.heading}」：
              <span className="lm-source-pill-list">
                {s.missing.map((id) => (
                  <span key={id}>{renderId(id)} </span>
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
      <div className="lm-callout lm-callout-warn lm-citation-unanchored" role="status">
        <div className="lm-callout-title">部分章节缺少引用</div>
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

  if (view.ok) {
    return (
      <div className="lm-meta lm-citation-ok">引用：与检索结果一致。</div>
    );
  }

  return null;
}

