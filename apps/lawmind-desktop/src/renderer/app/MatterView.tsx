import React from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import { MatterWorkbench } from "../MatterWorkbench";
import type { HistoryItem, TaskRow as ShellTaskRow } from "../lawmind-app-data";

export type MatterViewProps = {
  apiBase: string;
  refreshVersion: number;
  assistantId: string;
  selectedMatterKey: string | null;
  tasks: ShellTaskRow[];
  history: HistoryItem[];
  workspaceDir: string | null;
  projectDir: string | null;
  assistantDisplayById: Record<string, string>;
  onOpenShellDetail: (kind: "task" | "draft", id: string) => void;
  formatShellRelativeTime: (iso: string) => string;
  onMatterCreated: (matterId: string) => void;
  onUseInChat: (matterId: string) => void;
  onOpenWorkflowLibrary: () => void;
  onOpenTopLevelMeeting?: (matterId: string) => void;
  onOpenNeedsDecisionDesk?: () => void;
  onOpenChatSession: (sessionId: string, matterId?: string) => void;
  onOpenReview: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
  legalStatusLabel: (status: string | undefined, kind?: string) => string;
  taskBadgeClass: (status: string, kind?: string) => string;
  historyBadgeClass: (kind: string, taskRecordKind?: string, status?: string) => string;
};

function MatterViewImpl(props: MatterViewProps) {
  return (
    <div className="lm-main-workbench">
      <MatterWorkbench
        apiBase={props.apiBase}
        refreshVersion={props.refreshVersion}
        assistantId={props.assistantId}
        matterListPlacement="app-sidebar"
        selectedMatterKey={props.selectedMatterKey}
        shellTasks={props.tasks}
        shellHistory={props.history}
        onOpenShellDetail={props.onOpenShellDetail}
        formatShellRelativeTime={props.formatShellRelativeTime}
        shellAssistantDisplayById={props.assistantDisplayById}
        shellLegalStatusLabel={props.legalStatusLabel}
        shellTaskBadgeClass={props.taskBadgeClass}
        shellHistoryBadgeClass={props.historyBadgeClass}
        onMatterCreated={props.onMatterCreated}
        workspaceDir={props.workspaceDir}
        projectDir={props.projectDir}
        onUseInChat={props.onUseInChat}
        onOpenWorkflowLibrary={props.onOpenWorkflowLibrary}
        onOpenTopLevelMeeting={props.onOpenTopLevelMeeting}
        onOpenNeedsDecisionDesk={props.onOpenNeedsDecisionDesk}
        onOpenChatSession={props.onOpenChatSession}
        onOpenReview={props.onOpenReview}
      />
    </div>
  );
}

export const MatterView = React.memo(MatterViewImpl);
