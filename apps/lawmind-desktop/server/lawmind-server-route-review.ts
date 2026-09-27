import path from "node:path";
import {
  assertChecklistCompleteForApprove,
  buildChecklistView,
  describeDraftScaffold,
  validateDraftAgainstSpec,
  validateReasoningForDraft,
} from "../../../src/lawmind/deliverables/index.js";
import { appendProductMetric } from "../../../src/lawmind/metrics/product-metrics.js";
import {
  buildAgentMemorySourceReport,
  loadMemoryContext,
  toEngineClientMemorySnapshot,
} from "../../../src/lawmind/memory/index.js";
import {
  adoptLearningSuggestion,
  dismissLearningSuggestion,
  listLearningSuggestions,
} from "../../../src/lawmind/learning/suggestion-queue.js";
import {
  appendAssistantProfileMarkdown,
  buildReviewProfileLine,
} from "../../../src/lawmind/assistants/profile-md.js";
import { DEFAULT_ASSISTANT_ID, resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import {
  appendLawyerProfileLearning,
  buildLawyerProfileReviewLearningLine,
} from "../../../src/lawmind/memory/index.js";
import {
  clearExecutablePreference,
  formatExecutablePreferencesHint,
  loadExecutablePreferences,
  writeExecutablePreference,
} from "../../../src/lawmind/memory/executable-preferences.js";
import {
  extractAppliedPreferencesFromProfile,
  formatAppliedPreferencesHint,
} from "../../../src/lawmind/memory/applied-preferences.js";
import {
  appendProvenanceEvent,
  createProvenanceEvent,
  deleteDraft,
  persistDraft,
  readDraft,
  readReasoningSnapshot,
  resolveClauseGraphForDraft,
  resolveDraftCitationIntegrity,
} from "../../../src/lawmind/drafts/index.js";
import { lawyerGuardianViewFromSidecar } from "../../../src/lawmind/guardian/store.js";
import {
  isDeliverableReviewStampCurrent,
  linkDraftToDeliverable,
} from "../../../src/lawmind/application/services/deliverable-service.js";
import { emit } from "../../../src/lawmind/audit/index.js";
import type { ArtifactSection, ArtifactDraft } from "../../../src/lawmind/types.js";
import { applyContractRevisionAccumulationAfterApprovedReview } from "../../../src/lawmind/learning/contract-revision-on-review-approved.js";
import { maybeEmitFirstrunAcceptanceReady } from "../../../src/lawmind/onboarding/firstrun-state.js";
import { serializeLegalReasoningGraph } from "../../../src/lawmind/reasoning/index.js";
import { parseReviewLabels } from "../../../src/lawmind/review-labels.js";
import {
  deleteTaskRecord,
  deriveExecutionPlanSteps,
  listTaskCheckpoints,
  readTaskRecord,
  updateTaskRecord,
} from "../../../src/lawmind/tasks/index.js";
import type { AcceptanceReport } from "../../../src/lawmind/deliverables/index.js";
import type { TaskExecutionState } from "../../../src/lawmind/platform/contracts.js";
import {
  emitPlatformGateSnapshot,
  type PlatformGateAuditSource,
} from "../../../src/lawmind/platform/audit-gate.js";
import { deriveReviewGateDecisions } from "../../../src/lawmind/platform/review-gates.js";
import { resolveEdition } from "../../../src/lawmind/policy/edition.js";
import { resolveCitationMode } from "../../../src/lawmind/policy/citation-mode.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import {
  isInvalidRequestBodyError,
  parseJsonBodyZod,
  type LawmindRequestParseError,
} from "./lawmind-api-parse.js";
import {
  assistantProfileLearningPostSchema,
  draftContentPatchBodySchema,
  draftRenderPostSchema,
  draftReviewPostSchema,
  lawyerProfileLearningPostSchema,
} from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import {
  getLawMindEngine,
  isLawMindHttpError,
  resolveDesktopActorId,
  safeOptionalProjectDir,
  sendJson,
} from "./lawmind-server-helpers.js";
import { isSafeAssistantIdSegment } from "./safe-assistant-id.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";

function deriveReviewExecutionState(
  draft: ArtifactDraft,
  acceptance?: AcceptanceReport,
): TaskExecutionState {
  const reviewStatus = draft.reviewStatus ?? "pending";
  if (reviewStatus === "pending") {
    return {
      phase: "approval",
      status: "awaiting_approval",
      linkedTaskId: draft.taskId,
      recoverable: true,
      detail: "等待律师签批。",
    };
  }
  if (reviewStatus === "modified") {
    return {
      phase: "clarify",
      status: "awaiting_clarification",
      linkedTaskId: draft.taskId,
      recoverable: true,
      detail: "草稿已标记为需修改，等待修订。",
    };
  }
  if (reviewStatus === "rejected") {
    return {
      phase: "clarify",
      status: "awaiting_clarification",
      linkedTaskId: draft.taskId,
      recoverable: true,
      detail: "草稿已驳回，等待新指令。",
    };
  }
  if (draft.outputPath) {
    return {
      phase: "complete",
      status: "completed",
      linkedTaskId: draft.taskId,
      recoverable: false,
      detail: "草稿已通过并完成交付物渲染。",
    };
  }
  if (acceptance && !acceptance.ready) {
    return {
      phase: "approval",
      status: "awaiting_approval",
      linkedTaskId: draft.taskId,
      recoverable: true,
      detail: "出稿检查未通过，暂不可渲染。",
    };
  }
  return {
    phase: "render",
    status: "running",
    linkedTaskId: draft.taskId,
    recoverable: true,
    detail: "草稿已通过签批，可执行渲染交付。",
  };
}

function mapDraftContentPatchError(err: LawmindRequestParseError): string {
  const issue = err.issues[0] ?? "";
  if (issue.includes("no content fields")) {
    return "no content fields";
  }
  if (issue.startsWith("title:")) {
    return "title must be non-empty string";
  }
  if (issue.startsWith("summary:")) {
    return "summary must be string";
  }
  if (issue.startsWith("sections:")) {
    return "sections must be non-empty array";
  }
  if (issue.includes("heading")) {
    return "section heading required";
  }
  if (issue.includes("sections")) {
    return "invalid section";
  }
  return "body required";
}

function toDraftContentPatch(body: {
  title?: string;
  summary?: string;
  sections?: Array<{ heading: string; body: string; citations?: string[]; provenance?: ArtifactSection["provenance"] }>;
}): { title?: string; summary?: string; sections?: ArtifactSection[] } {
  const patch: { title?: string; summary?: string; sections?: ArtifactSection[] } = {};
  if (body.title !== undefined) {
    patch.title = body.title;
  }
  if (body.summary !== undefined) {
    patch.summary = body.summary;
  }
  if (body.sections !== undefined) {
    patch.sections = body.sections.map((section) => ({
      heading: section.heading,
      body: section.body,
      ...(section.citations?.length ? { citations: section.citations } : {}),
      ...(section.provenance ? { provenance: section.provenance } : {}),
    }));
  }
  return patch;
}

function patchSectionsWithLawyerEditProvenance(
  oldSections: ArtifactSection[],
  newSections: ArtifactSection[],
  actorId: string,
): ArtifactSection[] {
  return newSections.map((section, index) => {
    const old = oldSections[index];
    if (!old) {
      // New section added by the lawyer.
      return {
        ...section,
        provenance: appendProvenanceEvent(
          section.provenance,
          createProvenanceEvent("lawyer_edit", "user", {
            userId: actorId,
            diffSummary: "新增章节",
          }),
        ),
      };
    }
    const headingChanged = old.heading !== section.heading;
    const bodyChanged = old.body !== section.body;
    const citationsChanged =
      JSON.stringify(old.citations ?? []) !== JSON.stringify(section.citations ?? []);
    if (!headingChanged && !bodyChanged && !citationsChanged) {
      // Preserve the existing provenance chain if the client did not send it.
      return { ...section, provenance: section.provenance ?? old.provenance };
    }
    const changedParts: string[] = [];
    if (headingChanged) {
      changedParts.push("标题");
    }
    if (bodyChanged) {
      changedParts.push("正文");
    }
    if (citationsChanged) {
      changedParts.push("引用");
    }
    const diffSummary = bodyChanged
      ? `编辑正文：${changedParts.join("、")}`
      : changedParts.join("、");
    return {
      ...section,
      provenance: appendProvenanceEvent(
        old.provenance,
        createProvenanceEvent("lawyer_edit", "user", {
          userId: actorId,
          diffSummary,
          reason: changedParts.join(","),
        }),
      ),
    };
  });
}

async function auditReviewGateSnapshot(
  workspaceDir: string,
  draft: ArtifactDraft,
  source: PlatformGateAuditSource,
  acceptance?: AcceptanceReport,
  actorId?: string,
  extraContext?: Record<string, string>,
): Promise<void> {
  const executionState = deriveReviewExecutionState(draft, acceptance);
  const gateDecisions = deriveReviewGateDecisions(draft, acceptance);
  await emitPlatformGateSnapshot(path.join(workspaceDir, "audit"), {
    taskId: draft.taskId,
    source,
    actor: "lawyer",
    actorId: actorId ?? resolveDesktopActorId(),
    executionState,
    gateDecisions,
    context: { reviewStatus: draft.reviewStatus ?? "pending", ...extraContext },
  });
}

/**
 * ?strict=false 的 env 门：与 approve 路径 LAWMIND_ALLOW_CHECKLIST_BYPASS 同级的
 * 显式「破窗」开关。未开启时 URL 参数一律按 strict 处理，验收门禁不被查询参数绕过。
 * （刻意不含 VITEST 捷径：测试须显式设 env，负向用例才能成立。）
 */
export function isRenderGateBypassAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LAWMIND_ALLOW_RENDER_GATE_BYPASS?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export async function handleReviewRoute({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir, envFile } = ctx;

  if (pathname === "/api/learning/suggestions" && req.method === "GET") {
    const filter = url.searchParams.get("filter") === "all" ? "all" : "pending";
    const suggestions = await listLearningSuggestions(workspaceDir, filter);
    sendJson(res, 200, { ok: true, suggestions }, c);
    return true;
  }

  {
    const adoptMatch = pathname.match(/^\/api\/learning\/suggestions\/([^/]+)\/adopt$/);
    if (adoptMatch && req.method === "POST") {
      const id = decodeURIComponent(adoptMatch[1] ?? "");
      if (!id) {
        sendJson(res, 400, { ok: false, error: "id required" }, c);
        return true;
      }
      const auditDir = path.join(workspaceDir, "audit");
      const result = await adoptLearningSuggestion(workspaceDir, auditDir, id);
      if (!result.ok) {
        sendJson(res, 400, { ok: false, error: result.error ?? "adopt failed" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true }, c);
      return true;
    }
  }

  {
    const dismissMatch = pathname.match(/^\/api\/learning\/suggestions\/([^/]+)\/dismiss$/);
    if (dismissMatch && req.method === "POST") {
      const id = decodeURIComponent(dismissMatch[1] ?? "");
      if (!id) {
        sendJson(res, 400, { ok: false, error: "id required" }, c);
        return true;
      }
      const auditDir = path.join(workspaceDir, "audit");
      const result = await dismissLearningSuggestion(workspaceDir, auditDir, id);
      if (!result.ok) {
        sendJson(res, 400, { ok: false, error: result.error ?? "dismiss failed" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true }, c);
      return true;
    }
  }

  if (pathname === "/api/lawyer-profile/applied-preferences" && req.method === "GET") {
    try {
      const memory = await loadMemoryContext(workspaceDir);
      const preferences = loadExecutablePreferences(workspaceDir, memory.profile ?? "", 8);
      const legacy = extractAppliedPreferencesFromProfile(memory.profile ?? "", 5);
      sendJson(
        res,
        200,
        {
          ok: true,
          preferences,
          legacyPreferences: legacy,
          hint:
            formatExecutablePreferencesHint(preferences) ??
            formatAppliedPreferencesHint(legacy) ??
            null,
        },
        c,
      );
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  {
    const clearPrefMatch = pathname.match(/^\/api\/lawyer-profile\/applied-preferences\/([^/]+)$/);
    if (clearPrefMatch && req.method === "DELETE") {
      const rawId = decodeURIComponent(clearPrefMatch[1] ?? "").trim();
      if (!rawId || rawId.length > 120) {
        sendJson(res, 400, { ok: false, error: "invalid preference id" }, c);
        return true;
      }
      try {
        const result = clearExecutablePreference(workspaceDir, rawId);
        if (!result.ok) {
          sendJson(res, 400, { ok: false, error: "cannot_clear_profile_preference" }, c);
          return true;
        }
        sendJson(res, 200, { ok: true, cleared: result.cleared }, c);
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
      }
      return true;
    }
  }

  if (pathname === "/api/lawyer-profile/learning" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, lawyerProfileLearningPostSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "note required" }, c);
        return true;
      }
      throw err;
    }
    const note = body.note;
    const src = body.source?.trim().toLowerCase() === "manual" ? "manual" : "review";
    const auditTaskId = body.taskId?.trim() || undefined;
    try {
      const r = await appendLawyerProfileLearning(workspaceDir, note, src, {
        auditDir: path.join(workspaceDir, "audit"),
        auditTaskId,
      });
      try {
        writeExecutablePreference(workspaceDir, {
          text: note,
          tags: src === "manual" ? ["cold_start"] : ["review"],
        });
      } catch {
        /* JSON prefs optional */
      }
      sendJson(res, 200, { ok: true, skipped: r.skipped }, c);
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
      return true;
    }
    return true;
  }

  if (pathname === "/api/assistants/profile/learning" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, assistantProfileLearningPostSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "assistantId required" }, c);
        return true;
      }
      throw err;
    }
    const assistantId = body.assistantId;
    const note = body.note;
    if (!isSafeAssistantIdSegment(assistantId)) {
      sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
      return true;
    }
    try {
      const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
      appendAssistantProfileMarkdown(lawMindRoot, assistantId, note);
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
      return true;
    }
    sendJson(res, 200, { ok: true }, c);
    return true;
  }

  {
    const taskDetailMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskDetailMatch && req.method === "GET") {
      const raw = decodeURIComponent(taskDetailMatch[1] ?? "");
      if (!isSafeTaskIdSegment(raw)) {
        sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
        return true;
      }
      const rec = readTaskRecord(workspaceDir, raw);
      if (!rec) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      sendJson(
        res,
        200,
        {
          ok: true,
          task: rec,
          checkpoints: listTaskCheckpoints(rec),
          executionPlan: deriveExecutionPlanSteps(rec),
        },
        c,
      );
      return true;
    }
  }

  {
    const draftReviewMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/review$/);
    if (draftReviewMatch && req.method === "POST") {
      const raw = decodeURIComponent(draftReviewMatch[1] ?? "");
      if (!isSafeTaskIdSegment(raw)) {
        sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
        return true;
      }
      let body;
      try {
        body = await parseJsonBodyZod(req, draftReviewPostSchema);
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJson(res, 400, { ok: false, error: "status must be approved, rejected, or modified" }, c);
          return true;
        }
        throw err;
      }
      const st = body.status;
      const draft = readDraft(workspaceDir, raw);
      if (!draft) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      const currentReviewStatus = draft.reviewStatus ?? "pending";
      if (body.expectedReviewStatus && body.expectedReviewStatus !== currentReviewStatus) {
        sendJson(
          res,
          409,
          {
            ok: false,
            error: "review_status_conflict",
            message: "草稿签批状态已变化，请刷新后再试。",
            draft,
          },
          c,
        );
        return true;
      }
      let approvedChecklistView: ReturnType<typeof buildChecklistView> | undefined;
      if (st === "approved") {
        const checklistBody = body as {
          checklistChecked?: Record<string, boolean>;
          bypassChecklist?: boolean;
        };
        const allowBypass =
          checklistBody.bypassChecklist === true &&
          (process.env.LAWMIND_ALLOW_CHECKLIST_BYPASS === "1" ||
            process.env.LAWMIND_ALLOW_CHECKLIST_BYPASS === "true" ||
            process.env.VITEST === "true");
        if (checklistBody.bypassChecklist === true && !allowBypass) {
          sendJson(
            res,
            403,
            {
              ok: false,
              error: "checklist_bypass_forbidden",
              message: "交付可靠模式下不可跳过律师必核清单。",
            },
            c,
          );
          return true;
        }
        if (!allowBypass) {
          const empty = buildChecklistView(draft.deliverableType, null);
          const view = buildChecklistView(draft.deliverableType, {
            specId: empty.spec.id,
            checked: checklistBody.checklistChecked ?? {},
          });
          try {
            assertChecklistCompleteForApprove(view);
          } catch (e) {
            const missing =
              e && typeof e === "object" && "missingRequiredIds" in e
                ? (e as { missingRequiredIds: string[] }).missingRequiredIds
                : view.missingRequiredIds;
            appendProductMetric(workspaceDir, {
              kind: "gate_failure",
              outcome: "checklist_incomplete",
              taskId: raw,
              deliverableType: draft.deliverableType,
              detail: missing.join(","),
            });
            sendJson(
              res,
              422,
              {
                ok: false,
                error: "checklist_incomplete",
                message: "请完成律师必核清单后再通过签批。",
                missingRequiredIds: missing,
                checklist: view,
              },
              c,
            );
            return true;
          }
          approvedChecklistView = view;
        } else if (allowBypass) {
          // Test / explicit bypass: still persist a complete checklist so export gates stay consistent.
          const empty = buildChecklistView(draft.deliverableType, null);
          approvedChecklistView = buildChecklistView(draft.deliverableType, {
            specId: empty.spec.id,
            checked: Object.fromEntries(empty.spec.items.map((i) => [i.id, true])),
          });
        }
      }
      const labels = parseReviewLabels(body.labels);
      const deferQueue = body.deferMemoryWrites === true;
      const lawMindRootForReview = resolveLawMindRoot(workspaceDir, envFile);
      const profileAssistantForEngine = body.profileAssistantId?.trim()
        ? body.profileAssistantId.trim()
        : DEFAULT_ASSISTANT_ID;
      if (!isSafeAssistantIdSegment(profileAssistantForEngine)) {
        sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
        return true;
      }
      const engine = getLawMindEngine(workspaceDir);
      let updated = await engine.review(draft, {
        status: st,
        note: body.note,
        actorId: resolveDesktopActorId(),
        assistantId: profileAssistantForEngine,
        ...(labels ? { labels } : {}),
        ...(deferQueue ? { deferMemoryWrites: true } : {}),
      });
      let contractRevisionAccumulatedId: string | undefined;
      let contractRevisionAccumulationWarning: string | undefined;
      if (st === "approved") {
        if (approvedChecklistView) {
          updated = {
            ...updated,
            verificationChecklist: {
              specId: approvedChecklistView.spec.id,
              checked: { ...approvedChecklistView.state.checked },
              updatedAt: new Date().toISOString(),
            },
          };
          persistDraft(workspaceDir, updated);
        }
        const acc = await applyContractRevisionAccumulationAfterApprovedReview(
          workspaceDir,
          updated,
          typeof body.note === "string" ? body.note : undefined,
        );
        updated = acc.draft;
        contractRevisionAccumulatedId = acc.revisionId;
        contractRevisionAccumulationWarning = acc.warning;
      }
      let profileLearningSkipped = false;
      let lawyerProfileLearningSkipped = false;
      if (body.appendToProfile === true && !deferQueue) {
        const note = typeof body.note === "string" ? body.note : undefined;
        const line = buildReviewProfileLine(raw, st, note);
        try {
          const ar = appendAssistantProfileMarkdown(lawMindRootForReview, profileAssistantForEngine, line);
          profileLearningSkipped = ar.skipped;
        } catch (e) {
          sendJson(res, 500, {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            draft: updated,
            profileAppendFailed: true,
          }, c);
          return true;
        }
      }
      if (body.appendToLawyerProfile === true && !deferQueue) {
        const note = typeof body.note === "string" ? body.note : undefined;
        const line = buildLawyerProfileReviewLearningLine(raw, st, note);
        try {
          const lr = await appendLawyerProfileLearning(workspaceDir, line, "review", {
            auditDir: path.join(workspaceDir, "audit"),
            auditTaskId: raw,
          });
          lawyerProfileLearningSkipped = lr.skipped;
        } catch (e) {
          sendJson(res, 500, {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            draft: updated,
            lawyerProfileAppendFailed: true,
          }, c);
          return true;
        }
      }
      await auditReviewGateSnapshot(workspaceDir, updated, "review", undefined, updated.reviewedBy);
      const matterWriteFailed = !isDeliverableReviewStampCurrent(workspaceDir, updated);
      ctx.sseBus?.emit({ type: "review:status", data: { taskId: raw, reviewStatus: updated.reviewStatus } });
      ctx.sseBus?.emit({ type: "task:update", data: { taskId: raw, reviewStatus: updated.reviewStatus } });
      sendJson(
        res,
        200,
        {
          ok: true,
          draft: updated,
          citationIntegrity: resolveDraftCitationIntegrity(workspaceDir, updated),
          executionState: deriveReviewExecutionState(updated),
          gateDecisions: deriveReviewGateDecisions(updated),
          profileLearningSkipped,
          lawyerProfileLearningSkipped,
          matterWriteFailed,
          ...(contractRevisionAccumulatedId ? { contractRevisionAccumulatedId } : {}),
          ...(contractRevisionAccumulationWarning
            ? { contractRevisionAccumulationWarning }
            : {}),
        },
        c,
      );
      return true;
    }

    const draftRenderTrackedMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/render-tracked$/);
    if (draftRenderTrackedMatch && req.method === "POST") {
      const raw = decodeURIComponent(draftRenderTrackedMatch[1] ?? "");
      if (!isSafeTaskIdSegment(raw)) {
        sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
        return true;
      }
      const draft = readDraft(workspaceDir, raw);
      if (!draft) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      const strictParam = url.searchParams.get("strict")?.trim().toLowerCase();
      const strict = strictParam !== "false" && strictParam !== "0";
      if (strict) {
        const acceptance = validateDraftAgainstSpec(draft);
        if (!acceptance.ready) {
          sendJson(res, 422, { ok: false, error: "acceptance_gate_blocked", acceptance }, c);
          return true;
        }
      }
      let renderTrackedBody: { includeProvenance?: boolean } = {};
      try {
        const body = await parseJsonBodyZod(req, draftRenderPostSchema);
        renderTrackedBody = { includeProvenance: body.includeProvenance };
      } catch (e) {
        if (isInvalidRequestBodyError(e)) {
          sendJson(res, 400, { ok: false, error: "invalid request" }, c);
          return true;
        }
        throw e;
      }
      const { readRedlineProposal } = await import("../../../src/lawmind/drafts/redline-proposal.js");
      const { renderDocxWithTrackedChanges } = await import(
        "../../../src/lawmind/artifacts/render-docx-tracked.js"
      );
      const { planTrackedWordDelivery } = await import(
        "../../../src/lawmind/artifacts/word-revision-delivery.js"
      );
      const proposal = readRedlineProposal(workspaceDir, raw);
      const proposals = (proposal?.hunks ?? []).filter((h) => h.status !== "rejected");
      const planned = planTrackedWordDelivery({
        workspaceDir,
        baselineRel: draft.contractEdit?.baselineRelativePath,
        baselineRoot: draft.contractEdit?.baselineRoot,
        matterId: draft.matterId,
        fallbackBasename: `${draft.title?.trim() || "合同"}.docx`,
      });
      const preferContractReview =
        (draft.deliverableType ?? "").startsWith("contract.") || Boolean(draft.contractEdit);
      const result = await renderDocxWithTrackedChanges({
        draft,
        outputDir: planned.outDir,
        proposals,
        workspaceDir,
        templateVariant: preferContractReview ? "contractReview" : undefined,
        includeProvenance: renderTrackedBody.includeProvenance,
        outputFileName: planned.outputFileName,
      });
      sendJson(
        res,
        result.ok ? 200 : 400,
        result.ok
          ? {
              ok: true,
              outputPath: result.outputPath,
              mode: result.mode,
              baselineSource: result.baselineSource,
            }
          : { ok: false, error: result.error, code: result.code },
        c,
      );
      return true;
    }

    const draftRenderMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/render$/);
    if (draftRenderMatch && req.method === "POST") {
      const raw = decodeURIComponent(draftRenderMatch[1] ?? "");
      if (!isSafeTaskIdSegment(raw)) {
        sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
        return true;
      }
      const draft = readDraft(workspaceDir, raw);
      if (!draft) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      let templateIdOverride: string | undefined;
      let includeProvenance: boolean | undefined;
      let renderOutputPath: string | undefined;
      let renderProjectDir: string | undefined;
      try {
        const body = await parseJsonBodyZod(req, draftRenderPostSchema);
        if (body.templateId) {
          templateIdOverride = body.templateId;
        }
        includeProvenance = body.includeProvenance;
        renderOutputPath = body.outputPath;
        renderProjectDir = safeOptionalProjectDir(body.projectDir);
      } catch (e) {
        if (isInvalidRequestBodyError(e)) {
          sendJson(res, 400, { ok: false, error: "invalid request" }, c);
          return true;
        }
        const status = isLawMindHttpError(e) ? e.status : 400;
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, status, { ok: false, error: msg }, c);
        return true;
      }
      // Acceptance Gate (Deliverable-First Architecture).
      // 默认 strict（未就绪即拦截）。?strict=false 仅在 env 门
      // LAWMIND_ALLOW_RENDER_GATE_BYPASS 显式开启时生效，且每次生效落
      // gate_decision=bypass 审计；否则忽略该参数按 strict 执行。
      const strictParam = url.searchParams.get("strict")?.trim().toLowerCase();
      const bypassRequested = strictParam === "false" || strictParam === "0";
      const bypass = bypassRequested && isRenderGateBypassAllowed();
      const strict = !bypass;
      if (bypass) {
        await auditReviewGateSnapshot(
          workspaceDir,
          draft,
          "render_bypass",
          validateDraftAgainstSpec(draft),
          undefined,
          { gateDecision: "bypass", via: "strict_query_param" },
        );
      }
      if (strict) {
        const acceptance = validateDraftAgainstSpec(draft);
        if (!acceptance.ready) {
          const executionState = deriveReviewExecutionState(draft, acceptance);
          const gateDecisions = deriveReviewGateDecisions(draft, acceptance);
          await auditReviewGateSnapshot(workspaceDir, draft, "render_blocked", acceptance);
          sendJson(
            res,
            422,
            {
              ok: false,
              error: "acceptance_gate_blocked",
              message:
                "草稿未通过出稿检查，存在阻塞项；请补齐缺失章节或回答待确认问题后再导出。",
              acceptance,
              executionState,
              gateDecisions,
            },
            c,
          );
          return true;
        }
        const checklistAtExport = buildChecklistView(
          draft.deliverableType,
          draft.verificationChecklist ?? null,
        );
        if (!checklistAtExport.complete) {
          appendProductMetric(workspaceDir, {
            kind: "gate_failure",
            outcome: "checklist_incomplete",
            taskId: raw,
            deliverableType: draft.deliverableType,
            detail: `export:${checklistAtExport.missingRequiredIds.join(",")}`,
          });
          sendJson(
            res,
            422,
            {
              ok: false,
              error: "checklist_incomplete",
              message: "导出被拦截：出稿检查未齐，请在改稿页补齐后再导出。",
              missingRequiredIds: checklistAtExport.missingRequiredIds,
              checklist: checklistAtExport,
            },
            c,
          );
          return true;
        }
      }
      const engine = getLawMindEngine(workspaceDir, renderProjectDir);
      const policyForEdition: LawMindWorkspacePolicy | null = ctx.policy.loaded
        ? (ctx.policy.policy as LawMindWorkspacePolicy)
        : null;
      const edition = resolveEdition({ policy: policyForEdition });
      const citationMode = resolveCitationMode(policyForEdition, edition.edition);
      const result = await engine.render(draft, {
        templateIdOverride,
        citationMode,
        citationGateStrict: edition.features.citationGateStrict,
        strictGates: strict,
        includeProvenance,
        projectDir: renderProjectDir,
        outputPath: renderOutputPath,
      });
      const refreshed = readDraft(workspaceDir, raw);
      const citationIntegrity = refreshed
        ? resolveDraftCitationIntegrity(workspaceDir, refreshed)
        : undefined;
      const acceptanceAfter = refreshed ? validateDraftAgainstSpec(refreshed) : undefined;
      const executionState = refreshed ? deriveReviewExecutionState(refreshed, acceptanceAfter) : undefined;
      const gateDecisions = refreshed ? deriveReviewGateDecisions(refreshed, acceptanceAfter) : undefined;
      if (refreshed) {
        await auditReviewGateSnapshot(workspaceDir, refreshed, "render", acceptanceAfter);
      }
      sendJson(
        res,
        result.ok ? 200 : 400,
        {
          // `ok` 由 `...result` 提供（引擎 render 的结果对象带 ok）。
          // 此前写成 `{ ok: result.ok, ...result }`：TS2783 指出会被静默覆盖成同一个值，
          // 值相同所以无害——但那是巧合，不是设计。以 `result` 为唯一真相源。
          ...result,
          ...(citationIntegrity ? { citationIntegrity } : {}),
          ...(acceptanceAfter ? { acceptance: acceptanceAfter } : {}),
          ...(executionState ? { executionState } : {}),
          ...(gateDecisions ? { gateDecisions } : {}),
        },
        c,
      );
      return true;
    }

    const draftReopenMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/reopen-review$/);
    if (draftReopenMatch && req.method === "POST") {
      const raw = decodeURIComponent(draftReopenMatch[1] ?? "");
      if (!isSafeTaskIdSegment(raw)) {
        sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
        return true;
      }
      const engine = getLawMindEngine(workspaceDir);
      const updated = await engine.reopenDraftReview(raw, { actorId: resolveDesktopActorId() });
      if (!updated) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      const acceptance = validateDraftAgainstSpec(updated);
      const executionState = deriveReviewExecutionState(updated, acceptance);
      const gateDecisions = deriveReviewGateDecisions(updated, acceptance);
      await auditReviewGateSnapshot(workspaceDir, updated, "reopen_review", acceptance);
      ctx.sseBus?.emit({ type: "review:status", data: { taskId: raw, reviewStatus: updated.reviewStatus } });
      ctx.sseBus?.emit({ type: "task:update", data: { taskId: raw, reviewStatus: updated.reviewStatus } });
      sendJson(
        res,
        200,
        {
          ok: true,
          draft: updated,
          citationIntegrity: resolveDraftCitationIntegrity(workspaceDir, updated),
          acceptance,
          executionState,
          gateDecisions,
        },
        c,
      );
      return true;
    }

    // 审查表（review.table）sidecar：读 / 改 / 导出 xlsx。
    const draftTableXlsxMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/table\.xlsx$/);
    if (draftTableXlsxMatch && req.method === "GET") {
      const raw = decodeURIComponent(draftTableXlsxMatch[1] ?? "");
      if (!isSafeTaskIdSegment(raw)) {
        sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
        return true;
      }
      const { readReviewTable, reviewTableProvenanceXlsxRows, reviewTableToXlsxRows } =
        await import("../../../src/lawmind/deliverables/review-table.js");
      const table = readReviewTable(workspaceDir, raw);
      if (!table) {
        sendJson(res, 404, { ok: false, error: "table_not_found" }, c);
        return true;
      }
      const { writeXlsxWorkbook } = await import(
        "../../../src/lawmind/agent/tools/legal/xlsx-workbook.js"
      );
      const os = await import("node:os");
      const fsTmp = await import("node:fs/promises");
      const tmpFile = path.join(os.tmpdir(), `lawmind-review-table-${raw}.xlsx`);
      await writeXlsxWorkbook(tmpFile, [
        { name: table.title.slice(0, 31) || "审查表", rows: reviewTableToXlsxRows(table) },
        { name: "逐格出处", rows: reviewTableProvenanceXlsxRows(table) },
      ]);
      const buf = await fsTmp.readFile(tmpFile);
      await fsTmp.rm(tmpFile, { force: true });
        res.writeHead(200, {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="review-table-${encodeURIComponent(raw)}.xlsx"`,
          // ⚠️ 与诊断包同一个坑：**手写 writeHead 必须带 `...c`**（CORS 头）。
          // 渲染层对本服务是跨源；漏了它浏览器会直接拦掉响应（`Failed to fetch`，
          // 几毫秒内失败、与超时无关），而服务端日志里一切正常。
          ...c,
        });
      res.end(buf);
      return true;
    }

    const draftTableMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/table$/);
    if (draftTableMatch && req.method === "GET") {
      const raw = decodeURIComponent(draftTableMatch[1] ?? "");
      if (!isSafeTaskIdSegment(raw)) {
        sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
        return true;
      }
      const { readReviewTable } = await import("../../../src/lawmind/deliverables/review-table.js");
      const table = readReviewTable(workspaceDir, raw);
      if (!table) {
        sendJson(res, 404, { ok: false, error: "table_not_found" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, table }, c);
      return true;
    }
    if (draftTableMatch && req.method === "PATCH") {
      const raw = decodeURIComponent(draftTableMatch[1] ?? "");
      if (!isSafeTaskIdSegment(raw)) {
        sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
        return true;
      }
      const draft = readDraft(workspaceDir, raw);
      if (!draft) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      const reviewStatus = draft.reviewStatus ?? "pending";
      if (reviewStatus !== "pending" && reviewStatus !== "modified") {
        sendJson(res, 409, { ok: false, error: "draft_not_editable" }, c);
        return true;
      }
      let patchBody: { columns?: unknown; rows?: unknown };
      try {
        const { z } = await import("zod");
        patchBody = await parseJsonBodyZod(
          req,
          z.object({ columns: z.array(z.unknown()).optional(), rows: z.array(z.unknown()).optional() }),
        );
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid body" }, c);
        return true;
      }
      const {
        mergeLawyerReviewRows,
        readReviewTable: readTable,
        writeReviewTable,
        reviewTableToMarkdown,
      } = await import("../../../src/lawmind/deliverables/review-table.js");
      const table = readTable(workspaceDir, raw);
      if (!table) {
        sendJson(res, 404, { ok: false, error: "table_not_found" }, c);
        return true;
      }
      // 律师编辑：列与行整体替换（桌面表格编辑器一次提交整表）。
      const columns = Array.isArray(patchBody.columns)
        ? (patchBody.columns as Array<{ key?: unknown; label?: unknown }>)
            .filter((col) => typeof col.key === "string" && col.key.trim())
            .map((col) => ({ key: String(col.key).trim(), label: String(col.label ?? col.key).trim() }))
        : table.columns;
      const rows = Array.isArray(patchBody.rows)
        ? (patchBody.rows as Array<{
            id?: unknown;
            cells?: unknown;
            group?: unknown;
            source?: unknown;
            review?: unknown;
          }>).map((row) => {
            const reviewRaw =
              row.review && typeof row.review === "object" && !Array.isArray(row.review)
                ? (row.review as { locked?: unknown; reviewed?: unknown })
                : undefined;
            const review =
              reviewRaw && (reviewRaw.locked === true || reviewRaw.locked === false || reviewRaw.reviewed === true)
                ? {
                    ...(reviewRaw.reviewed === true ? { reviewed: true } : {}),
                    ...(reviewRaw.locked === true || reviewRaw.locked === false
                      ? { locked:  reviewRaw.locked }
                      : {}),
                  }
                : undefined;
            return {
              id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `row-${Math.random().toString(36).slice(2, 10)}`,
              cells:
                row.cells && typeof row.cells === "object" && !Array.isArray(row.cells)
                  ? Object.fromEntries(
                      Object.entries(row.cells as Record<string, unknown>).map(([k, v]) => [
                        k,
                        typeof v === "string" ? v : v == null ? "" : JSON.stringify(v),
                      ]),
                    )
                  : {},
              ...(typeof row.group === "string" && row.group.trim() ? { group: row.group.trim() } : {}),
              ...(typeof row.source === "string" && row.source.trim() ? { source: row.source.trim() } : {}),
              ...(review ? { review } : {}),
            };
          })
        : table.rows;
      const mergedRows = Array.isArray(patchBody.rows) ? mergeLawyerReviewRows(table.rows, rows) : rows;
      const next = { ...table, columns, rows: mergedRows };
      writeReviewTable(workspaceDir, next);
      // 同步草稿「审查表」栏目预览，与 agent 工具同一真相源。
      const markdown = reviewTableToMarkdown(next);
      const idx = draft.sections.findIndex((s) => /审查表|明细|表格/.test(s.heading));
      const sections = [...draft.sections];
      if (idx >= 0) {
        sections[idx] = { ...sections[idx], body: markdown };
      } else {
        sections.push({ heading: "审查表", body: markdown, citations: [] });
      }
      persistDraft(workspaceDir, { ...draft, sections });
      sendJson(res, 200, { ok: true, table: next }, c);
      return true;
    }

    const draftContentMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/content$/);
    if (draftContentMatch && req.method === "PATCH") {
      const raw = decodeURIComponent(draftContentMatch[1] ?? "");
      if (!isSafeTaskIdSegment(raw)) {
        sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
        return true;
      }
      const draft = readDraft(workspaceDir, raw);
      if (!draft) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      const reviewStatus = draft.reviewStatus ?? "pending";
      if (reviewStatus !== "pending" && reviewStatus !== "modified") {
        sendJson(res, 409, { ok: false, error: "draft_not_editable" }, c);
        return true;
      }
      let patchBody;
      try {
        patchBody = await parseJsonBodyZod(req, draftContentPatchBodySchema);
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJson(res, 400, { ok: false, error: mapDraftContentPatchError(err) }, c);
          return true;
        }
        throw err;
      }
      const patch = toDraftContentPatch(patchBody);
      const actorId = resolveDesktopActorId();
      const sectionsBefore = draft.sections.map((s) => ({ heading: s.heading, body: s.body }));
      const nextDraft: ArtifactDraft = {
        ...draft,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.sections !== undefined
          ? { sections: patchSectionsWithLawyerEditProvenance(draft.sections, patch.sections, actorId) }
          : {}),
      };
      const auditDir = path.join(workspaceDir, "audit");
      await emit(auditDir, {
        taskId: raw,
        kind: "draft.content_edited",
        actor: "lawyer",
        actorId,
        detail: JSON.stringify({
          title: nextDraft.title,
          sectionCount: nextDraft.sections.length,
        }),
      });
      const storedDraftPath = persistDraft(workspaceDir, nextDraft);
      updateTaskRecord(workspaceDir, raw, {
        title: nextDraft.title,
        draftPath: storedDraftPath,
      });
      // 改稿 delta → pending 口径候选（不静默写画像；律师在设置里确认后才落盘）。
      // 同时把 (改前, 改后) 完整对照存进改稿范例库（素材通道，供后续检索注入）。
      //
      // 另外记录**改稿幅度**（`source: "lawyer_edit"`）：这是律师**直接改稿**的路径，
      // 也是预注册协议第三条判据「改稿幅度中位」**应当**测量的对象
      // （它要测的是律师的编辑负担，不是助手改了多少）。
      // 此前只有 `draft-revision`（提交给助手后台修订）那条路会产出幅度样本，
      // 于是该判据在"律师自己改稿"这一最常见路径上**完全没有数据**。
      try {
        const { draftPlainText, recordRewriteAmplitude } = await import(
          "../../../src/lawmind/learning/rewrite-amplitude.js"
        );
        const beforeText = draftPlainText(draft);
        const afterText = draftPlainText(nextDraft);
        // 只记**真的改了**的那次保存。
        //
        // 这里以前是 `if (beforeText || afterText)` —— 对真实稿子恒真，于是「打开就存」
        // 这类**空保存**也会写一条 `absCharDelta: 0` 的样本。判据三是中位数，注入零点
        // 会把结论系统性地拉向「律师几乎没改」的乐观方向（协议预注册的口径被稀释）。
        //
        // 用「文本变了」而不是「delta 为 0」当判据：等长替换（如「定金」→「订金」）
        // 是真实编辑，`absCharDelta` 恰好为 0，不能丢。
        if (beforeText !== afterText) {
          recordRewriteAmplitude({
            workspaceDir,
            // 律师直接改稿没有"哪个助手"——用一个显式标识，避免与助手修订混进同一口径。
            assistantId: actorId,
            taskId: raw,
            ...(nextDraft.matterId ? { matterId: nextDraft.matterId } : {}),
            beforeText,
            afterText,
            source: "lawyer_edit",
          });
        }
      } catch {
        /* 幅度指标失败不阻断保存 */
      }
      try {
        const { captureDraftEditLearning } = await import(
          "../../../src/lawmind/learning/draft-edit-learning.js"
        );
        await captureDraftEditLearning({
          workspaceDir,
          auditDir,
          taskId: raw,
          before: sectionsBefore,
          after: nextDraft.sections.map((s) => ({ heading: s.heading, body: s.body })),
          ...(nextDraft.deliverableType ? { deliverableType: nextDraft.deliverableType } : {}),
          ...(nextDraft.matterId ? { matterId: nextDraft.matterId } : {}),
          // 注意：这里**不传** `reviewNote`。`captureDraftEditLearning` 把它描述为
          // 「为什么改」的唯一线索，但本端点（`/content` PATCH）从来拿不到它——
          // schema（`draftContentPatchBodySchema`）只声明 title/summary/sections，
          // `toDraftContentPatch` 也不搬运 note，客户端保存时同样不发。
          // 此前这里写着 `...(typeof patch.note === "string" ? { reviewNote: patch.note } : {})`：
          // 类型上不成立（该字段不在 patch 类型里），运行时也永远为 undefined——
          // 是一段**读起来像「说明已记录」的死代码**。已删除，不做猜测性补线：
          // 要接就把 note 补进 schema + 客户端保存面，那是产品决定，不是类型修复。
        });
      } catch {
        // 学习捕获失败不阻断正文保存。
      }
      if (nextDraft.matterId) {
        try {
          const tr = readTaskRecord(workspaceDir, raw);
          linkDraftToDeliverable(workspaceDir, nextDraft, tr ?? undefined);
        } catch {
          // 写侧失败不阻断正文保存
        }
      }
      const acceptance = validateDraftAgainstSpec(nextDraft);
      const executionState = deriveReviewExecutionState(nextDraft, acceptance);
      const gateDecisions = deriveReviewGateDecisions(nextDraft, acceptance);
      await auditReviewGateSnapshot(workspaceDir, nextDraft, "review", acceptance, actorId);
      ctx.sseBus?.emit({ type: "task:update", data: { taskId: raw, reviewStatus: nextDraft.reviewStatus } });
      sendJson(
        res,
        200,
        {
          ok: true,
          draft: nextDraft,
          citationIntegrity: resolveDraftCitationIntegrity(workspaceDir, nextDraft),
          acceptance,
          executionState,
          gateDecisions,
        },
        c,
      );
      return true;
    }

    const draftDetailMatch = pathname.match(/^\/api\/drafts\/([^/]+)$/);
    if (draftDetailMatch && req.method === "DELETE") {
      const raw = decodeURIComponent(draftDetailMatch[1] ?? "");
      if (!isSafeTaskIdSegment(raw)) {
        sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
        return true;
      }
      const draft = readDraft(workspaceDir, raw);
      if (!draft) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      // 状态门禁：已签批的交付稿必须保留归档（防止误删已通过签批的交付）。
      // 仅 pending / rejected / modified 可删；approved 需先恢复待审核。
      const reviewStatus = draft.reviewStatus ?? "pending";
      if (reviewStatus !== "pending" && reviewStatus !== "rejected" && reviewStatus !== "modified") {
        sendJson(
          res,
          409,
          {
            ok: false,
            error: "draft_not_deletable",
            message: `草稿当前状态为「${reviewStatus}」，不能删除。已签批的交付稿应保留归档；如确需删除，请先在审核台恢复为待审核。`,
            reviewStatus,
          },
          c,
        );
        return true;
      }
      const deletedDraft = deleteDraft(workspaceDir, raw);
      const deletedTask = deleteTaskRecord(workspaceDir, raw);
      if (!deletedDraft && !deletedTask) {
        sendJson(res, 500, { ok: false, error: "delete_failed" }, c);
        return true;
      }
      ctx.sseBus?.emit({ type: "task:update", data: { taskId: raw, deleted: true } });
      sendJson(res, 200, { ok: true, taskId: raw, deletedDraft, deletedTask }, c);
      return true;
    }

    if (draftDetailMatch && req.method === "GET") {
      const raw = decodeURIComponent(draftDetailMatch[1] ?? "");
      if (!isSafeTaskIdSegment(raw)) {
        sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
        return true;
      }
      const draft = readDraft(workspaceDir, raw);
      if (!draft) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      const citationIntegrity = resolveDraftCitationIntegrity(workspaceDir, draft);
      const guardian = lawyerGuardianViewFromSidecar(workspaceDir, raw);
      const graph = readReasoningSnapshot(workspaceDir, raw);
      const reasoningMarkdown = graph ? serializeLegalReasoningGraph(graph) : null;
      const taskRec = readTaskRecord(workspaceDir, raw);
      const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
      const engineMem = await loadMemoryContext(workspaceDir, { matterId: draft.matterId });
      const memorySources = await buildAgentMemorySourceReport(workspaceDir, {
        matterId: draft.matterId,
        assistantId: taskRec?.assistantId,
        lawMindRoot,
        engineMemory: toEngineClientMemorySnapshot(engineMem),
      });
      const acceptance = validateDraftAgainstSpec(draft);
      const clauses = resolveClauseGraphForDraft(workspaceDir, draft);
      const scaffold = describeDraftScaffold(draft);
      const reasoningReport = validateReasoningForDraft(draft, graph ?? undefined);
      const executionState = deriveReviewExecutionState(draft, acceptance);
      const gateDecisions = deriveReviewGateDecisions(draft, acceptance);
      const auditDir = path.join(workspaceDir, "audit");
      await maybeEmitFirstrunAcceptanceReady(
        workspaceDir,
        draft,
        acceptance.ready,
        auditDir,
        resolveDesktopActorId(),
      );
      sendJson(
        res,
        200,
        {
          ok: true,
          draft,
          citationIntegrity,
          guardian: guardian ?? null,
          reasoningMarkdown,
          reasoningReport,
          memorySources,
          acceptance,
          clauses,
          scaffold,
          executionState,
          gateDecisions,
        },
        c,
      );
      return true;
    }
  }

  return false;
}
