import type { ReactNode } from "react";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";

export function DraftCitationBadge(props: {
  cit: DraftCitationIntegrityView | undefined;
}): ReactNode {
  const { cit } = props;
  if (!cit) {
    return null;
  }
  if (!cit.checked) {
    return (
      <span className="lm-matter-cit lm-matter-cit-skip" title="无检索快照，无法对照检索快照">
        无快照
      </span>
    );
  }
  if (cit.ok) {
    return (
      <span className="lm-matter-cit lm-matter-cit-ok" title="章节引用 ID 均在本次检索快照内">
        已核实
      </span>
    );
  }
  return (
    <span
      className="lm-matter-cit lm-matter-cit-warn"
      title={`以下 ID 不在检索快照内：${cit.missingSourceIds.join(", ")}`}
    >
      引用待核
    </span>
  );
}
