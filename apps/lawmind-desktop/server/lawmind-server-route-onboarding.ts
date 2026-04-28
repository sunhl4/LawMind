/**
 * POST /api/onboarding/firstrun-wizard — record first-run wizard completion + acceptance funnel pending.
 */

import path from "node:path";
import fs from "node:fs";
import { isValidMatterId } from "../../../src/lawmind/cases/index.js";
import { recordFirstrunWizardCompleted } from "../../../src/lawmind/onboarding/firstrun-state.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { readJsonBody, resolveDesktopActorId, sendJson } from "./lawmind-server-helpers.js";

export async function handleOnboardingRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname !== "/api/onboarding/firstrun-wizard" || req.method !== "POST") {
    return false;
  }

  const body = (await readJsonBody(req)) as { matterId?: string };
  const matterId = typeof body.matterId === "string" ? body.matterId.trim() : "";
  if (!matterId || !isValidMatterId(matterId)) {
    sendJson(res, 400, { ok: false, error: "invalid matterId" }, c);
    return true;
  }

  const caseDir = path.join(workspaceDir, "cases", matterId);
  if (!fs.existsSync(caseDir) || !fs.statSync(caseDir).isDirectory()) {
    sendJson(res, 400, { ok: false, error: "matter not found in workspace" }, c);
    return true;
  }

  const auditDir = path.join(workspaceDir, "audit");
  try {
    await recordFirstrunWizardCompleted(
      workspaceDir,
      matterId,
      auditDir,
      resolveDesktopActorId(),
    );
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    return true;
  }

  sendJson(res, 200, { ok: true }, c);
  return true;
}
