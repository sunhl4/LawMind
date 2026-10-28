/**
 * GET /api/matters/:id/artifacts — 案件成果物三件套（时间线 / 大事记 / 思维导图）。
 *
 * 只读：真相源是 `cases/<matterId>/project.case-*.json`，由 agent 按再生纪律写入；
 * 桌面端不提供编辑接口，避免出现第二个真相源。
 */

import { readMatterArtifacts, type MatterArtifactKind } from "../../../src/lawmind/deliverables/matter-artifact.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const KINDS: MatterArtifactKind[] = ["case-timeline", "case-chronology", "case-mindmap"];

export async function handleMatterArtifactRoutes({
  pathname,
  req,
  res,
  c,
  ctx,
}: LawmindRouteContext): Promise<boolean> {
  const match = /^\/api\/matters\/([^/]+)\/artifacts$/.exec(pathname);
  if (!match || req.method !== "GET") {
    return false;
  }
  const matterId = decodeURIComponent(match[1] ?? "").trim();
  if (!matterId || matterId.includes("..") || matterId.includes("/") || matterId.includes("\\")) {
    sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
    return true;
  }

  const all = readMatterArtifacts(ctx.workspaceDir, matterId);
  const artifacts: Record<string, unknown> = {};
  for (const kind of KINDS) {
    const result = all[kind];
    artifacts[kind] =
      result.status === "ok"
        ? { status: result.status, artifact: result.artifact, issues: result.issues }
        : result;
  }
  sendJson(res, 200, { ok: true, matterId, artifacts }, c);
  return true;
}
