import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ApprovalRequest, WorkQueueItem } from "../../../../../src/lawmind/core/contracts.ts";
import type { ArtifactDraft, TaskRecord } from "../../../../../src/lawmind/types.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import { apiGetJson, errorMessage } from "../api-client";
import { type AcceptanceSummaryItem } from "./matter-acceptance-display";
import { MatterTaskBoard } from "./MatterTaskBoard";
import type { TaskBoardJobInput } from "./matter-task-board";
import { LawmindApprovalQueue } from "../LawmindApprovalQueue";
import { MatterRoleBoard } from "./MatterRoleBoard";
import {
  buildRoleAssignmentRows,
  type RoleBoardAssistant,
  type RoleBoardRole,
  type RoleBoardRoster,
} from "./matter-role-board";

type ReviewOpenArgs = {
  taskId: string;
  matterId?: string;
  statusFilter?: ArtifactDraft["reviewStatus"] | "all";
  listMode?: "pending" | "all";
};

type Props = {
  apiBase: string;
  matterId: string | null;
  tasks: TaskRecord[];
  drafts: ArtifactDraft[];
  queueItems?: WorkQueueItem[];
  approvalRequests?: ApprovalRequest[];
  acceptanceByTask: Record<string, AcceptanceSummaryItem | undefined>;
  draftCitationByTask?: Record<string, DraftCitationIntegrityView | undefined>;
  onOpenReview?: (args: ReviewOpenArgs) => void;
  onOpenWorkflowLibrary?: () => void;
  onOpenChatSession?: (sessionId: string, matterId?: string) => void;
  onOpenNeedsDecision?: () => void;
  jobs?: TaskBoardJobInput[];
};

export function MatterTasksPanel(props: Props): ReactNode {
  const {
    apiBase,
    matterId,
    tasks,
    drafts,
    queueItems = [],
    approvalRequests = [],
    acceptanceByTask,
    onOpenReview,
    onOpenWorkflowLibrary,
    onOpenChatSession,
    onOpenNeedsDecision,
    jobs = [],
  } = props;

  const [roster, setRoster] = useState<RoleBoardRoster | null>(null);
  const [assistants, setAssistants] = useState<RoleBoardAssistant[]>([]);
  const [roles, setRoles] = useState<RoleBoardRole[]>([]);
  const [roleBoardError, setRoleBoardError] = useState<string | null>(null);
  const [roleBoardReloadKey, setRoleBoardReloadKey] = useState(0);

  useEffect(() => {
    if (!apiBase?.trim() || !matterId?.trim()) {
      setRoster(null);
      setAssistants([]);
      setRoles([]);
      setRoleBoardError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setRoleBoardError(null);
      try {
        const [rosterRes, assistantsRes, rolesRes] = await Promise.all([
          apiGetJson<{ ok?: boolean; roster?: RoleBoardRoster | null }>(
            apiBase,
            `/api/matters/team-roster?matterId=${encodeURIComponent(matterId)}`,
          ),
          apiGetJson<{ ok?: boolean; assistants?: RoleBoardAssistant[] }>(
            apiBase,
            "/api/assistants",
          ),
          apiGetJson<{ ok?: boolean; roles?: RoleBoardRole[] }>(apiBase, "/api/roles").catch(
            () => ({ ok: false, roles: [] as RoleBoardRole[] }),
          ),
        ]);
        if (cancelled) {
          return;
        }
        setRoster(rosterRes.roster ?? null);
        setAssistants(assistantsRes.assistants ?? []);
        setRoles(rolesRes.roles ?? []);
        setRoleBoardError(null);
      } catch (e) {
        if (!cancelled) {
          setRoster(null);
          setAssistants([]);
          setRoles([]);
          setRoleBoardError(errorMessage(e, "加载岗位编制失败"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, matterId, roleBoardReloadKey]);

  const roleRows = useMemo(
    () =>
      buildRoleAssignmentRows({
        roster,
        assistants,
        roles,
        pendingApprovals: approvalRequests,
      }),
    [approvalRequests, assistants, roles, roster],
  );

  return (
    <div className="lm-workbench-panel">
      <h3>任务与待办</h3>
      <p className="lm-meta">
        汇总任务进度、工作队列、待审批与草稿验收状态；优先处理标为待审批与待复核项。
      </p>
      <LawmindApprovalQueue
        apiBase={apiBase}
        matterId={matterId}
        onOpenSession={onOpenChatSession}
        onOpenReview={
          onOpenReview
            ? (taskId, mid) =>
                onOpenReview({ taskId, matterId: mid ?? matterId ?? undefined })
            : undefined
        }
        compact
      />
      {matterId ? (
        <MatterRoleBoard
          matterId={matterId}
          rows={roleRows}
          loadError={roleBoardError}
          onRetryLoad={() => setRoleBoardReloadKey((k) => k + 1)}
        />
      ) : null}
      <MatterTaskBoard
        matterId={matterId}
        tasks={tasks}
        queueItems={queueItems}
        approvalRequests={approvalRequests}
        drafts={drafts}
        acceptanceByTask={acceptanceByTask}
        onOpenReview={onOpenReview}
        onOpenWorkflowLibrary={onOpenWorkflowLibrary}
        onOpenNeedsDecision={onOpenNeedsDecision}
        jobs={jobs}
      />
    </div>
  );
}
