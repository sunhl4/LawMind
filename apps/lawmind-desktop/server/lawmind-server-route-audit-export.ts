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
import { verifyAuditWorkspaceTailAnchors } from "../../../src/lawmind/audit/root-anchor.js";
import {
  buildSignedAuditExportSummary,
  formatAuditSummaryPlainText,
} from "../../../src/lawmind/audit/export-summary.js";
import {
  formatAuditExternalVerifyReport,
  verifyExternalAuditAnchor,
} from "../../../src/lawmind/audit/verify-external.js";
import { isFeatureEnabled } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import path from "node:path";
import { z } from "zod";
import { parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const verifyExternalPostSchema = z.object({
  externalAnchorUrl: z.string().trim().min(1),
});

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
    // 外锚比对：按日文件维度检测尾部截断（summary 是跨日拼接视图，截断检测以锚为准）。
    const tailAnchor = verifyAuditWorkspaceTailAnchors(auditDir);
    sendJson(res, 200, { ok: true, integrity: { ...summary, tailAnchor } }, c);
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

/**
 * GET /api/audit/export-summary — 可验证审计摘要（JSON 或纯文本）。
 */
export async function handleAuditExportSummaryRoute({
  ctx,
  req,
  res,
  url,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname !== "/api/audit/export-summary" || req.method !== "GET") {
    return false;
  }
  const auditDir = path.join(ctx.workspaceDir, "audit");
  const { summary, signature, hmacKeyId } = buildSignedAuditExportSummary(auditDir);
  const formatRaw = url.searchParams.get("format")?.trim().toLowerCase() ?? "";
  if (formatRaw === "text" || formatRaw === "txt") {
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      ...c,
    });
    res.end(formatAuditSummaryPlainText(summary, signature));
    return true;
  }
  sendJson(
    res,
    200,
    {
      ok: true,
      summary,
      signature,
      hmacKeyId,
    },
    c,
  );
  return true;
}

/**
 * POST /api/audit/verify-external — 验证审计链与外部锚是否一致。
 */
export async function handleAuditVerifyExternalRoute({
  ctx,
  req,
  res,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname !== "/api/audit/verify-external" || req.method !== "POST") {
    return false;
  }
  const body = await parseJsonBodyZod(req, verifyExternalPostSchema);
  const auditDir = path.join(ctx.workspaceDir, "audit");
  const result = await verifyExternalAuditAnchor(auditDir, body.externalAnchorUrl);
  sendJson(
    res,
    200,
    {
      ok: result.ok,
      status: result.status,
      detail: result.detail,
      chain: result.chain,
      externalSummary: result.externalSummary,
      chainRootHash: result.chainRootHash,
      report: formatAuditExternalVerifyReport(result),
    },
    c,
  );
  return true;
}
