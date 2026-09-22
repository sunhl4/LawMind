/**
 * GET/POST /api/workspace/practice-playbook — optional 执业口径 (defaults if missing).
 */

import {
  loadPracticePlaybook,
  savePracticePlaybook,
} from "../../../src/lawmind/practice/practice-playbook.js";
import { parseJsonBodyZod } from "./lawmind-api-parse.js";
import { practicePlaybookPostSchema } from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

export async function handlePracticePlaybookRoutes({
  pathname,
  req,
  res,
  c,
  ctx,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;
  if (pathname !== "/api/workspace/practice-playbook") {
    return false;
  }

  if (req.method === "GET") {
    const playbook = loadPracticePlaybook(workspaceDir);
    sendJson(res, 200, { ok: true, playbook }, c);
    return true;
  }

  if (req.method === "POST") {
    const body = await parseJsonBodyZod(req, practicePlaybookPostSchema);
    try {
      const playbook = await savePracticePlaybook(workspaceDir, {
        stanceDefault: body.stanceDefault,
        disputeForum: body.disputeForum,
        neverAccept: body.neverAccept,
        notes: body.notes,
      });
      sendJson(res, 200, { ok: true, playbook }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, { ok: false, code: "save_failed", message: msg }, c);
    }
    return true;
  }

  return false;
}
