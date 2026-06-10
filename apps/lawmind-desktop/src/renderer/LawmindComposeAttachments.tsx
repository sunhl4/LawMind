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
  matterTitle?: string | null;
  onRemoveFilePill: (id: string) => void;
  onClearFilePills: () => void;
  onClearMatter?: () => void;
};

export function LawmindComposeAttachments(props: Props): ReactNode {
  const {
    filePills,
    contextMatterId,
    matterTitle,
    onRemoveFilePill,
    onClearFilePills,
    onClearMatter,
  } = props;

  if (filePills.length === 0 && !contextMatterId) {
    return null;
  }

  return (
    <div className="lm-compose-attachments" role="region" aria-label="本回合上下文">
      <span className="lm-compose-attachments-k">上下文</span>
      <div className="lm-compose-attachments-scroll">
        {contextMatterId ? (
          <span className="lm-compose-chip lm-compose-chip--matter" title={`案件：${contextMatterId}`}>
            <span className="lm-compose-chip-label">
              📂 {matterComposeChipLabel(contextMatterId, matterTitle)}
            </span>
            {onClearMatter ? (
              <button
                type="button"
                className="lm-compose-chip-remove"
                aria-label={`移除案件 ${matterComposeChipLabel(contextMatterId, matterTitle)}`}
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
