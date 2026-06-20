import type { GateDecision, TaskExecutionState } from "../../../../../../src/lawmind/platform/contracts.ts";

export type CollabSummaryState =
  | undefined
  | null
  | {
      collaborationEnabled: boolean;
      collaborationHint?: string;
      delegationCount: number;
    };

export type WorkflowTemplateRow = {
  id: string;
  name: string;
  description: string;
  stepCount: number;
};

export type WorkflowJobListItem = {
  jobId: string;
  status: string;
  workflowId: string;
  createdAt: string;
  error?: string;
  cancelRequested?: boolean;
  progress?: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    runningStepIds: string[];
    updatedAt?: string;
  };
  executionState?: TaskExecutionState;
  gateDecisions?: GateDecision[];
};

/** 近期任务列表中，除「当前运行中」任务外，最多并发 SSE 路数。 */
export const MAX_RECENT_JOB_SSE = 2;
export const RECENT_JOBS_RECONCILE_MS = 72_000;
