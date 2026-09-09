/**
 * POST /api/audit/event — 接受 renderer 侧代理层写入的审计事件。
 *
 * 由 renderer 统一 API 客户端代理层在每次 fetch 后调用，
 * 将 `outbound_http` 等事件转发给引擎侧审计接口（src/lawmind/audit）。
 */

import path from "node:path";
import { z } from "zod";
import { emit } from "../../../src/lawmind/audit/index.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const auditEventSchema = z.object({
  kind: z.enum(["outbound_http"]),
  taskId: z.string().min(1).max(128),
  actor: z.enum(["system", "lawyer", "assistant", "automation"]),
  actorId: z.string().max(256).optional(),
  detail: z.string().max(4000).optional(),
});

export async function handleAuditEventRoute({
  ctx,
  req,
  res,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname !== "/api/audit/event" || req.method !== "POST") {
    return false;
  }

  let body;
  try {
    body = await parseJsonBodyZod(req, auditEventSchema);
  } catch (err) {
    if (isInvalidRequestBodyError(err)) {
      sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
      return true;
    }
    throw err;
  }

  const auditDir = path.join(ctx.workspaceDir, "audit");
  try {
    await emit(auditDir, {
      taskId: body.taskId,
      kind: body.kind,
      actor: body.actor,
      actorId: body.actorId,
      detail: body.detail,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJsonError(res, 500, "audit_emit_failed", msg, c);
    return true;
  }

  sendJson(res, 200, { ok: true }, c);
  return true;
}
