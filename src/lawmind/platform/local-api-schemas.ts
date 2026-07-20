/**
 * Shared Zod schemas for LawMind local HTTP API request bodies.
 * Imported by desktop server routes and renderer typed clients.
 */
import { z } from "zod";

export const trimmedNonEmptyString = z.string().trim().min(1);

export const modelsTestRequestSchema = z.object({
  modelId: z.string().trim().optional(),
});

export type ModelsTestRequest = z.infer<typeof modelsTestRequestSchema>;

export const modelsDefaultPatchSchema = z.object({
  modelId: trimmedNonEmptyString,
});

export type ModelsDefaultPatchRequest = z.infer<typeof modelsDefaultPatchSchema>;

export const modelsDraftWithModelPatchSchema = z.object({
  enabled: z.boolean(),
});

export type ModelsDraftWithModelPatchRequest = z.infer<typeof modelsDraftWithModelPatchSchema>;

export const modelsCustomPostSchema = z.object({
  label: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  setAsDefault: z.boolean().optional(),
  keyStorage: z.enum(["keychain", "env"]).optional(),
});

export type ModelsCustomPostRequest = z.infer<typeof modelsCustomPostSchema>;

export const delegationCreateRequestSchema = z.object({
  fromAssistantId: trimmedNonEmptyString,
  toAssistantId: trimmedNonEmptyString,
  task: trimmedNonEmptyString,
  matterId: z.string().trim().optional(),
  priority: z.enum(["normal", "high", "low"]).optional(),
  parentSessionId: z.string().trim().optional(),
  modelId: z.string().trim().optional(),
});

export type DelegationCreateRequest = z.infer<typeof delegationCreateRequestSchema>;

export const workflowRunRequestSchema = z.object({
  templateId: trimmedNonEmptyString,
  matterId: z.string().trim().optional(),
  assistantId: z.string().trim().optional(),
  modelId: z.string().trim().optional(),
  vars: z.record(z.string(), z.string()).optional(),
  async: z.boolean().optional(),
  idempotencyKey: z.string().trim().optional(),
  scheduleRunAt: z.string().trim().optional(),
});

export type WorkflowRunRequest = z.infer<typeof workflowRunRequestSchema>;

export const chatResumeDecisionSchema = z.enum(["approve", "reject", "edit", "respond"]);

export const chatResumeRequestSchema = z.object({
  sessionId: trimmedNonEmptyString,
  actionId: trimmedNonEmptyString,
  decision: chatResumeDecisionSchema,
  editedArgs: z.record(z.string(), z.unknown()).optional(),
  clarificationAnswers: z.record(z.string(), z.string()).optional(),
});

export type ChatResumeRequest = z.infer<typeof chatResumeRequestSchema>;

export const matterCaseNoteSectionSchema = z.enum(["core_issue", "risk", "artifact", "task_goal"]);

export const matterCaseNoteRequestSchema = z.object({
  matterId: trimmedNonEmptyString,
  section: matterCaseNoteSectionSchema,
  note: trimmedNonEmptyString,
});

export type MatterCaseNoteRequest = z.infer<typeof matterCaseNoteRequestSchema>;

export const matterInteractionActionSchema = z.enum([
  "open_review",
  "save_upgrade_suggestion",
  "write_case_note",
]);

export const matterInteractionRequestSchema = z.object({
  matterId: trimmedNonEmptyString,
  taskId: z.string().trim().optional(),
  action: matterInteractionActionSchema,
  surface: z.string().optional(),
  label: z.string().optional(),
  target: z.enum(["lawyer", "assistant"]).optional(),
  variant: z.enum(["conservative", "standard", "assertive"]).optional(),
  section: matterCaseNoteSectionSchema.optional(),
});

export type MatterInteractionRequest = z.infer<typeof matterInteractionRequestSchema>;

export const chatPostRequestSchema = z.object({
  message: z.string().optional(),
  modelId: z.string().trim().optional(),
  sessionId: z.string().trim().optional(),
  matterId: z.string().trim().optional(),
  assistantId: z.string().trim().optional(),
  allowWebSearch: z.boolean().optional(),
  enableCollaboration: z.boolean().optional(),
  projectDir: z.string().optional(),
  includeTurnDiagnostics: z.boolean().optional(),
  contextPins: z.unknown().optional(),
  linkedTaskId: z.string().trim().optional(),
  meetingMode: z.boolean().optional(),
  meetingAgenda: z.string().optional(),
  /**
   * 会议室发言角色（仅 meetingMode）：
   * - lawyer：律师发言（默认）→ 时间线记「您」
   * - chair：主持人催办智能体互相对话 → 时间线记「主持人」系统条
   * - conclude：请指定助手综合结论与工作计划 → 时间线记「主持人」系统条
   */
  meetingTurnKind: z.enum(["lawyer", "chair", "conclude"]).optional(),
  sessionTitleHint: z.string().optional(),
  permissionMode: z.string().optional(),
});

export type ChatPostRequest = z.infer<typeof chatPostRequestSchema>;

export const matterRolePostSchema = z.object({
  matterId: trimmedNonEmptyString,
  role: trimmedNonEmptyString,
});

export type MatterRolePostRequest = z.infer<typeof matterRolePostSchema>;

export const matterCreatePostSchema = z.object({
  matterId: trimmedNonEmptyString,
  displayName: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  sensitivity: z.enum(["normal", "high", "restricted"]).optional(),
  engagementAccepted: z.boolean().optional(),
  conflictCheckConfirmed: z.boolean().optional(),
});

export type MatterCreatePostRequest = z.infer<typeof matterCreatePostSchema>;

export const matterDisplayNamePostSchema = z.object({
  matterId: trimmedNonEmptyString,
  displayName: trimmedNonEmptyString,
});

export type MatterDisplayNamePostRequest = z.infer<typeof matterDisplayNamePostSchema>;

/** 案件工作台事后补全档案（建案时不强制填写）。 */
export const matterProfilePostSchema = z.object({
  matterId: trimmedNonEmptyString,
  title: z.string().trim().min(1).max(200).optional(),
  clientId: z.string().trim().max(128).optional(),
  sensitivity: z.enum(["normal", "high", "restricted"]).optional(),
  status: z
    .enum([
      "intake",
      "active",
      "waiting_on_client",
      "waiting_on_firm",
      "under_review",
      "delivered",
      "closed",
    ])
    .optional(),
  causeOfAction: z.string().trim().max(200).optional(),
  counterparty: z.string().trim().max(200).optional(),
  conflictCheckConfirmed: z.boolean().optional(),
  engagementAccepted: z.boolean().optional(),
});

export type MatterProfilePostRequest = z.infer<typeof matterProfilePostSchema>;

export const matterDeletePostSchema = z.object({
  matterId: trimmedNonEmptyString,
});

export type MatterDeletePostRequest = z.infer<typeof matterDeletePostSchema>;

export const templateScanPostSchema = z.object({
  path: trimmedNonEmptyString,
});

export type TemplateScanPostRequest = z.infer<typeof templateScanPostSchema>;

export const templateRegisterPostSchema = z.object({
  id: trimmedNonEmptyString,
  label: z.string().trim().optional(),
  format: z.string().trim().optional(),
  path: z.string().trim().optional(),
  sourcePath: z.string().trim().optional(),
  placeholderMap: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

export type TemplateRegisterPostRequest = z.infer<typeof templateRegisterPostSchema>;

export const templateEnabledPostSchema = z.object({
  id: trimmedNonEmptyString,
  enabled: z.boolean(),
});

export type TemplateEnabledPostRequest = z.infer<typeof templateEnabledPostSchema>;

export const sessionCreatePostSchema = z.object({
  assistantId: z.string().trim().optional(),
  matterId: z.string().trim().optional(),
  title: z.string().trim().optional(),
});

export type SessionCreatePostRequest = z.infer<typeof sessionCreatePostSchema>;

export const sessionDeletePostSchema = z.object({
  sessionId: trimmedNonEmptyString,
  assistantId: z.string().trim().optional(),
});

export type SessionDeletePostRequest = z.infer<typeof sessionDeletePostSchema>;

export const sessionPatchTitleSchema = z.object({
  title: z.string(),
});

export type SessionPatchTitleRequest = z.infer<typeof sessionPatchTitleSchema>;

export const lawyerProfileLearningPostSchema = z.object({
  note: trimmedNonEmptyString,
  source: z.string().trim().optional(),
  taskId: z.string().trim().optional(),
});

export type LawyerProfileLearningPostRequest = z.infer<typeof lawyerProfileLearningPostSchema>;

export const assistantProfileLearningPostSchema = z.object({
  assistantId: trimmedNonEmptyString,
  note: trimmedNonEmptyString,
});

export type AssistantProfileLearningPostRequest = z.infer<
  typeof assistantProfileLearningPostSchema
>;

export const redlineHunkResolvePostSchema = z.object({
  decision: z.enum(["accept", "reject"]),
});

export type RedlineHunkResolvePostRequest = z.infer<typeof redlineHunkResolvePostSchema>;

export const firstrunWizardPostSchema = z.object({
  matterId: trimmedNonEmptyString,
});

export type FirstrunWizardPostRequest = z.infer<typeof firstrunWizardPostSchema>;

export const approvalResolvePostSchema = z.object({
  matterId: trimmedNonEmptyString,
  approvalId: trimmedNonEmptyString,
  status: z.enum(["approved", "rejected", "needs_changes"]),
  resolvedBy: z.string().trim().optional(),
});

export type ApprovalResolvePostRequest = z.infer<typeof approvalResolvePostSchema>;

export const deskSettingsPostSchema = z.object({
  contractBatchRelativeDir: z.string().nullable().optional(),
});

export type DeskSettingsPostRequest = z.infer<typeof deskSettingsPostSchema>;

export const workspacePolicyPatchSchema = z.object({
  highSecurityMode: z.boolean(),
});

export type WorkspacePolicyPatchRequest = z.infer<typeof workspacePolicyPatchSchema>;

export const assistantOrgRoleSchema = z.enum(["lead", "member", "intern"]);

export const assistantUpsertSchema = z.object({
  assistantId: z.string().trim().optional(),
  displayName: z.string().optional(),
  introduction: z.string().optional(),
  presetKey: z.string().optional(),
  customRoleTitle: z.string().optional(),
  customRoleInstructions: z.string().optional(),
  orgRole: assistantOrgRoleSchema.optional(),
  reportsToAssistantId: z.string().optional(),
  peerReviewDefaultAssistantId: z.string().optional(),
});

export type AssistantUpsertRequest = z.infer<typeof assistantUpsertSchema>;

export const draftReviewStatusSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.enum(["approved", "rejected", "modified"]),
);

export const draftReviewPostSchema = z.object({
  status: draftReviewStatusSchema,
  note: z.string().optional(),
  appendToProfile: z.boolean().optional(),
  appendToLawyerProfile: z.boolean().optional(),
  profileAssistantId: z.string().trim().optional(),
  labels: z.unknown().optional(),
  deferMemoryWrites: z.boolean().optional(),
});

export type DraftReviewPostRequest = z.infer<typeof draftReviewPostSchema>;

export const draftRenderPostSchema = z.object({
  templateId: z.string().trim().optional(),
});

export type DraftRenderPostRequest = z.infer<typeof draftRenderPostSchema>;

const draftSectionSchema = z.object({
  heading: trimmedNonEmptyString,
  body: z.string(),
  citations: z
    .array(z.string())
    .optional()
    .transform((arr) => {
      if (!arr) {
        return undefined;
      }
      const filtered = arr
        .filter((cite): cite is string => typeof cite === "string" && cite.trim().length > 0)
        .map((cite) => cite.trim());
      return filtered.length > 0 ? filtered : undefined;
    }),
});

export const draftContentPatchBodySchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    summary: z.string().optional(),
    sections: z.array(draftSectionSchema).min(1).optional(),
  })
  .refine((v) => v.title !== undefined || v.summary !== undefined || v.sections !== undefined, {
    message: "no content fields",
  });

export type DraftContentPatchBody = z.infer<typeof draftContentPatchBodySchema>;

export const memoryScopeSchema = z.enum([
  "firm",
  "lawyer",
  "client",
  "matter",
  "playbook",
  "opponent",
  "project",
  "assistant",
]);

export const memoryAdoptionSuggestSchema = z.object({
  scope: memoryScopeSchema,
  kind: trimmedNonEmptyString,
  payload: trimmedNonEmptyString,
  targetId: z.string().optional(),
  sourceTaskId: z.string().optional(),
  note: z.string().optional(),
  autoAdopt: z.boolean().optional(),
});

export type MemoryAdoptionSuggestRequest = z.infer<typeof memoryAdoptionSuggestSchema>;

export const memoryAdoptionIdSchema = z.object({
  id: trimmedNonEmptyString,
  note: z.string().optional(),
});

export type MemoryAdoptionIdRequest = z.infer<typeof memoryAdoptionIdSchema>;

export const draftRevisionJobPostSchema = z.object({
  instruction: z.string().trim().optional(),
  assistantId: z.string().trim().optional(),
  projectDir: z.unknown().optional(),
});

export type DraftRevisionJobPostRequest = z.infer<typeof draftRevisionJobPostSchema>;

export const contractReviewDraftPostSchema = z.object({
  draftId: z.string().trim().optional(),
  initialPath: trimmedNonEmptyString,
  revisedPath: trimmedNonEmptyString,
  lawyerAnnotations: z.string().optional(),
  keyModificationsDraft: z.array(z.string()).optional(),
  matterId: z.string().trim().optional(),
  assistantId: z.string().trim().optional(),
  status: z.enum(["open", "withdrawn"]).optional(),
});

export type ContractReviewDraftPostRequest = z.infer<typeof contractReviewDraftPostSchema>;

export const contractReviewAcceptPostSchema = z.object({
  draftId: trimmedNonEmptyString,
  stableDocumentKey: z.string().trim().optional(),
  appendLawyerProfileBullet: z.boolean().optional(),
  title: z.string().optional(),
});

export type ContractReviewAcceptPostRequest = z.infer<typeof contractReviewAcceptPostSchema>;

export const learningContractFinalizePostSchema = z.object({
  initialPath: trimmedNonEmptyString,
  finalPath: trimmedNonEmptyString,
  keyModifications: z.union([z.array(z.string()), z.string()]).optional(),
  title: z.string().optional(),
  requirementsSummary: z.string().optional(),
  matterId: z.string().trim().optional(),
  assistantId: z.string().trim().optional(),
  appendLawyerProfileBullet: z.boolean().optional(),
  stableDocumentKey: z.string().trim().optional(),
  lawyerReviewNotes: z.string().optional(),
});

export type LearningContractFinalizePostRequest = z.infer<
  typeof learningContractFinalizePostSchema
>;

export const fsWritePostSchema = z.object({
  root: z.string().optional(),
  path: z.string().optional(),
  content: z.string().optional(),
  expectedMtimeMs: z.number().optional(),
});

export type FsWritePostRequest = z.infer<typeof fsWritePostSchema>;

export const sourceAnnotationPostSchema = z.object({
  comment: trimmedNonEmptyString,
  taskId: z.string().optional(),
  matterId: z.string().optional(),
  kind: z.string().optional(),
  createdBy: z.string().optional(),
  linkedDraftId: z.string().optional(),
  createLearning: z.boolean().optional(),
  range: z
    .object({
      start: z.number(),
      end: z.number(),
    })
    .optional(),
});

export type SourceAnnotationPostRequest = z.infer<typeof sourceAnnotationPostSchema>;
