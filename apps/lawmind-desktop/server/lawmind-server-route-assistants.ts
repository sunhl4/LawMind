import { listAssistantPresets } from "../../../src/lawmind/agent/assistant-presets.js";
import { listAssistantProfileSections } from "../../../src/lawmind/assistants/profile-md.js";
import {
  deleteAssistant,
  loadAssistantProfiles,
  loadAssistantStats,
  resolveLawMindRoot,
  upsertAssistant,
} from "../../../src/lawmind/assistants/store.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { readJsonBody, sendJson } from "./lawmind-server-helpers.js";
import { isSafeAssistantIdSegment } from "./safe-assistant-id.js";

export async function handleAssistantRoutes({
  ctx,
  pathname,
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
    const assistants = profiles.map((profile) => ({
      ...profile,
      stats: stats[profile.assistantId] ?? {
        lastUsedAt: "",
        turnCount: 0,
        sessionCount: 0,
      },
    }));
    sendJson(res, 200, { ok: true, assistants, presets: listAssistantPresets() }, c);
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
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const assistantId = typeof body.assistantId === "string" ? body.assistantId : undefined;
    if (assistantId !== undefined && !isSafeAssistantIdSegment(assistantId)) {
      sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
      return true;
    }
    const assistant = upsertAssistant(lawMindRoot, {
      assistantId,
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      introduction: typeof body.introduction === "string" ? body.introduction : undefined,
      presetKey: typeof body.presetKey === "string" ? body.presetKey : undefined,
      customRoleTitle: typeof body.customRoleTitle === "string" ? body.customRoleTitle : undefined,
      customRoleInstructions:
        typeof body.customRoleInstructions === "string" ? body.customRoleInstructions : undefined,
    });
    sendJson(res, 200, { ok: true, assistant }, c);
    return true;
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
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const assistant = upsertAssistant(lawMindRoot, {
        assistantId: id,
        displayName: typeof body.displayName === "string" ? body.displayName : undefined,
        introduction: typeof body.introduction === "string" ? body.introduction : undefined,
        presetKey: typeof body.presetKey === "string" ? body.presetKey : undefined,
        customRoleTitle: typeof body.customRoleTitle === "string" ? body.customRoleTitle : undefined,
        customRoleInstructions:
          typeof body.customRoleInstructions === "string" ? body.customRoleInstructions : undefined,
      });
      sendJson(res, 200, { ok: true, assistant }, c);
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
