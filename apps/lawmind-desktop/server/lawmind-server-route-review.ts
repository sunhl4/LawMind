import path from "node:path";
import {
  assertChecklistCompleteForApprove,
  buildChecklistView,
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
  persistDraft,
  readDraft,
  readReasoningSnapshot,
  resolveDraftCitationIntegrity,
} from "../../../src/lawmind/drafts/index.js";
import { linkDraftToDeliverable } from "../../../src/lawmind/application/services/deliverable-service.js";
import { emit } from "../../../src/lawmind/audit/index.js";
import type { ArtifactSection, ArtifactDraft } from "../../../src/lawmind/types.js";
import { applyContractRevisionAccumulationAfterApprovedReview } from "../../../src/lawmind/learning/contract-revision-on-review-approved.js";
import { maybeEmitFirstrunAcceptanceReady } from "../../../src/lawmind/onboarding/firstrun-state.js";
import { serializeLegalReasoningGraph } from "../../../src/lawmind/reasoning/index.js";
import { parseReviewLabels } from "../../../src/lawmind/review-labels.js";
import { deriveExecutionPlanSteps, listTaskCheckpoints, readTaskRecord, updateTaskRecord } from "../../../src/lawmind/tasks/index.js";
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
      detail: "验收门禁未通过，暂不可渲染。",
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
  sections?: Array<{ heading: string; body: string; citations?: string[] }>;
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
    }));
  }
  return patch;
}

async function auditReviewGateSnapshot(
  workspaceDir: string,
  draft: ArtifactDraft,
  source: PlatformGateAuditSource,
  acceptance?: AcceptanceReport,
  actorId?: string,
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
    context: { reviewStatus: draft.reviewStatus ?? "pending" },
  });
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
      if (st === "approved") {
        const checklistBody = body as {
          checklistChecked?: Record<string, boolean>;
          bypassChecklist?: boolean;
        };
        if (checklistBody.bypassChecklist !== true) {
          const view = buildChecklistView(draft.deliverableType, {
            specId: "",
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
      const { readRedlineProposal } = await import("../../../src/lawmind/drafts/redline-proposal.js");
      const { renderDocxWithTrackedChanges } = await import(
        "../../../src/lawmind/artifacts/render-docx-tracked.js"
      );
      const proposal = readRedlineProposal(workspaceDir, raw);
      const proposals = proposal?.hunks ?? [];
      const outDir = path.join(workspaceDir, "artifacts");
      const result = await renderDocxWithTrackedChanges({
        draft,
        outputDir: outDir,
        proposals,
      });
      sendJson(
        res,
        result.ok ? 200 : 400,
        result.ok
          ? { ok: true, outputPath: result.outputPath, mode: result.mode }
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
      try {
        const body = await parseJsonBodyZod(req, draftRenderPostSchema);
        if (body.templateId) {
          templateIdOverride = body.templateId;
        }
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
      // Default = strict (block render if not ready). Caller may opt out via ?strict=false.
      const strictParam = url.searchParams.get("strict")?.trim().toLowerCase();
      const strict = strictParam !== "false" && strictParam !== "0";
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
                "草稿未通过验收门禁，存在阻塞项；请补齐缺失章节或回答待确认问题，或使用 ?strict=false 临时绕过（不推荐）。",
              acceptance,
              executionState,
              gateDecisions,
            },
            c,
          );
          return true;
        }
      }
      const engine = getLawMindEngine(workspaceDir);
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
          ok: result.ok,
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
      const nextDraft: ArtifactDraft = {
        ...draft,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.sections !== undefined ? { sections: patch.sections } : {}),
      };
      const actorId = resolveDesktopActorId();
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
          reasoningMarkdown,
          reasoningReport,
          memorySources,
          acceptance,
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
