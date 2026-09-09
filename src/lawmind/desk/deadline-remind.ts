/**
 * Deadline reminder tick: queue 待拍板-style inbox items before dueAt.
 */

import { randomUUID } from "node:crypto";
import {
  listMatterIdsFromStorage,
  loadMatter,
  readDeadlines,
} from "../adapters/matter-storage/index.js";
import { patchDeadline } from "../application/services/deadline-service.js";
import { saveAutomationInboxItem } from "../platform/lawyer-automations.js";
import { defaultRemindBeforeHours } from "./legal-event-extract.js";

export type DeadlineRemindResult = {
  reminded: number;
};

function hoursUntil(dueAt: string, now: Date): number {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  return (due.getTime() - now.getTime()) / 3_600_000;
}

export function processDueDeadlineReminders(
  workspaceDir: string,
  now = new Date(),
): DeadlineRemindResult {
  let reminded = 0;
  for (const matterId of listMatterIdsFromStorage(workspaceDir)) {
    const matter = loadMatter(workspaceDir, matterId);
    const matterTitle = matter?.title ?? matterId;
    for (const dl of readDeadlines(workspaceDir, matterId)) {
      if (dl.status !== "open" && dl.status !== "snoozed") {
        continue;
      }
      if (dl.remindedAt) {
        continue;
      }
      const kind = dl.eventKind ?? "custom";
      const hours = dl.remindBeforeHours ?? defaultRemindBeforeHours(kind);
      const remaining = hoursUntil(dl.dueAt, now);
      if (remaining > hours) {
        continue;
      }
      const patched = patchDeadline(workspaceDir, matterId, dl.deadlineId, {
        remindedAt: now.toISOString(),
      });
      if (!patched) {
        continue;
      }
      saveAutomationInboxItem(workspaceDir, {
        id: randomUUID(),
        automationId: "deadline-remind",
        matterId,
        title: `期限提醒 · ${dl.title}`,
        summary: `${matterTitle}：${dl.title} 将于 ${dl.dueAt} 到期。请到工作台查看或导出日历。`,
        status: "open",
        createdAt: now.toISOString(),
      });
      reminded += 1;
    }
  }
  return { reminded };
}
