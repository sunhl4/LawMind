/**
 * Ensure a mail automation exists for the matter and PATCH runNow.
 */

import { apiGetJson, apiSendJson } from "./api-client";

export type AutomationListItem = {
  id: string;
  presetId?: string;
  matterId?: string;
  title?: string;
  enabled?: boolean;
};

/** Chat/mail short path: one-shot, never a recurring interval. */
export function mailShortPathCreateSchedule(now: Date = new Date()): {
  kind: "once";
  runAt: string;
} {
  return { kind: "once", runAt: now.toISOString() };
}

export async function runMailAutomationNow(opts: {
  apiBase: string;
  matterId: string;
  presetId: "mail-contract-review" | "mail-inbox-digest";
}): Promise<{ automationId: string }> {
  const matterId = opts.matterId.trim();
  if (!matterId) {
    throw new Error("请先选择案件，再跑邮件短路径。");
  }
  const listed = await apiGetJson<{ ok?: boolean; automations?: AutomationListItem[] }>(
    opts.apiBase,
    "/api/automations",
  );
  const automations = Array.isArray(listed.automations) ? listed.automations : [];
  let automation = automations.find(
    (a) => a.presetId === opts.presetId && a.matterId === matterId,
  );
  if (!automation?.id) {
    const created = await apiSendJson<
      { ok?: boolean; automation?: AutomationListItem },
      { presetId: string; matterId: string; schedule: { kind: "once"; runAt: string } }
    >(opts.apiBase, "/api/automations", "POST", {
      presetId: opts.presetId,
      matterId,
      schedule: mailShortPathCreateSchedule(),
    });
    automation = created.automation;
  }
  if (!automation?.id) {
    throw new Error("无法创建交办任务。");
  }
  await apiSendJson(opts.apiBase, `/api/automations/${encodeURIComponent(automation.id)}`, "PATCH", {
    runNow: true,
    enabled: true,
  });
  return { automationId: automation.id };
}
