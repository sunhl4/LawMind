import { isValidMatterId } from "../../../src/lawmind/cases/index.js";
import { buildAuditExportMarkdown, buildComplianceAuditMarkdown } from "../../../src/lawmind/audit/index.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

/**
 * GET /api/audit/export — Markdown 审计导出（可选 compliance 模式）。
 */
export async function handleAuditExportRoute({
  ctx,
  req,
  res,
  url,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname !== "/api/audit/export" || req.method !== "GET") {
    return false;
  }

  const { workspaceDir } = ctx;
  const matterId = url.searchParams.get("matterId")?.trim() || undefined;
  const taskId = url.searchParams.get("taskId")?.trim() || undefined;
  const since = url.searchParams.get("since")?.trim() || undefined;
  const until = url.searchParams.get("until")?.trim() || undefined;
  if (matterId && !isValidMatterId(matterId)) {
    sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
    return true;
  }
  const complianceRaw = url.searchParams.get("compliance")?.trim().toLowerCase() ?? "";
  const useCompliance = complianceRaw === "1" || complianceRaw === "true";
  const md = useCompliance
    ? await buildComplianceAuditMarkdown(workspaceDir, { matterId, taskId, since, until })
    : await buildAuditExportMarkdown(workspaceDir, { matterId, taskId, since, until });
  res.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    ...c,
  });
  res.end(md);
  return true;
}
