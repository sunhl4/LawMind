import type { ReactNode } from "react";
import { matterComposeChipLabel } from "./lawmind-compose-context";

export type ComposeAttachmentFilePill = {
  id: string;
  shortLabel: string;
  title: string;
};

type Props = {
  filePills: ComposeAttachmentFilePill[];
  contextMatterId: string | null;
  /** When set, show a compact draft chip instead of a full-width banner. */
  contextTaskId?: string | null;
  matterTitle?: string | null;
  onRemoveFilePill: (id: string) => void;
  onClearFilePills: () => void;
  onClearMatter?: () => void;
  onClearTask?: () => void;
};

export function LawmindComposeAttachments(props: Props): ReactNode {
  const {
    filePills,
    contextMatterId,
    contextTaskId = null,
    matterTitle,
    onRemoveFilePill,
    onClearFilePills,
    onClearMatter,
    onClearTask,
  } = props;

  const hasTask = Boolean(contextTaskId?.trim());
  const hasMatter = Boolean(contextMatterId?.trim()) && !hasTask;

  if (filePills.length === 0 && !hasMatter && !hasTask) {
    return null;
  }

  const matterLabel = contextMatterId
    ? matterComposeChipLabel(contextMatterId, matterTitle)
    : matterTitle?.trim() || "本案";

  return (
    <div className="lm-compose-attachments" role="region" aria-label="本回合上下文">
      <span className="lm-compose-attachments-k">上下文</span>
      <div className="lm-compose-attachments-scroll">
        {hasTask && contextTaskId ? (
          <span
            className="lm-compose-chip lm-compose-chip--matter"
            title={`已关联草稿 ${contextTaskId}${contextMatterId ? ` · 案件 ${contextMatterId}` : ""}`}
          >
            <span className="lm-compose-chip-label">
              📄 草稿{matterTitle?.trim() ? ` · ${matterLabel}` : ""}
            </span>
            {onClearTask ? (
              <button
                type="button"
                className="lm-compose-chip-remove"
                aria-label="取消关联草稿"
                onClick={onClearTask}
              >
                ×
              </button>
            ) : null}
          </span>
        ) : null}
        {hasMatter && contextMatterId ? (
          <span
            className="lm-compose-chip lm-compose-chip--matter"
            title={`当前对话已关联案件：${matterLabel}（${contextMatterId}）`}
          >
            <span className="lm-compose-chip-label">已关联案件 · {matterLabel}</span>
            {onClearMatter ? (
              <button
                type="button"
                className="lm-compose-chip-remove"
                aria-label={`取消关联案件 ${matterLabel}`}
                onClick={onClearMatter}
              >
                ×
              </button>
            ) : null}
          </span>
        ) : null}
        {filePills.map((pill) => (
          <span key={pill.id} className="lm-compose-chip lm-compose-chip--file" title={pill.title}>
            <span className="lm-compose-chip-label">{pill.shortLabel}</span>
            <button
              type="button"
              className="lm-compose-chip-remove"
              aria-label={`移除引用 ${pill.title}`}
              onClick={() => onRemoveFilePill(pill.id)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {filePills.length > 0 ? (
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-small lm-compose-attachments-clear"
          onClick={onClearFilePills}
        >
          清空文件
        </button>
      ) : null}
    </div>
  );
}
