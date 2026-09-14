/**
 * POST /api/intent/compile — same peek + compile path as runTurn (preview for status bar).
 */

import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import { compileTurnIntent } from "../../../src/lawmind/intent/compile-turn-intent.js";
import { intentCompileRequestSchema } from "../../../src/lawmind/platform/local-api-schemas.js";
import { isLawyerCapabilityId } from "../../../src/lawmind/skills/lawyer-capability-lock.js";
import {
  isInvalidRequestBodyError,
  parseJsonBodyZod,
} from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

export async function handleIntentRoutes(args: LawmindRouteContext): Promise<boolean> {
  const { ctx, pathname, req, res, c } = args;
  const { workspaceDir } = ctx;

  if (!(pathname === "/api/intent/compile" && req.method === "POST")) {
    return false;
  }

  try {
    const body = await parseJsonBodyZod(req, intentCompileRequestSchema);
    const matterId = body.matterId?.trim() || undefined;
    if (matterId && !isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matterId" }, c);
      return true;
    }
    const previousRaw = body.previousCapabilityId?.trim();
    const previousCapabilityId =
      previousRaw && isLawyerCapabilityId(previousRaw)
        ? (previousRaw)
        : undefined;
    const compiled = await compileTurnIntent({
      workspaceDir,
      projectDir: body.projectDir?.trim() || undefined,
      instruction: body.instruction ?? "",
      pins: body.contextPins,
      matterId,
      previousCapabilityId,
      historyText: body.historyText,
      mailFastPath: body.mailFastPath,
    });
    sendJson(res, 200, { ok: true, compiled }, c);
  } catch (err) {
    if (isInvalidRequestBodyError(err)) {
      sendJson(res, 400, { ok: false, error: "invalid body", issues: err.issues }, c);
      return true;
    }
    throw err;
  }
  return true;
}
