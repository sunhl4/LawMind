/**
 * Skills E2 — review campaign + fleet playbooks API.
 */

import path from "node:path";
import { z } from "zod";
import { emit } from "../../../src/lawmind/audit/index.js";
import { appendProductMetric } from "../../../src/lawmind/metrics/product-metrics.js";
import { readDraft } from "../../../src/lawmind/drafts/index.js";
import { readTaskRecord } from "../../../src/lawmind/tasks/index.js";
import {
  cancelReviewCampaign,
  createReviewCampaign,
  extractReviewBrief,
  findCampaignByTaskId,
  getFleetPlaybook,
  loadFleetPlaybooksFromWorkspace,
  listBundledFleetPlaybooks,
  mergeReviewBriefs,
  mergeSourceTextWithBrief,
  readReviewCampaign,
  renderCampaignReportMarkdown,
  rerunReviewCampaignRole,
} from "../../../src/lawmind/review-campaign/index.js";
import {
  isInvalidRequestBodyError,
  parseJsonBodyZod,
} from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const createSchema = z.object({
  matterId: z.string().optional().nullable(),
  taskId: z.string().optional().nullable(),
  playbookId: z.string().optional(),
  deliverableTypeHint: z.string().optional(),
  sourceText: z.string().optional(),
  idempotencyKey: z.string().optional(),
  runNow: z.boolean().optional(),
  preferParallel: z.boolean().optional(),
  /** Skip low-weight roles for Solo「更快模式」 */
  preferFast: z.boolean().optional(),
});

function draftSourceText(workspaceDir: string, taskId: string | null | undefined): string {
  if (!taskId?.trim()) {
    return "";
  }
  const draft = readDraft(workspaceDir, taskId.trim());
  if (!draft) {
    return "";
  }
  const parts = [
    draft.title,
    draft.summary,
    ...(draft.sections ?? []).map((s) => `${s.heading}\n${s.body}`),
  ];
  return parts.filter(Boolean).join("\n\n");
}

export async function handleReviewCampaignRoutes(args: LawmindRouteContext): Promise<boolean> {
  const { ctx, pathname, req, res, c } = args;
  const { workspaceDir } = ctx;

  if (pathname === "/api/fleet-playbooks" && req.method === "GET") {
    const playbooks = loadFleetPlaybooksFromWorkspace(workspaceDir);
    sendJson(
      res,
      200,
      {
        ok: true,
        playbooks: playbooks.map((p) => ({
          id: p.id,
          label: p.label,
          version: p.version,
          roleCount: p.roles.length,
          deliverableTypes: p.deliverableTypes,
          executionMode: p.executionMode,
        })),
      },
      c,
    );
    return true;
  }

  {
    const pbMatch = pathname.match(/^\/api\/fleet-playbooks\/([^/]+)$/);
    if (pbMatch && req.method === "GET") {
      const id = decodeURIComponent(pbMatch[1] ?? "");
      const pb = getFleetPlaybook(workspaceDir, id);
      if (!pb) {
        sendJson(res, 404, { ok: false, error: "playbook not found" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, playbook: pb }, c);
      return true;
    }
  }

  if (pathname === "/api/review-campaigns" && req.method === "GET") {
    const taskId = args.url.searchParams.get("taskId")?.trim() ?? "";
    const matterId = args.url.searchParams.get("matterId");
    if (!taskId) {
      sendJson(res, 400, { ok: false, error: "taskId required" }, c);
      return true;
    }
    const campaign = findCampaignByTaskId(workspaceDir, taskId, matterId);
    if (!campaign) {
      sendJson(res, 404, { ok: false, error: "not found" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, campaign }, c);
    return true;
  }

  if (pathname === "/api/review-campaigns" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, createSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid campaign body" }, c);
        return true;
      }
      throw err;
    }
    const taskRec = body.taskId?.trim()
      ? readTaskRecord(workspaceDir, body.taskId.trim())
      : undefined;
    const brief = mergeReviewBriefs(
      extractReviewBrief(body.sourceText ?? ""),
      extractReviewBrief(taskRec?.instruction ?? ""),
    );
    const sourceText = mergeSourceTextWithBrief(
      body.sourceText?.trim() || draftSourceText(workspaceDir, body.taskId) || "",
      brief,
    );
    try {
      const campaign = createReviewCampaign(workspaceDir, {
        matterId: body.matterId,
        taskId: body.taskId,
        playbookId: body.playbookId,
        deliverableTypeHint: body.deliverableTypeHint,
        sourceText,
        reviewBrief: brief,
        idempotencyKey: body.idempotencyKey,
        runNow: body.runNow,
        preferParallel: body.preferParallel,
        preferFast: body.preferFast,
      });
      appendProductMetric(workspaceDir, {
        kind: "first_pass",
        outcome: campaign.status === "completed" ? "ok" : campaign.status,
        matterId: campaign.matterId ?? undefined,
        taskId: campaign.taskId ?? undefined,
        detail: `campaign:${campaign.playbookId}:${campaign.safetyScore?.score ?? "-"}`,
      });
      await emit(path.join(workspaceDir, "audit"), {
        taskId: campaign.taskId ?? campaign.id,
        kind: "review_campaign.created",
        actor: "lawyer",
        detail: `id=${campaign.id}; status=${campaign.status}; score=${campaign.safetyScore?.score ?? "-"}`,
      });
      sendJson(res, 200, { ok: true, campaign }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("unknown_playbook:")) {
        sendJson(res, 404, { ok: false, error: msg }, c);
        return true;
      }
      throw e;
    }
    return true;
  }

  {
    const getMatch = pathname.match(/^\/api\/review-campaigns\/([^/]+)$/);
    if (getMatch && req.method === "GET") {
      const id = decodeURIComponent(getMatch[1] ?? "");
      const matterId = args.url.searchParams.get("matterId");
      const campaign = readReviewCampaign(workspaceDir, id, matterId);
      if (!campaign) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, campaign }, c);
      return true;
    }
  }

  {
    const cancelMatch = pathname.match(/^\/api\/review-campaigns\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === "POST") {
      const id = decodeURIComponent(cancelMatch[1] ?? "");
      const campaign = readReviewCampaign(workspaceDir, id);
      if (!campaign) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      const next = cancelReviewCampaign(workspaceDir, campaign);
      sendJson(res, 200, { ok: true, campaign: next }, c);
      return true;
    }
  }

  {
    const rerunMatch = pathname.match(
      /^\/api\/review-campaigns\/([^/]+)\/roles\/([^/]+)\/rerun$/,
    );
    if (rerunMatch && req.method === "POST") {
      const id = decodeURIComponent(rerunMatch[1] ?? "");
      const role = decodeURIComponent(rerunMatch[2] ?? "");
      const campaign = readReviewCampaign(workspaceDir, id);
      if (!campaign) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      try {
        const next = rerunReviewCampaignRole(workspaceDir, campaign, role);
        await emit(path.join(workspaceDir, "audit"), {
          taskId: next.taskId ?? next.id,
          kind: "review_campaign.role_rerun",
          actor: "lawyer",
          detail: `id=${next.id}; role=${role}`,
        });
        sendJson(res, 200, { ok: true, campaign: next }, c);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 400, { ok: false, error: msg }, c);
      }
      return true;
    }
  }

  {
    const reportMatch = pathname.match(/^\/api\/review-campaigns\/([^/]+)\/report$/);
    if (reportMatch && req.method === "GET") {
      const id = decodeURIComponent(reportMatch[1] ?? "");
      const campaign = readReviewCampaign(workspaceDir, id);
      if (!campaign) {
        sendJson(res, 404, { ok: false, error: "not found" }, c);
        return true;
      }
      const markdown = renderCampaignReportMarkdown(campaign);
      sendJson(res, 200, { ok: true, format: "markdown", markdown, campaignId: campaign.id }, c);
      return true;
    }
  }

  return false;
}

export function fleetPlaybookCountForHealth(workspaceDir: string): number {
  try {
    return loadFleetPlaybooksFromWorkspace(workspaceDir).length;
  } catch {
    return listBundledFleetPlaybooks().length;
  }
}
