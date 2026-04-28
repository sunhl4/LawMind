import type { ReactNode } from "react";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import { LawmindSourcePill } from "./LawmindSourcePreview";

type Props = {
  view: DraftCitationIntegrityView | null | undefined;
  /**
   * Required for hover-preview wiring; without it we still render the banner
   * but suppress the source-pill popovers (legacy callers).
   */
  apiBase?: string;
  taskId?: string;
};

/**
 * Non-blocking provenance hint: draft section citations vs persisted research bundle.
 */
export function LawmindCitationBanner(props: Props): ReactNode {
  const { view, apiBase, taskId } = props;
  if (!view) {
    return null;
  }
  if (!view.checked) {
    return (
      <div className="lm-meta lm-citation-skip">
        引用校验：无检索快照（旧草稿或手工导入），跳过与检索结果的对照。
      </div>
    );
  }
  if (view.ok) {
    return (
      <div className="lm-meta lm-citation-ok">
        引用校验：草稿中标注的来源 ID 均在本次检索结果内。
      </div>
    );
  }
  // 缺失 ID 不一定在 bundle 内，但保留 hover 探查入口（无快照时显示 idle 状态即可）。
  const renderId = (id: string): ReactNode =>
    apiBase ? <LawmindSourcePill apiBase={apiBase} taskId={taskId} sourceId={id} /> : <code>{id}</code>;

  return (
    <div className="lm-callout lm-callout-danger lm-citation-warn" role="alert">
      <div className="lm-callout-title">引用不一致</div>
      <p className="lm-callout-body">
        以下 ID 不在本次检索 bundle 中：
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
    </div>
  );
}
