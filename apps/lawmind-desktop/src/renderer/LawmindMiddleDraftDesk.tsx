/**
 * 对话里点到还没有 Word 的草稿时，中栏打开草稿台，而不是报「找不到原件」。
 */
import { useEffect, useState, type ReactNode } from "react";
import { ReviewWorkbench } from "./ReviewWorkbench";
import {
  clearPendingDraftDesk,
  LAWMIND_OPEN_DRAFT_DESK_EVENT,
  type OpenDraftDeskDetail,
  peekPendingDraftDesk,
} from "./lawmind-open-contract-revision";
import { LAWMIND_OPEN_WORKSPACE_FILE_EVENT } from "./lawmind-workspace-file-open";

type Props = {
  apiBase?: string;
  assistantId?: string;
  /** 案卷占着中栏时先让开。 */
  hidden?: boolean;
  /** 草稿已导出时：把交付件放到中栏打开（点后草稿台自动让位）。 */
  onOpenArtifactInMiddleColumn?: (outputPath: string) => void;
  /** 交付件所在根：「用本机应用打开」据此解析，不再一律当工作区。 */
  workspaceDir?: string | null;
  projectDir?: string | null;
};

export function LawmindMiddleDraftDesk(props: Props): ReactNode {
  const {
    apiBase,
    assistantId,
    hidden = false,
    onOpenArtifactInMiddleColumn,
    workspaceDir,
    projectDir,
  } = props;
  const [taskId, setTaskId] = useState<string | null>(() => peekPendingDraftDesk());

  useEffect(() => {
    const open = (event: Event) => {
      const id =
        (event as CustomEvent<OpenDraftDeskDetail>).detail?.taskId?.trim() ||
        peekPendingDraftDesk() ||
        "";
      if (id) {
        setTaskId(id);
      }
    };
    const close = () => {
      clearPendingDraftDesk();
      setTaskId(null);
    };
    window.addEventListener(LAWMIND_OPEN_DRAFT_DESK_EVENT, open);
    window.addEventListener(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, close);
    const pending = peekPendingDraftDesk();
    if (pending) {
      setTaskId(pending);
    }
    return () => {
      window.removeEventListener(LAWMIND_OPEN_DRAFT_DESK_EVENT, open);
      window.removeEventListener(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, close);
    };
  }, []);

  if (!taskId || !apiBase?.trim() || hidden) {
    return null;
  }

  return (
    <div className="lm-middle-draft-desk" data-testid="lm-middle-draft-desk">
      <div className="lm-middle-draft-desk-bar">
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm"
          data-testid="lm-middle-draft-desk-back"
          onClick={() => {
            clearPendingDraftDesk();
            setTaskId(null);
          }}
        >
          回到文件
        </button>
      </div>
      <ReviewWorkbench
        key={taskId}
        apiBase={apiBase}
        assistantId={assistantId}
        initialTaskId={taskId}
        initialStatusFilter="all"
        initialListMode="all"
        onOpenArtifactInMiddleColumn={onOpenArtifactInMiddleColumn}
        workspaceDir={workspaceDir}
        projectDir={projectDir}
      />
    </div>
  );
}
