import { listPlatformGateHistory } from "../../../src/lawmind/platform/audit-gate.js";
import { mergeRecommendedLegalNetworkAllowlist } from "../../../src/lawmind/policy/network-allowlist.js";
import {
  mergeWorkspacePolicyFile,
  readWorkspacePolicyFile,
} from "../../../src/lawmind/policy/workspace-policy.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { workspacePolicyPatchSchema } from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { isLawMindHttpError, sendJson } from "./lawmind-server-helpers.js";

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
    let body;
    try {
      body = await parseJsonBodyZod(req, workspacePolicyPatchSchema);
    } catch (e) {
      if (isLawMindHttpError(e)) {
        sendJson(res, e.status, { ok: false, message: e.message }, c);
      } else if (isInvalidRequestBodyError(e)) {
        sendJson(res, 400, { ok: false, message: "highSecurityMode must be boolean" }, c);
      } else {
        sendJson(res, 400, { ok: false, message: "invalid json" }, c);
      }
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

  if (pathname === "/api/policy/workspace/recommended-allowlist" && req.method === "POST") {
    const policy = readWorkspacePolicyFile(ctx.workspaceDir);
    const networkAllowlist = mergeRecommendedLegalNetworkAllowlist(policy?.networkAllowlist);
    const merged = mergeWorkspacePolicyFile(ctx.workspaceDir, { networkAllowlist });
    if (!merged.ok) {
      sendJson(res, 500, { ok: false, message: merged.error }, c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        networkAllowlist: merged.policy.networkAllowlist ?? networkAllowlist,
        note: "已合并推荐法律检索主机；未强制开启联网或 networkAllowlistEnforced。",
      },
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
