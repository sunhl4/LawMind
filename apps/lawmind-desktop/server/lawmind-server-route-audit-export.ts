import { isValidMatterId } from "../../../src/lawmind/cases/index.js";
import {
  buildAuditExportMarkdown,
  buildAuditReplayExport,
  buildComplianceAuditMarkdown,
  readAllAuditLogs,
} from "../../../src/lawmind/audit/index.js";
import {
  summarizeAuditIntegrity,
  type AuditEventWithIntegrity,
} from "../../../src/lawmind/audit/hash-chain.js";
import { isFeatureEnabled } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import path from "node:path";
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
  const integrityRaw = url.searchParams.get("integrity")?.trim().toLowerCase() ?? "";
  const useIntegrity = integrityRaw === "1" || integrityRaw === "true";
  const replayRaw = url.searchParams.get("replay")?.trim().toLowerCase() ?? "";
  const useReplay = replayRaw === "1" || replayRaw === "true";
  if (useIntegrity) {
    const policyForEdition: LawMindWorkspacePolicy | null = ctx.policy.loaded
      ? (ctx.policy.policy as LawMindWorkspacePolicy)
      : null;
    if (!isFeatureEnabled("auditIntegrityExport", { policy: policyForEdition })) {
      sendJson(res, 403, { ok: false, error: "audit_integrity_export_disabled" }, c);
      return true;
    }
    const auditDir = path.join(workspaceDir, "audit");
    const all = await readAllAuditLogs(auditDir);
    const summary = summarizeAuditIntegrity(all as AuditEventWithIntegrity[]);
    sendJson(res, 200, { ok: true, integrity: summary }, c);
    return true;
  }
  if (useReplay) {
    const replay = await buildAuditReplayExport(workspaceDir, { matterId, taskId, since, until });
    sendJson(res, 200, { ok: true, replay }, c);
    return true;
  }
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
