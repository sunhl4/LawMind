/**
 * Today's work snapshot: lawyer plan + mail-to-reply + deadlines + pending approvals.
 */

import {
  listMatterIdsFromStorage,
  loadMatter,
  readApprovals,
  readDeadlines,
} from "../adapters/matter-storage/index.js";
import { listMatterMailMessages } from "../platform/lawyer-automations.js";
import { matchUserStandards } from "../practice/user-standards.js";
import { loadDailyPlan, localDateKey, type DailyPlanItem } from "./daily-plan.js";
import { classifyMailMessage, type MailTriageLabel } from "./mail-triage.js";

export type TodayWorkItemKind = "plan" | "mail" | "deadline" | "approval";

export type TodayWorkItem = {
  id: string;
  kind: TodayWorkItemKind;
  title: string;
  done: boolean;
  matterId?: string;
  dueAt?: string;
  sourceRef?: string;
  mailLabel?: MailTriageLabel;
};

export type TodayWorkSnapshot = {
  date: string;
  items: TodayWorkItem[];
  progress: { done: number; total: number };
};

function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function endOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
}

function isDueTodayOrOverdue(dueAt: string, now: Date): boolean {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return false;
  }
  return due.getTime() <= endOfLocalDay(now).getTime();
}

export function buildTodayWorkSnapshot(workspaceDir: string, now = new Date()): TodayWorkSnapshot {
  const date = localDateKey(now);
  const plan = loadDailyPlan(workspaceDir, date);
  const items: TodayWorkItem[] = plan.items.map((item: DailyPlanItem) => ({
    id: item.id,
    kind: "plan",
    title: item.text,
    done: item.done,
    matterId: item.matterId,
    sourceRef: item.sourceRef,
  }));

  const triageStd = matchUserStandards(workspaceDir, { instruction: "邮件" }, "daily_triage")[0];
  const extraReply = triageStd?.bindWhen.keywords;
  const matterIds = listMatterIdsFromStorage(workspaceDir);
  const seenMail = new Set<string>();
  for (const matterId of matterIds) {
    for (const msg of listMatterMailMessages(workspaceDir, matterId).slice(0, 40)) {
      const label = classifyMailMessage(
        {
          from: msg.from,
          subject: msg.subject,
          bodyText: msg.bodyText,
          attachmentNames: msg.attachments.map((a) => a.name),
        },
        extraReply ? { extraReplyKeywords: extraReply } : undefined,
      );
      if (label !== "needs_reply" && label !== "court") {
        continue;
      }
      const key = `${matterId}:${msg.id}`;
      if (seenMail.has(key)) {
        continue;
      }
      seenMail.add(key);
      const already = plan.items.some(
        (p) => p.source === "mail" && p.sourceRef === msg.id && p.done,
      );
      items.push({
        id: `mail:${key}`,
        kind: "mail",
        title: `${label === "court" ? "法院来件" : "待回复"} · ${msg.subject}`,
        done: already,
        matterId,
        sourceRef: msg.id,
        mailLabel: label,
      });
    }

    const matter = loadMatter(workspaceDir, matterId);
    const title = matter?.title ?? matterId;
    for (const dl of readDeadlines(workspaceDir, matterId)) {
      if (dl.status !== "open" && dl.status !== "snoozed") {
        continue;
      }
      if (!isDueTodayOrOverdue(dl.dueAt, now) && dl.eventKind !== "hearing") {
        continue;
      }
      const due = new Date(dl.dueAt);
      const soonHearing =
        dl.eventKind === "hearing" &&
        !Number.isNaN(due.getTime()) &&
        due.getTime() <= startOfLocalDay(now).getTime() + 3 * 24 * 3600 * 1000;
      if (!isDueTodayOrOverdue(dl.dueAt, now) && !soonHearing) {
        continue;
      }
      items.push({
        id: `deadline:${dl.deadlineId}`,
        kind: "deadline",
        title: `${title} · ${dl.title}`,
        done: false,
        matterId,
        dueAt: dl.dueAt,
        sourceRef: dl.deadlineId,
      });
    }

    for (const ap of readApprovals(workspaceDir, matterId)) {
      if (ap.status !== "pending") {
        continue;
      }
      items.push({
        id: `approval:${ap.approvalId}`,
        kind: "approval",
        title: `待拍板 · ${ap.reason}`.slice(0, 200),
        done: false,
        matterId,
        sourceRef: ap.approvalId,
      });
    }
  }

  const done = items.filter((i) => i.done).length;
  return {
    date,
    items,
    progress: { done, total: items.length },
  };
}
