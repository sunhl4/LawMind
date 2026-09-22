import { rebuildHostIndex } from "../../../src/lawmind/host-access/host-index.js";
import { readHostAccessLog } from "../../../src/lawmind/host-access/host-log.js";
import { buildHostAccessRuntime } from "../../../src/lawmind/host-access/access-broker.js";
import { setSessionCommandAllowed } from "../../../src/lawmind/host-access/host-store.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

export async function handleHostAccessRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname === "/api/host-access" && req.method === "GET") {
    const runtime = buildHostAccessRuntime({
      workspaceDir: ctx.workspaceDir,
      sessionId: "settings",
      projectDir: process.env.LAWMIND_PROJECT_DIR,
    });
    sendJson(
      res,
      200,
      {
        ok: true,
        policy: runtime.policy,
        mounts: runtime.mounts.map((m) => ({
          id: m.id,
          label: m.label ?? m.absPath.split(/[\\/]/).pop(),
          matterId: m.matterId,
          folderName: m.absPath.split(/[\\/]/).pop(),
        })),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/host-access/log" && req.method === "GET") {
    const runtime = buildHostAccessRuntime({
      workspaceDir: ctx.workspaceDir,
      sessionId: "settings",
    });
    const limitRaw = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50;
    sendJson(
      res,
      200,
      { ok: true, events: runtime.logDir ? readHostAccessLog(runtime.logDir, limit) : [] },
      c,
    );
    return true;
  }

  if (pathname === "/api/host-access/index/rebuild" && req.method === "POST") {
    const runtime = buildHostAccessRuntime({
      workspaceDir: ctx.workspaceDir,
      sessionId: "settings",
      projectDir: process.env.LAWMIND_PROJECT_DIR,
    });
    const result = rebuildHostIndex(runtime);
    sendJson(res, 200, { ok: true, ...result }, c);
    return true;
  }

  if (pathname === "/api/host-access/session-command" && req.method === "POST") {
    const sessionId = url.searchParams.get("sessionId")?.trim();
    if (!sessionId) {
      sendJson(res, 400, { ok: false, message: "sessionId required" }, c);
      return true;
    }
    setSessionCommandAllowed(sessionId, true);
    sendJson(res, 200, { ok: true }, c);
    return true;
  }

  return false;
}
