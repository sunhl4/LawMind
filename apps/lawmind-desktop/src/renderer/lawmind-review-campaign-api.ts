/**
 * Client for Skills E2 review campaigns / fleet playbooks.
 */

import { apiGetJson, apiSendJson } from "./api-client";
import type {
  ReviewCampaign,
  ReviewCampaignRoleResult,
  FleetPlaybook,
} from "../../../../src/lawmind/review-campaign/types.ts";

export type { ReviewCampaign, ReviewCampaignRoleResult, FleetPlaybook };

export async function apiListFleetPlaybooks(apiBase: string): Promise<{
  ok: boolean;
  playbooks?: Array<{ id: string; label: string; roleCount: number }>;
  error?: string;
}> {
  return apiGetJson(apiBase, "/api/fleet-playbooks");
}

export async function apiCreateReviewCampaign(
  apiBase: string,
  body: {
    matterId?: string | null;
    taskId?: string | null;
    playbookId?: string;
    sourceText?: string;
    idempotencyKey?: string;
    runNow?: boolean;
    preferFast?: boolean;
    preferParallel?: boolean;
  },
): Promise<{ ok: boolean; campaign?: ReviewCampaign; error?: string }> {
  return apiSendJson(apiBase, "/api/review-campaigns", "POST", body);
}

export async function apiGetReviewCampaign(
  apiBase: string,
  campaignId: string,
  matterId?: string | null,
): Promise<{ ok: boolean; campaign?: ReviewCampaign; error?: string }> {
  const q = matterId ? `?matterId=${encodeURIComponent(matterId)}` : "";
  return apiGetJson(apiBase, `/api/review-campaigns/${encodeURIComponent(campaignId)}${q}`);
}

export async function apiGetReviewCampaignByTask(
  apiBase: string,
  taskId: string,
  matterId?: string | null,
): Promise<{ ok: boolean; campaign?: ReviewCampaign; error?: string }> {
  const params = new URLSearchParams({ taskId });
  if (matterId) {
    params.set("matterId", matterId);
  }
  try {
    return await apiGetJson(apiBase, `/api/review-campaigns?${params.toString()}`);
  } catch {
    return { ok: false, error: "not found" };
  }
}

export async function apiRerunCampaignRole(
  apiBase: string,
  campaignId: string,
  roleId: string,
): Promise<{ ok: boolean; campaign?: ReviewCampaign; error?: string }> {
  return apiSendJson(
    apiBase,
    `/api/review-campaigns/${encodeURIComponent(campaignId)}/roles/${encodeURIComponent(roleId)}/rerun`,
    "POST",
    {},
  );
}

export async function apiGetCampaignReport(
  apiBase: string,
  campaignId: string,
): Promise<{ ok: boolean; markdown?: string; error?: string }> {
  return apiGetJson(apiBase, `/api/review-campaigns/${encodeURIComponent(campaignId)}/report`);
}
