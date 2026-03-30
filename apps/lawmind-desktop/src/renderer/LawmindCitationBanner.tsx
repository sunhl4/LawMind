import type { ReactNode } from "react";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";

type Props = {
  view: DraftCitationIntegrityView | null | undefined;
};

/**
 * Non-blocking provenance hint: draft section citations vs persisted research bundle.
 */
export function LawmindCitationBanner(props: Props): ReactNode {
  const { view } = props;
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
  return (
    <div className="lm-error lm-citation-warn" role="alert">
      <strong>引用不一致</strong>
      <p>以下 ID 不在本次检索 bundle 中：{view.missingSourceIds.join(", ")}</p>
      <ul className="lm-citation-warn-list">
        {view.sectionsWithIssues.map((s) => (
          <li key={s.heading}>
            「{s.heading}」：{s.missing.join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
}
