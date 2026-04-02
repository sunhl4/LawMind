import path from "node:path";
import { buildAgentMemorySourceReport } from "../../../src/lawmind/memory/index.js";
import {
  adoptLearningSuggestion,
  dismissLearningSuggestion,
  listLearningSuggestions,
} from "../../../src/lawmind/learning/suggestion-queue.js";
import {
  appendAssistantProfileMarkdown,
  buildReviewProfileLine,
} from "../../../src/lawmind/assistants/profile-md.js";
import { resolveLawMindRoot, DEFAULT_ASSISTANT_ID } from "../../../src/lawmind/assistants/store.js";
import {
  appendLawyerProfileLearning,
  buildLawyerProfileReviewLearningLine,
} from "../../../src/lawmind/memory/index.js";
import {
  readDraft,
  readReasoningSnapshot,
  resolveDraftCitationIntegrity,
} from "../../../src/lawmind/drafts/index.js";
import { serializeLegalReasoningGraph } from "../../../src/lawmind/reasoning/index.js";
import { parseReviewLabels } from "../../../src/lawmind/review-labels.js";
import { listTaskCheckpoints, readTaskRecord } from "../../../src/lawmind/tasks/index.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import {
  getLawMindEngine,
  readJsonBody,
  resolveDesktopActorId,
  sendJson,
} from "./lawmind-server-helpers.js";
import { isSafeAssistantIdSegment } from "./safe-assistant-id.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";

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

  if (pathname === "/api/lawyer-profile/learning" && req.method === "POST") {
    const body = (await readJsonBody(req)) as { note?: string; source?: string };
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) {
      sendJson(res, 400, { ok: false, error: "note required" }, c);
      return true;
    }
    const src = body.source?.trim().toLowerCase() === "manual" ? "manual" : "review";
    try {
      await appendLawyerProfileLearning(workspaceDir, note, src);
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
      return true;
    }
    sendJson(res, 200, { ok: true }, c);
    return true;
  }

  if (pathname === "/api/assistants/profile/learning" && req.method === "POST") {
    const body = (await readJsonBody(req)) as { assistantId?: string; note?: string };
    const assistantId = typeof body.assistantId === "string" ? body.assistantId.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!assistantId) {
      sendJson(res, 400, { ok: false, error: "assistantId required" }, c);
      return true;
    }
    if (!note) {
      sendJson(res, 400, { ok: false, error: "note required" }, c);
      return true;
    }
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
      sendJson(res, 200, { ok: true, task: rec, checkpoints: listTaskCheckpoints(rec) }, c);
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
      const body = (await readJsonBody(req)) as {
        status?: string;
        note?: string;
        appendToProfile?: boolean;
        appendToLawyerProfile?: boolean;
        profileAssistantId?: string;
        labels?: unknown;
        deferMemoryWrites?: boolean;
      };
      const st = body.status?.trim().toLowerCase();
      if (st !== "approved" && st !== "rejected" && st !== "modified") {
        sendJson(res, 400, { ok: false, error: "status must be approved, rejected, or modified" }, c);
        return true;
      }
      const draft = readDraft(workspaceDir, raw);
      if (!draft) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      const labels = parseReviewLabels(body.labels);
      const deferQueue = body.deferMemoryWrites === true;
      const lawMindRootForReview = resolveLawMindRoot(workspaceDir, envFile);
      const profileAssistantForEngine =
        typeof body.profileAssistantId === "string" && body.profileAssistantId.trim()
          ? body.profileAssistantId.trim()
          : DEFAULT_ASSISTANT_ID;
      if (!isSafeAssistantIdSegment(profileAssistantForEngine)) {
        sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
        return true;
      }
      const engine = getLawMindEngine(workspaceDir);
      const updated = await engine.review(draft, {
        status: st,
        note: typeof body.note === "string" ? body.note : undefined,
        actorId: resolveDesktopActorId(),
        assistantId: profileAssistantForEngine,
        ...(labels ? { labels } : {}),
        ...(deferQueue ? { deferMemoryWrites: true } : {}),
      });
      if (body.appendToProfile === true && !deferQueue) {
        const note = typeof body.note === "string" ? body.note : undefined;
        const line = buildReviewProfileLine(raw, st, note);
        try {
          appendAssistantProfileMarkdown(lawMindRootForReview, profileAssistantForEngine, line);
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
          await appendLawyerProfileLearning(workspaceDir, line, "review");
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
      sendJson(
        res,
        200,
        {
          ok: true,
          draft: updated,
          citationIntegrity: resolveDraftCitationIntegrity(workspaceDir, updated),
        },
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
      const engine = getLawMindEngine(workspaceDir);
      const result = await engine.render(draft);
      const refreshed = readDraft(workspaceDir, raw);
      const citationIntegrity = refreshed
        ? resolveDraftCitationIntegrity(workspaceDir, refreshed)
        : undefined;
      sendJson(
        res,
        result.ok ? 200 : 400,
        {
          ok: result.ok,
          ...result,
          ...(citationIntegrity ? { citationIntegrity } : {}),
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
      const memorySources = await buildAgentMemorySourceReport(workspaceDir, {
        matterId: draft.matterId,
        assistantId: taskRec?.assistantId,
        lawMindRoot,
      });
      sendJson(
        res,
        200,
        {
          ok: true,
          draft,
          citationIntegrity,
          reasoningMarkdown,
          memorySources,
        },
        c,
      );
      return true;
    }
  }

  return false;
}
