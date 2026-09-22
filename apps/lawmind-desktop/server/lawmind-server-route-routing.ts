/**
 * GET/PUT /api/routing/defaults · POST /api/routing/resolve
 */

import { z } from "zod";
import {
  loadRoutingDefaults,
  resolveDefaultAssignee,
  saveRoutingDefaults,
  type RoutingDefaultsV1,
} from "../../../src/lawmind/routing/defaults.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

const assigneeRefSchema = z.object({
  roleId: z.string().optional(),
  assistantId: z.string().optional(),
});

const routingDefaultsPutSchema = z.object({
  forcePeerReview: z.union([z.boolean(), z.null()]).optional(),
  byKind: z.record(z.string(), assigneeRefSchema).optional(),
  byDeliverableType: z.record(z.string(), assigneeRefSchema).optional(),
});

const routingResolveSchema = z.object({
  kind: z.string().optional(),
  deliverableType: z.string().optional(),
  matterId: z.string().optional(),
  explicitAssistantId: z.string().optional(),
  fallbackAssistantId: z.string().optional(),
});

export async function handleRoutingRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/routing/defaults" && req.method === "GET") {
    const defaults = loadRoutingDefaults(workspaceDir);
    sendJson(res, 200, { ok: true, defaults }, c);
    return true;
  }

  if (pathname === "/api/routing/defaults" && req.method === "PUT") {
    try {
      const body = await parseJsonBodyZod(req, routingDefaultsPutSchema);
      const prev = loadRoutingDefaults(workspaceDir);
      const next: RoutingDefaultsV1 = {
        version: 1,
        forcePeerReview:
          body.forcePeerReview === undefined ? prev.forcePeerReview ?? null : body.forcePeerReview,
        byKind: body.byKind ?? prev.byKind ?? {},
        byDeliverableType: body.byDeliverableType ?? prev.byDeliverableType ?? {},
      };
      const saved = saveRoutingDefaults(workspaceDir, next);
      sendJson(res, 200, { ok: true, defaults: saved }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  if (pathname === "/api/routing/resolve" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, routingResolveSchema);
      const resolved = resolveDefaultAssignee({
        workspaceDir,
        kind: body.kind,
        deliverableType: body.deliverableType,
        explicitAssistantId: body.explicitAssistantId,
        fallbackAssistantId: body.fallbackAssistantId,
        envFile: ctx.envFile,
        auditDir: undefined,
      });
      sendJson(res, 200, { ok: true, ...resolved }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  return false;
}
