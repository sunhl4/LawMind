import type { ReactNode } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";

export type AcceptanceSummaryItem = {
  taskId: string;
  matterId: string | null;
  title: string;
  deliverableType: string | null;
  reviewStatus: ArtifactDraft["reviewStatus"];
  ready: boolean;
  placeholderCount: number;
  blockerCount: number;
  warningCount: number;
  topBlockers?: string[];
  hasSpec: boolean;
  outputPath: string | null;
};

export function DraftAcceptanceBadge(props: { acc: AcceptanceSummaryItem | undefined }): ReactNode {
  const { acc } = props;
  if (!acc) {
    return null;
  }
  if (!acc.hasSpec) {
    return (
      <span className="lm-acc-badge lm-acc-badge--none" title="未挂出稿检查规则">
        无验收规则
      </span>
    );
  }
  if (acc.ready) {
    return (
      <span
        className="lm-acc-badge lm-acc-badge--ok"
        title={`出稿检查已通过（占位符 ${acc.placeholderCount}）`}
      >
        ✓ 出稿检查通过
      </span>
    );
  }
  const tip =
    `阻断 ${acc.blockerCount} · 警告 ${acc.warningCount}` +
    (acc.placeholderCount > 0 ? ` · 占位符 ${acc.placeholderCount}` : "");
  return (
    <span className="lm-acc-badge lm-acc-badge--err" title={tip}>
      ✗ 待修复
    </span>
  );
}
