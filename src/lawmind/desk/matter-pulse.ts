/**
 * One-matter pulse for the lawyer desk: what is live on this case right now.
 * Sync, no audit scan — tasks, drafts, mail, deadlines, CASE identity.
 */

import fs from "node:fs";
import { loadMatter, readApprovals } from "../adapters/matter-storage/index.js";
import { listDeadlinesForMatter } from "../application/services/deadline-service.js";
import { parseMatterCaseProfileFields } from "../cases/matter-profile.js";
import { listDrafts } from "../drafts/index.js";
import { caseFilePath } from "../memory/case-workspace.js";
import { listMatterMailMessages } from "../platform/lawyer-automations.js";
import { listTaskRecords } from "../tasks/index.js";
import { loadIntakeBrief } from "./intake-brief.js";
import { classifyMailMessage, MAIL_TRIAGE_LABEL_ZH, type MailTriageLabel } from "./mail-triage.js";
import {
  MATTER_KIND_LABELS,
  parseMatterKind,
  type MatterDocket,
  type MatterKind,
} from "./matter-kind.js";

export const MATTER_STATUS_LABELS: Record<string, string> = {
  intake: "收案",
  active: "进行中",
  open: "进行中",
  waiting_on_client: "等客户",
  waiting_on_firm: "等所内",
  under_review: "审查中",
  delivered: "已交付",
  closed: "已结",
};

export function matterStatusLabel(status: string | undefined): string {
  if (!status) {
    return "未标";
  }
  return MATTER_STATUS_LABELS[status] ?? status;
}

export function daysUntilIso(iso: string | undefined, now = new Date()): number | null {
  if (!iso) {
    return null;
  }
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) {
    return null;
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return Math.round((dueDay - start) / 86_400_000);
}

export type MatterPulseDoc = {
  id: string;
  title: string;
  status: string;
  at?: string;
  taskId?: string;
  outputPath?: string;
};

export type MatterPulseTask = {
  taskId: string;
  title: string;
  status: string;
  updatedAt: string;
};

export type MatterPulseMail = {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  label: MailTriageLabel;
  labelZh: string;
};

export type MatterPulseDeadline = {
  deadlineId: string;
  title: string;
  dueAt: string;
  status: string;
  eventKind?: string;
  daysUntil: number | null;
};

export type MatterPulse = {
  matterId: string;
  title: string;
  status: string;
  statusLabel: string;
  matterKind: MatterKind;
  matterKindLabel: string;
  clientId?: string;
  counterparty?: string;
  causeOfAction?: string;
  ownerLawyerId?: string;
  createdAt?: string;
  docket?: MatterDocket;
  counts: {
    documents: number;
    tasks: number;
    files: number;
    deadlines: number;
    mail: number;
    approvals: number;
  };
  daysUntilHearing: number | null;
  documents: MatterPulseDoc[];
  tasks: MatterPulseTask[];
  files: Array<{ label: string }>;
  mail: MatterPulseMail[];
  deadlines: MatterPulseDeadline[];
  nextActions: string[];
  intakeConfirmedAt?: string;
};

const OPEN_TASK = new Set(["rendered", "rejected", "completed"]);

function reviewLabel(status: string | undefined): string {
  if (status === "approved") {
    return "已通过";
  }
  if (status === "rejected") {
    return "已驳回";
  }
  if (status === "modified") {
    return "需修改";
  }
  if (status === "pending") {
    return "待审核";
  }
  return "已出稿";
}

function readCaseMemory(workspaceDir: string, matterId: string): string {
  try {
    return fs.readFileSync(caseFilePath(workspaceDir, matterId), "utf8");
  } catch {
    return "";
  }
}

function extractDashSection(content: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\n\\n([\\s\\S]*?)(?:\\n##\\s+\\d+\\.|$)`);
  const match = pattern.exec(content);
  if (!match) {
    return [];
  }
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*(\[[^\]]+\]\s*)?/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function buildMatterPulse(
  workspaceDir: string,
  matterId: string,
  now = new Date(),
): MatterPulse | null {
  const rec = loadMatter(workspaceDir, matterId);
  if (!rec) {
    return null;
  }
  const kind = parseMatterKind(rec.matterKind);
  const caseMemory = readCaseMemory(workspaceDir, matterId);
  const profile = parseMatterCaseProfileFields(caseMemory);
  const deadlines = listDeadlinesForMatter(workspaceDir, matterId);
  const openDeadlines = deadlines.filter((d) => d.status === "open" || d.status === "snoozed");
  const hearing = openDeadlines.find((d) => d.eventKind === "hearing");
  const hearingAt = hearing?.dueAt ?? rec.docket?.hearingAt ?? profile.hearingAt;
  const tasks = listTaskRecords(workspaceDir).filter((t) => t.matterId === matterId);
  const openTasks = tasks.filter((t) => !OPEN_TASK.has(t.status));
  const drafts = listDrafts(workspaceDir).filter((d) => d.matterId === matterId);
  const mail = listMatterMailMessages(workspaceDir, matterId).slice(0, 40);
  const liveMail: MatterPulseMail[] = [];
  for (const msg of mail) {
    const label = classifyMailMessage({
      from: msg.from,
      subject: msg.subject,
      bodyText: msg.bodyText,
      attachmentNames: msg.attachments.map((a) => a.name),
    });
    if (label !== "needs_reply" && label !== "court" && label !== "contract") {
      continue;
    }
    liveMail.push({
      id: msg.id,
      subject: msg.subject,
      from: msg.from,
      receivedAt: msg.receivedAt,
      label,
      labelZh: MAIL_TRIAGE_LABEL_ZH[label],
    });
  }
  const approvals = readApprovals(workspaceDir, matterId).filter((a) => a.status === "pending");
  const brief = loadIntakeBrief(workspaceDir, matterId);
  const files = [
    ...extractDashSection(caseMemory, "## 9. 生成产物").map((label) => ({ label })),
    ...drafts.filter((d) => d.outputPath?.trim()).map((d) => ({ label: d.outputPath!.trim() })),
  ].slice(0, 12);
  const documents: MatterPulseDoc[] = drafts
    .slice()
    .toSorted((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 12)
    .map((d) => ({
      id: d.taskId,
      title: d.title || "未命名文书",
      status: reviewLabel(d.reviewStatus),
      at: d.reviewedAt ?? d.createdAt,
      taskId: d.taskId,
      outputPath: d.outputPath,
    }));
  const nextActions = [
    ...(brief?.nextActions ?? []),
    ...openTasks.slice(0, 4).map((t) => t.title?.trim() || t.summary),
  ]
    .filter(Boolean)
    .slice(0, 8);

  return {
    matterId,
    title: rec.title,
    status: rec.status,
    statusLabel: matterStatusLabel(rec.status),
    matterKind: kind,
    matterKindLabel: MATTER_KIND_LABELS[kind],
    clientId: rec.clientId ?? profile.clientIdFromCase,
    counterparty: profile.counterparty,
    causeOfAction: profile.causeOfAction,
    ownerLawyerId: rec.ownerLawyerId,
    createdAt: rec.createdAt,
    docket: rec.docket,
    counts: {
      documents: drafts.length,
      tasks: openTasks.length,
      files: files.length,
      deadlines: openDeadlines.length,
      mail: liveMail.length,
      approvals: approvals.length,
    },
    daysUntilHearing: daysUntilIso(hearingAt, now),
    documents,
    tasks: openTasks
      .slice()
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8)
      .map((t) => ({
        taskId: t.taskId,
        title: t.title?.trim() || t.summary,
        status: t.status,
        updatedAt: t.updatedAt,
      })),
    files,
    mail: liveMail.slice(0, 8),
    deadlines: openDeadlines
      .slice()
      .toSorted((a, b) => a.dueAt.localeCompare(b.dueAt))
      .slice(0, 10)
      .map((d) => ({
        deadlineId: d.deadlineId,
        title: d.title,
        dueAt: d.dueAt,
        status: d.status,
        eventKind: d.eventKind,
        daysUntil: daysUntilIso(d.dueAt, now),
      })),
    nextActions,
    intakeConfirmedAt: brief?.confirmedAt,
  };
}

export function hearingCountdownLabel(days: number | null): string {
  if (days === null) {
    return "未排开庭";
  }
  if (days < 0) {
    return `开庭已过 ${-days} 天`;
  }
  if (days === 0) {
    return "今天开庭";
  }
  return `还有 ${days} 天开庭`;
}
