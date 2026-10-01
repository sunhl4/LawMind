import { listSessions } from "../../../src/lawmind/agent/session.js";
import { listAssistantPresets } from "../../../src/lawmind/agent/assistant-presets.js";
import {
  notePresence,
  presenceFromWork,
  type AssistantPresenceView,
} from "../../../src/lawmind/assistants/presence.js";
import { searchAssistantRoster } from "../../../src/lawmind/assistants/roster-search.js";
import { exportAssistantShare } from "../../../src/lawmind/assistants/share-template.js";
import { listAutomations } from "../../../src/lawmind/platform/lawyer-automations.js";
import { listLawyerWorks } from "../../../src/lawmind/work/store.js";
import { listAssistantProfileSections } from "../../../src/lawmind/assistants/profile-md.js";
import { assertCanCreateAssistant } from "../../../src/lawmind/assistants/roster.js";
import {
  deleteAssistant,
  duplicateAssistant,
  getAssistantById,
  loadAssistantProfiles,
  loadAssistantStats,
  resolveLawMindRoot,
  upsertAssistant,
} from "../../../src/lawmind/assistants/store.js";
import { isFeatureEnabled } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import {
  assistantDuplicateSchema,
  assistantShareSchema,
  assistantUpsertSchema,
} from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { isSafeAssistantIdSegment } from "./safe-assistant-id.js";

function allowMultiAssistantRoster(ctx: LawmindRouteContext["ctx"]): boolean {
  const policy = ctx.policy.loaded ? (ctx.policy.policy as LawMindWorkspacePolicy) : null;
  return isFeatureEnabled("multiAssistantRoster", { policy });
}

function guardCreateAssistant(
  lawMindRoot: string,
  ctx: LawmindRouteContext["ctx"],
  res: LawmindRouteContext["res"],
  c: LawmindRouteContext["c"],
  existingId?: string,
): boolean {
  const profiles = loadAssistantProfiles(lawMindRoot);
  const updating = Boolean(existingId?.trim() && profiles.some((p) => p.assistantId === existingId));
  if (updating) {
    return false;
  }
  try {
    assertCanCreateAssistant(profiles.length, allowMultiAssistantRoster(ctx));
    return false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, 400, { ok: false, error: msg }, c);
    return true;
  }
}

export async function handleAssistantRoutes({
  ctx,
  pathname,
  url,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir, envFile } = ctx;

  if (pathname === "/api/assistant-presets" && req.method === "GET") {
    sendJson(res, 200, { ok: true, presets: listAssistantPresets() }, c);
    return true;
  }

  if (pathname === "/api/assistants" && req.method === "GET") {
    const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
    const profiles = loadAssistantProfiles(lawMindRoot);
    const stats = loadAssistantStats(lawMindRoot);
    const presence = presenceByAssistant(workspaceDir);
    const assistants = profiles.map((profile) => ({
      ...profile,
      presence: presence.get(profile.assistantId)?.presence ?? "idle",
      stats: stats[profile.assistantId] ?? {
        lastUsedAt: "",
        turnCount: 0,
        sessionCount: 0,
      },
    }));
    sendJson(res, 200, { ok: true, assistants, presets: listAssistantPresets() }, c);
    return true;
  }

  if (pathname === "/api/assistants/roster-search" && req.method === "GET") {
    const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const names = new Map(
      loadAssistantProfiles(lawMindRoot).map((profile) => [profile.assistantId, profile.displayName]),
    );
    sendJson(res, 200, { ok: true, groups: searchAssistantRoster(workspaceDir, query, names) }, c);
    return true;
  }

  {
    const profileSec = pathname.match(/^\/api\/assistants\/([^/]+)\/profile-sections$/);
    if (profileSec && req.method === "GET") {
      const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
      const id = decodeURIComponent(profileSec[1] ?? "");
      try {
        const sections = listAssistantProfileSections(lawMindRoot, id);
        sendJson(res, 200, { ok: true, assistantId: id, sections }, c);
      } catch (e) {
        if (e instanceof Error && e.message === "invalid assistant id") {
          sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
          return true;
        }
        throw e;
      }
      return true;
    }
  }

  if (pathname === "/api/assistants" && req.method === "POST") {
    const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
    let body;
    try {
      body = await parseJsonBodyZod(req, assistantUpsertSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    const assistantId = body.assistantId;
    if (assistantId !== undefined && !isSafeAssistantIdSegment(assistantId)) {
      sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
      return true;
    }
    if (guardCreateAssistant(lawMindRoot, ctx, res, c, assistantId)) {
      return true;
    }
    try {
      const assistant = upsertAssistant(lawMindRoot, {
        assistantId,
        displayName: body.displayName,
        introduction: body.introduction,
        presetKey: body.presetKey,
        customRoleTitle: body.customRoleTitle,
        customRoleInstructions: body.customRoleInstructions,
        jobBrief: body.jobBrief,
        orgRole: body.orgRole,
        reportsToAssistantId: body.reportsToAssistantId,
        peerReviewDefaultAssistantId: body.peerReviewDefaultAssistantId,
        pinned: body.pinned,
        hidden: body.hidden,
      });
      sendJson(res, 200, { ok: true, assistant }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, { ok: false, error: msg }, c);
    }
    return true;
  }

  {
    const sharePath = pathname.match(/^\/api\/assistants\/([^/]+)\/share-template$/);
    if (sharePath && req.method === "POST") {
      const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
      const id = decodeURIComponent(sharePath[1] ?? "");
      if (!isSafeAssistantIdSegment(id)) {
        sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
        return true;
      }
      let acknowledgeWarnings = false;
      try {
        const body = await parseJsonBodyZod(req, assistantShareSchema);
        acknowledgeWarnings = body.acknowledgeWarnings === true;
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJson(res, 400, { ok: false, error: "invalid request" }, c);
          return true;
        }
        throw err;
      }
      const profile = loadAssistantProfiles(lawMindRoot).find((row) => row.assistantId === id);
      if (!profile) {
        sendJson(res, 400, { ok: false, error: "助手不存在，请先刷新名册" }, c);
        return true;
      }
      const reviewed = exportAssistantShare(
        profile,
        acknowledgeWarnings,
        routinesForAssistant(workspaceDir, id),
      );
      if (!reviewed.ok || !reviewed.template) {
        sendJson(
          res,
          400,
          { ok: false, blockers: reviewed.blockers, warnings: reviewed.warnings },
          c,
        );
        return true;
      }
      sendJson(res, 200, { ok: true, template: reviewed.template, warnings: reviewed.warnings }, c);
      return true;
    }
  }

  {
    const duplicatePath = pathname.match(/^\/api\/assistants\/([^/]+)\/duplicate$/);
    if (duplicatePath && req.method === "POST") {
      const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
      const id = decodeURIComponent(duplicatePath[1] ?? "");
      if (!isSafeAssistantIdSegment(id)) {
        sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
        return true;
      }
      if (!getAssistantById(lawMindRoot, id)) {
        sendJson(res, 400, { ok: false, error: "助手不存在，请先刷新名册" }, c);
        return true;
      }
      if (guardCreateAssistant(lawMindRoot, ctx, res, c)) {
        return true;
      }
      // body 可选：`readJsonBody` 对空 body 返回 `{}`，而该 schema 的字段都是可选的，
      // 因此「不带 body」与「带空 body」都能走通，不带就由引擎按「X 副本」命名。
      let displayName: string | undefined;
      try {
        const body = await parseJsonBodyZod(req, assistantDuplicateSchema);
        displayName = body.displayName;
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJson(res, 400, { ok: false, error: "invalid request" }, c);
          return true;
        }
        throw err;
      }
      try {
        const assistant = duplicateAssistant(lawMindRoot, id, { displayName });
        sendJson(res, 200, { ok: true, assistant }, c);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 400, { ok: false, error: msg }, c);
      }
      return true;
    }
  }

  {
    const assistantPath = pathname.match(/^\/api\/assistants\/([^/]+)$/);
    if (assistantPath && req.method === "PATCH") {
      const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
      const id = decodeURIComponent(assistantPath[1] ?? "");
      if (!isSafeAssistantIdSegment(id)) {
        sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
        return true;
      }
      let body;
      try {
        body = await parseJsonBodyZod(req, assistantUpsertSchema);
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJson(res, 400, { ok: false, error: "invalid request" }, c);
          return true;
        }
        throw err;
      }
      try {
        const assistant = upsertAssistant(lawMindRoot, {
          assistantId: id,
          displayName: body.displayName,
          introduction: body.introduction,
          presetKey: body.presetKey,
          customRoleTitle: body.customRoleTitle,
          customRoleInstructions: body.customRoleInstructions,
          jobBrief: body.jobBrief,
          orgRole: body.orgRole,
          reportsToAssistantId: body.reportsToAssistantId,
          peerReviewDefaultAssistantId: body.peerReviewDefaultAssistantId,
          pinned: body.pinned,
          hidden: body.hidden,
        });
        sendJson(res, 200, { ok: true, assistant }, c);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 400, { ok: false, error: msg }, c);
      }
      return true;
    }
    if (assistantPath && req.method === "DELETE") {
      const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
      const id = decodeURIComponent(assistantPath[1] ?? "");
      if (!isSafeAssistantIdSegment(id)) {
        sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
        return true;
      }
      const ok = deleteAssistant(lawMindRoot, id);
      if (!ok) {
        sendJson(res, 400, { ok: false, error: "cannot delete default or unknown assistant" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true }, c);
      return true;
    }
  }

  return false;
}

function presenceByAssistant(workspaceDir: string): Map<string, AssistantPresenceView> {
  const sessionAssistant = new Map<string, string>();
  try {
    for (const session of listSessions(workspaceDir)) {
      if (session.sessionId && session.assistantId) {
        sessionAssistant.set(session.sessionId, session.assistantId);
      }
    }
  } catch {
    return new Map();
  }
  const out = new Map<string, AssistantPresenceView>();
  const now = Date.now();
  try {
    for (const work of listLawyerWorks(workspaceDir)) {
      const assistantId = work.sessionId ? sessionAssistant.get(work.sessionId) : undefined;
      if (!assistantId) {
        continue;
      }
      const next = presenceFromWork(work.status, work.updatedAt, now);
      out.set(assistantId, notePresence(out.get(assistantId), next, ""));
    }
  } catch {
    return out;
  }
  return out;
}

function routinesForAssistant(workspaceDir: string, assistantId: string) {
  try {
    return listAutomations(workspaceDir)
      .filter((automation) => automation.assistantId === assistantId)
      .map((automation) => ({
        title: automation.title,
        schedule: automation.schedule.kind,
        expectedResult: automation.expectedResult,
        approvalBoundary: automation.approvalBoundary,
        eventMatch: automation.eventTrigger?.match,
      }));
  } catch {
    return [];
  }
}
