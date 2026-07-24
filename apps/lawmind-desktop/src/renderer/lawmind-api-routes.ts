/**
 * Typed local API route map for renderer clients.
 * Request bodies align with `src/lawmind/platform/local-api-schemas.ts`.
 */
import type {
  ApprovalResolvePostRequest,
  AssistantUpsertRequest,
  ChatPostRequest,
  ChatResumeRequest,
  ContractReviewAcceptPostRequest,
  ContractReviewDraftPostRequest,
  DelegationCreateRequest,
  DraftContentPatchBody,
  DraftReviewPostRequest,
  MatterCreatePostRequest,
  MatterDeletePostRequest,
  MatterDisplayNamePostRequest,
  MatterProfilePostRequest,
  MatterRolePostRequest,
  ModelsDefaultPatchRequest,
  ModelsDraftWithModelPatchRequest,
  RedlineHunkResolvePostRequest,
  SessionCreatePostRequest,
  SessionPatchTitleRequest,
  WorkflowRunRequest,
  WorkspacePolicyPatchRequest,
} from "./lawmind-api-request-types.ts";
import { apiSendJson } from "./api-client.ts";

type OkResponse = { ok: true } & Record<string, unknown>;

export type LawmindApiPostRoutes = {
  "/api/chat": {
    body: ChatPostRequest;
    response: OkResponse & { reply?: string; sessionId?: string };
  };
  "/api/chat/resume": {
    body: ChatResumeRequest;
    response: OkResponse & {
      reply?: string;
      sessionId?: string;
      status?: string;
      requiresAction?: unknown[];
    };
  };
  "/api/approvals/resolve": {
    body: ApprovalResolvePostRequest;
    response: OkResponse;
  };
  "/api/assistants": {
    body: AssistantUpsertRequest;
    response: OkResponse & { assistant?: Record<string, unknown> };
  };
  "/api/collaboration/workflow-run": {
    body: WorkflowRunRequest;
    response:
      | (OkResponse & { jobId: string; async?: boolean })
      | (OkResponse & { status?: string; report?: string; workflowId?: string });
  };
  "/api/delegations": {
    body: DelegationCreateRequest;
    response: OkResponse & { delegationId?: string; targetSessionId?: string };
  };
  "/api/learning/contract-review/drafts": {
    body: ContractReviewDraftPostRequest;
    response: OkResponse & { draft?: Record<string, unknown> };
  };
  "/api/learning/contract-review/drafts/accept": {
    body: ContractReviewAcceptPostRequest;
    response: OkResponse & { revisionId?: string; packRelativeDir?: string };
  };
  "/api/matters/create": {
    body: MatterCreatePostRequest;
    response: OkResponse & { matterId?: string };
  };
  "/api/matters/delete": {
    body: MatterDeletePostRequest;
    response: OkResponse;
  };
  "/api/matters/display-name": {
    body: MatterDisplayNamePostRequest;
    response: OkResponse;
  };
  "/api/matters/profile": {
    body: MatterProfilePostRequest;
    response: OkResponse & {
      profile?: {
        matterId: string;
        title: string;
        clientId?: string;
        sensitivity: "normal" | "high" | "restricted";
        status: string;
        causeOfAction?: string;
        counterparty?: string;
        needsEnrichment: boolean;
      };
      statusLine?: string;
    };
  };
  "/api/matters/role": {
    body: MatterRolePostRequest;
    response: OkResponse;
  };
  "/api/sessions": {
    body: SessionCreatePostRequest;
    response: OkResponse & { sessionId?: string; title?: string };
  };
  "/api/skills/enabled": {
    body: { skillId: string; enabled: boolean };
    response: OkResponse & { skills?: Array<Record<string, unknown>> };
  };
};

export type LawmindApiPatchRoutes = {
  "/api/models/default": {
    body: ModelsDefaultPatchRequest;
    response: OkResponse;
  };
  "/api/models/draft-with-model": {
    body: ModelsDraftWithModelPatchRequest;
    response: OkResponse;
  };
  "/api/policy/workspace": {
    body: WorkspacePolicyPatchRequest;
    response: OkResponse & { highSecurityMode?: boolean };
  };
};

export type LawmindApiPostPath = keyof LawmindApiPostRoutes;
export type LawmindApiPatchPath = keyof LawmindApiPatchRoutes;

export type LawmindDraftReviewResponse = OkResponse & {
  draft?: Record<string, unknown>;
  citationIntegrity?: Record<string, unknown>;
  profileAppendFailed?: boolean;
  lawyerProfileAppendFailed?: boolean;
  profileLearningSkipped?: boolean;
  lawyerProfileLearningSkipped?: boolean;
  executionState?: Record<string, unknown>;
  gateDecisions?: unknown[];
};

export type LawmindDraftContentPatchResponse = OkResponse & {
  draft?: Record<string, unknown>;
  citationIntegrity?: Record<string, unknown>;
  acceptance?: Record<string, unknown>;
  executionState?: Record<string, unknown>;
  gateDecisions?: unknown[];
};

export type LawmindRedlineResolveResponse = OkResponse & {
  proposal?: Record<string, unknown>;
};

export async function apiPost<Path extends LawmindApiPostPath>(
  apiBase: string,
  path: Path,
  body: LawmindApiPostRoutes[Path]["body"],
): Promise<LawmindApiPostRoutes[Path]["response"]> {
  return apiSendJson<LawmindApiPostRoutes[Path]["response"], LawmindApiPostRoutes[Path]["body"]>(
    apiBase,
    path,
    "POST",
    body,
  );
}

export async function apiPatch<Path extends LawmindApiPatchPath>(
  apiBase: string,
  path: Path,
  body: LawmindApiPatchRoutes[Path]["body"],
): Promise<LawmindApiPatchRoutes[Path]["response"]> {
  return apiSendJson<LawmindApiPatchRoutes[Path]["response"], LawmindApiPatchRoutes[Path]["body"]>(
    apiBase,
    path,
    "PATCH",
    body,
  );
}

export async function apiPostDraftReview(
  apiBase: string,
  taskId: string,
  body: DraftReviewPostRequest,
): Promise<LawmindDraftReviewResponse> {
  return apiSendJson<LawmindDraftReviewResponse, DraftReviewPostRequest>(
    apiBase,
    `/api/drafts/${encodeURIComponent(taskId)}/review`,
    "POST",
    body,
  );
}

export async function apiPatchDraftContent(
  apiBase: string,
  taskId: string,
  body: DraftContentPatchBody,
): Promise<LawmindDraftContentPatchResponse> {
  return apiSendJson<LawmindDraftContentPatchResponse, DraftContentPatchBody>(
    apiBase,
    `/api/drafts/${encodeURIComponent(taskId)}/content`,
    "PATCH",
    body,
  );
}

export async function apiPostRedlineHunkResolve(
  apiBase: string,
  taskId: string,
  hunkId: string,
  body: RedlineHunkResolvePostRequest,
): Promise<LawmindRedlineResolveResponse> {
  return apiSendJson<LawmindRedlineResolveResponse, RedlineHunkResolvePostRequest>(
    apiBase,
    `/api/drafts/${encodeURIComponent(taskId)}/redline/hunks/${encodeURIComponent(hunkId)}/resolve`,
    "POST",
    body,
  );
}

export async function apiPostRedlineResolveAll(
  apiBase: string,
  taskId: string,
  body: RedlineHunkResolvePostRequest,
): Promise<LawmindRedlineResolveResponse & { resolved?: number }> {
  return apiSendJson<LawmindRedlineResolveResponse & { resolved?: number }, RedlineHunkResolvePostRequest>(
    apiBase,
    `/api/drafts/${encodeURIComponent(taskId)}/redline/resolve-all`,
    "POST",
    body,
  );
}

export async function apiPatchAssistant(
  apiBase: string,
  assistantId: string,
  body: AssistantUpsertRequest,
): Promise<OkResponse & { assistant?: Record<string, unknown> }> {
  return apiSendJson<OkResponse & { assistant?: Record<string, unknown> }, AssistantUpsertRequest>(
    apiBase,
    `/api/assistants/${encodeURIComponent(assistantId)}`,
    "PATCH",
    body,
  );
}

export async function apiPatchSessionTitle(
  apiBase: string,
  sessionId: string,
  body: SessionPatchTitleRequest,
): Promise<OkResponse> {
  return apiSendJson<OkResponse, SessionPatchTitleRequest>(
    apiBase,
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    "PATCH",
    body,
  );
}
