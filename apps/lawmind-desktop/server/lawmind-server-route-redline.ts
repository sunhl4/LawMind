/**
 * Draft redline proposal routes.
 *
 * GET  /api/drafts/:taskId/redline
 * POST /api/drafts/:taskId/redline/generate
 * POST /api/drafts/:taskId/redline/hunks/:hunkId/resolve
 */

import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import {
  generateRedlineProposal,
  readRedlineProposal,
  resetRedlineBaselineFromDraft,
  resolveRedlineHunk,
  summarizeRedline,
} from "../../../src/lawmind/drafts/redline-proposal.js";
import { readDraft, resolveDraftCitationIntegrity } from "../../../src/lawmind/drafts/index.js";
import { validateDraftAgainstSpec } from "../../../src/lawmind/deliverables/index.js";
import { deriveReviewGateDecisions } from "../../../src/lawmind/platform/review-gates.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";
import { readJsonBody, sendJson } from "./lawmind-server-helpers.js";

export async function handleRedlineRoutes({
  ctx,
  req,
  res,
  url: _url,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  const resolveMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/redline\/hunks\/([^/]+)\/resolve$/);
  if (resolveMatch && req.method === "POST") {
    const taskId = decodeURIComponent(resolveMatch[1] ?? "");
    const hunkId = decodeURIComponent(resolveMatch[2] ?? "");
    if (!isSafeTaskIdSegment(taskId)) {
      sendJson(res, 400, { ok: false, error: "invalid_task_id" }, c);
      return true;
    }
    const body = (await readJsonBody(req)) as { decision?: string };
    const decision = body?.decision === "reject" ? "reject" : body?.decision === "accept" ? "accept" : null;
    if (!decision) {
      sendJson(res, 400, { ok: false, error: "invalid_decision" }, c);
      return true;
    }
    const result = resolveRedlineHunk(workspaceDir, taskId, hunkId, decision);
    if (!result.ok) {
      const status = result.error === "hunk_not_found" || result.error === "redline_not_found" ? 404 : 409;
      sendJson(res, status, result, c);
      return true;
    }
    const draft = result.draft ?? readDraft(workspaceDir, taskId);
    const acceptance = draft ? validateDraftAgainstSpec(draft) : undefined;
    sendJson(
      res,
      200,
      {
        ok: true,
        proposal: result.proposal,
        redlineSummary: summarizeRedline(result.proposal),
        draft,
        citationIntegrity: draft ? resolveDraftCitationIntegrity(workspaceDir, draft) : undefined,
        acceptance,
        gateDecisions: draft && acceptance ? deriveReviewGateDecisions(draft, acceptance) : undefined,
      },
      c,
    );
    return true;
  }

  const baselineMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/redline\/baseline$/);
  if (baselineMatch && req.method === "POST") {
    const taskId = decodeURIComponent(baselineMatch[1] ?? "");
    if (!isSafeTaskIdSegment(taskId)) {
      sendJson(res, 400, { ok: false, error: "invalid_task_id" }, c);
      return true;
    }
    const result = resetRedlineBaselineFromDraft(workspaceDir, taskId);
    if (!result.ok) {
      sendJson(res, 404, result, c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        proposal: result.proposal,
        redlineSummary: summarizeRedline(result.proposal),
      },
      c,
    );
    return true;
  }

  const generateMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/redline\/generate$/);
  if (generateMatch && req.method === "POST") {
    const taskId = decodeURIComponent(generateMatch[1] ?? "");
    if (!isSafeTaskIdSegment(taskId)) {
      sendJson(res, 400, { ok: false, error: "invalid_task_id" }, c);
      return true;
    }
    const result = generateRedlineProposal(workspaceDir, taskId);
    if (!result.ok) {
      sendJson(res, 404, result, c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        proposal: result.proposal,
        redlineSummary: summarizeRedline(result.proposal),
      },
      c,
    );
    return true;
  }

  const getMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/redline$/);
  if (getMatch && req.method === "GET") {
    const taskId = decodeURIComponent(getMatch[1] ?? "");
    if (!isSafeTaskIdSegment(taskId)) {
      sendJson(res, 400, { ok: false, error: "invalid_task_id" }, c);
      return true;
    }
    const proposal = readRedlineProposal(workspaceDir, taskId);
    sendJson(
      res,
      200,
      {
        ok: true,
        proposal: proposal ?? null,
        redlineSummary: summarizeRedline(proposal),
      },
      c,
    );
    return true;
  }

  return false;
}
