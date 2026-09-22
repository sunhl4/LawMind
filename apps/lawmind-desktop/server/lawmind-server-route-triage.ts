/**
 * Skills E1 — triage preview / confirm / get.
 */

import { emit } from "../../../src/lawmind/audit/index.js";
import { appendProductMetric } from "../../../src/lawmind/metrics/product-metrics.js";
import {
  confirmTriageSession,
  createTriageSession,
  listTriageRuleIds,
  readTriageSession,
  saveTriageSessionOnly,
} from "../../../src/lawmind/triage/index.js";
import { listLocalSkills } from "../../../src/lawmind/skills/skill-runtime.js";
import { matchSkillsForTriage } from "../../../src/lawmind/skills/skill-match.js";
import {
  isInvalidRequestBodyError,
  parseJsonBodyZod,
} from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { z } from "zod";
import path from "node:path";

const triagePreviewSchema = z.object({
  text: z.string(),
  matterId: z.string().optional().nullable(),
  deliverableTypeHint: z.string().optional(),
  skipGreenConfirm: z.boolean().optional(),
  dispatchPrompt: z.string().optional(),
});

const triageConfirmSchema = z.object({
  sessionId: z.string().min(1),
  matterId: z.string().optional().nullable(),
  clarificationAnswers: z.record(z.string(), z.string()).optional(),
  dispatchPrompt: z.string().optional(),
  saveOnly: z.boolean().optional(),
});

export async function handleTriageRoutes(args: LawmindRouteContext): Promise<boolean> {
  const { ctx, pathname, req, res, c } = args;
  const { workspaceDir } = ctx;

  if (pathname === "/api/triage/rules" && req.method === "GET") {
    sendJson(res, 200, { ok: true, ruleIds: listTriageRuleIds() }, c);
    return true;
  }

  if (pathname === "/api/triage" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, triagePreviewSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid triage body" }, c);
        return true;
      }
      throw err;
    }
    const session = createTriageSession(workspaceDir, {
      text: body.text,
      matterId: body.matterId,
      deliverableTypeHint: body.deliverableTypeHint,
      skipGreenConfirm: body.skipGreenConfirm,
    });
    if (body.dispatchPrompt) {
      session.dispatchPrompt = body.dispatchPrompt;
      const { persistTriageSession } = await import("../../../src/lawmind/triage/index.js");
      persistTriageSession(workspaceDir, session);
    }
    appendProductMetric(workspaceDir, {
      kind: "triage",
      outcome: "preview",
      matterId: session.matterId ?? undefined,
      detail: session.result.tier,
      meta: { workflowId: session.result.recommendedWorkflowId },
    });
    await emit(path.join(workspaceDir, "audit"), {
      taskId: session.id,
      kind: "triage.created",
      actor: "lawyer",
      detail: `tier=${session.result.tier}; workflow=${session.result.recommendedWorkflowId}`,
    });

    if (body.skipGreenConfirm && session.result.tier === "green") {
      const confirmed = confirmTriageSession(workspaceDir, session, {
        dispatchPrompt: body.dispatchPrompt ?? session.dispatchPrompt,
      });
      appendProductMetric(workspaceDir, {
        kind: "triage",
        outcome: "confirmed",
        matterId: confirmed.matterId ?? undefined,
        detail: "auto_green",
      });
      sendJson(res, 200, { ok: true, session: confirmed, autoConfirmed: true }, c);
      return true;
    }

    const matchedSkills = matchSkillsForTriage(listLocalSkills(workspaceDir), {
      recommendedWorkflowId: session.result.recommendedWorkflowId,
      text: body.text,
      deliverableTypeHint: body.deliverableTypeHint,
    }).map((s) => ({ id: s.id, name: s.name, version: s.version }));
    sendJson(res, 200, { ok: true, session, autoConfirmed: false, matchedSkills }, c);
    return true;
  }

  if (pathname === "/api/triage/confirm" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, triageConfirmSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid confirm body" }, c);
        return true;
      }
      throw err;
    }
    const session = readTriageSession(workspaceDir, body.sessionId, body.matterId);
    if (!session) {
      sendJson(res, 404, { ok: false, error: "triage session not found" }, c);
      return true;
    }
    if (body.saveOnly) {
      const saved = saveTriageSessionOnly(workspaceDir, session);
      sendJson(res, 200, { ok: true, session: saved }, c);
      return true;
    }
    try {
      const confirmed = confirmTriageSession(workspaceDir, session, {
        clarificationAnswers: body.clarificationAnswers,
        dispatchPrompt: body.dispatchPrompt,
      });
      appendProductMetric(workspaceDir, {
        kind: "triage",
        outcome: "confirmed",
        matterId: confirmed.matterId ?? undefined,
        detail: confirmed.result.tier,
      });
      await emit(path.join(workspaceDir, "audit"), {
        taskId: confirmed.id,
        kind: "triage.confirmed",
        actor: "lawyer",
        detail: `tier=${confirmed.result.tier}`,
      });
      sendJson(res, 200, { ok: true, session: confirmed }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("missing_clarification:")) {
        sendJson(
          res,
          422,
          { ok: false, error: "missing_clarification", key: msg.split(":")[1] },
          c,
        );
        return true;
      }
      throw e;
    }
    return true;
  }

  {
    const getMatch = pathname.match(/^\/api\/triage\/([^/]+)$/);
    if (getMatch && req.method === "GET") {
      const id = decodeURIComponent(getMatch[1] ?? "");
      const matterId = args.url.searchParams.get("matterId");
      const session = readTriageSession(workspaceDir, id, matterId);
      if (!session) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, session }, c);
      return true;
    }
  }

  return false;
}
