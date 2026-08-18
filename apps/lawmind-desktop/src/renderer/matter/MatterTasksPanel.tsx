/**
 * 案件工作台「任务与草稿」：引用/验收徽标 + 去审核。
 */

import type { ReactNode } from "react";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { ArtifactDraft, TaskRecord } from "../../../../../src/lawmind/types.ts";

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
  hasSpec: boolean;
  outputPath: string | null;
};

export function DraftCitationBadge(props: { cit: DraftCitationIntegrityView | undefined }): ReactNode {
  const { cit } = props;
  if (!cit) {
    return null;
  }
  if (!cit.checked) {
    return (
      <span className="lm-matter-cit lm-matter-cit-skip" title="无检索快照，无法对照 bundle">
        无快照
      </span>
    );
  }
  if (cit.ok) {
    return (
      <span className="lm-matter-cit lm-matter-cit-ok" title="章节引用 ID 均在本次检索 bundle 内">
        引用OK
      </span>
    );
  }
  return (
    <span
      className="lm-matter-cit lm-matter-cit-warn"
      title={`以下 ID 不在检索 bundle：${cit.missingSourceIds.join(", ")}`}
    >
      引用待核
    </span>
  );
}

export function DraftAcceptanceBadge(props: { acc: AcceptanceSummaryItem | undefined }): ReactNode {
  const { acc } = props;
  if (!acc) {
    return null;
  }
  if (!acc.hasSpec) {
    return (
      <span className="lm-acc-badge lm-acc-badge--none" title="该草稿未关联 DeliverableSpec">
        无门禁
      </span>
    );
  }
  if (acc.ready) {
    return (
      <span
        className="lm-acc-badge lm-acc-badge--ok"
        title={`通过验收门禁（占位符 ${acc.placeholderCount}）`}
      >
        ✓ 验收通过
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

type Props = {
  tasks: TaskRecord[];
  drafts: ArtifactDraft[];
  matterId?: string | null;
  draftCitationByTask: Record<string, DraftCitationIntegrityView | undefined>;
  acceptanceByTask: Record<string, AcceptanceSummaryItem | undefined>;
  onOpenReview?: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
};

export function MatterTasksPanel({
  tasks,
  drafts,
  matterId,
  draftCitationByTask,
  acceptanceByTask,
  onOpenReview,
}: Props): ReactNode {
  return (
    <div className="lm-workbench-panel lm-two-col" data-testid="lm-matter-tasks">
      <div>
        <h3>任务</h3>
        <ul className="lm-bullet-list">
          {tasks.map((t) => (
            <li key={t.taskId}>
              <strong>{t.status}</strong> — {t.summary.slice(0, 200)}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3>草稿</h3>
        <ul className="lm-bullet-list lm-matter-draft-list">
          {drafts.map((d) => {
            const acc = acceptanceByTask[d.taskId];
            const dataReady = acc && acc.hasSpec ? (acc.ready ? "true" : "false") : undefined;
            return (
              <li key={d.taskId} className="lm-matter-draft-row" data-ready={dataReady}>
                <div className="lm-matter-draft-title">
                  <span>{d.title}</span>
                  <em className="lm-matter-draft-status">{d.reviewStatus}</em>
                  <DraftCitationBadge cit={draftCitationByTask[d.taskId]} />
                  <DraftAcceptanceBadge acc={acc} />
                </div>
                {onOpenReview ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary lm-btn-small lm-matter-draft-action"
                    onClick={() =>
                      onOpenReview({
                        taskId: d.taskId,
                        matterId: d.matterId ?? matterId ?? undefined,
                        statusFilter: "all",
                        listMode: "all",
                      })
                    }
                  >
                    去审核
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default MatterTasksPanel;
