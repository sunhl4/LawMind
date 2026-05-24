import { listPlatformGateHistory } from "../../../src/lawmind/platform/audit-gate.js";
import {
  mergeWorkspacePolicyFile,
  readWorkspacePolicyFile,
} from "../../../src/lawmind/policy/workspace-policy.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { isLawMindHttpError, readJsonBody, sendJson } from "./lawmind-server-helpers.js";

export async function handlePlatformRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname === "/api/policy/workspace" && req.method === "GET") {
    const policy = readWorkspacePolicyFile(ctx.workspaceDir);
    sendJson(
      res,
      200,
      {
        ok: true,
        highSecurityMode: policy?.highSecurityMode === true,
        allowWebSearch: policy?.allowWebSearch,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/policy/workspace" && req.method === "PATCH") {
    let body: { highSecurityMode?: unknown };
    try {
      body = (await readJsonBody(req)) as { highSecurityMode?: unknown };
    } catch (e) {
      if (isLawMindHttpError(e)) {
        sendJson(res, e.status, { ok: false, message: e.message }, c);
      } else {
        sendJson(res, 400, { ok: false, message: "invalid json" }, c);
      }
      return true;
    }
    if (typeof body.highSecurityMode !== "boolean") {
      sendJson(res, 400, { ok: false, message: "highSecurityMode must be boolean" }, c);
      return true;
    }
    const merged = mergeWorkspacePolicyFile(ctx.workspaceDir, {
      highSecurityMode: body.highSecurityMode,
      ...(body.highSecurityMode
        ? { allowWebSearch: false, productInsightsCollection: "off" as const }
        : {}),
    });
    if (!merged.ok) {
      sendJson(res, 500, { ok: false, message: merged.error }, c);
      return true;
    }
    sendJson(
      res,
      200,
      { ok: true, highSecurityMode: merged.policy.highSecurityMode === true },
      c,
    );
    return true;
  }

  if (pathname === "/api/platform/gate-history" && req.method === "GET") {
    const raw = url.searchParams.get("limit") ?? "60";
    const limit = Number.parseInt(raw, 10);
    const items = await listPlatformGateHistory(
      ctx.workspaceDir,
      Number.isFinite(limit) ? limit : 60,
    );
    sendJson(res, 200, { ok: true, items }, c);
    return true;
  }

  return false;
}
