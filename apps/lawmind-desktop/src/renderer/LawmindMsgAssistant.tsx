import type { ReactNode } from "react";
import { splitWordCheckMarkers } from "../../../../src/lawmind/drafts/word-review-marker.ts";
import { renderLegalMarkdown } from "./lawmind-chat-markdown";
import { openContractRevisionForTask } from "./lawmind-open-contract-revision";

type Props = {
  text: string;
  modelFailure?: boolean;
  className?: string;
  apiBase?: string;
  workspaceDir?: string;
  onOpenError?: (message: string) => void;
};

export function LawmindMsgAssistant({
  text,
  modelFailure,
  className,
  apiBase,
  workspaceDir,
  onOpenError,
}: Props): ReactNode {
  if (!text.trim()) {
    return null;
  }
  const { body, taskIds } = splitWordCheckMarkers(text);
  return (
    <div
      className={`lm-msg lm-msg-ai${modelFailure ? " lm-msg-model-failure" : ""}${className ? ` ${className}` : ""}`}
    >
      {body ? renderLegalMarkdown(body) : null}
      {taskIds.map((taskId) => (
        <button
          key={taskId}
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          data-testid="lm-word-check-open"
          onClick={() => {
            if (!apiBase?.trim()) {
              onOpenError?.("本地服务未就绪，请从在办打开修订窗。");
              return;
            }
            void openContractRevisionForTask({ apiBase, taskId, workspaceDir }).then((result) => {
              if (!result.ok) {
                onOpenError?.(result.error);
              }
            });
          }}
        >
          去核对
        </button>
      ))}
    </div>
  );
}
