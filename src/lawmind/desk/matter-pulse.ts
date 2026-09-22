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
import { annotateDeskDeadline } from "./deadline-chain.js";
import { loadIntakeBrief } from "./intake-brief.js";
import { classifyMailMessage, MAIL_TRIAGE_LABEL_ZH, type MailTriageLabel } from "./mail-triage.js";
import {
  MATTER_KIND_LABELS,
  parseMatterKind,
  type MatterDocket,
  type MatterKind,
} from "./matter-kind.js";
import { listMatterMaterialFiles, type MatterMaterialListing } from "./matter-materials.js";
import { hydrateMatterParties, type MatterParty } from "./matter-parties.js";

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
  source?: string;
  sourceLabel?: string;
  released?: boolean;
  waitingOnTitle?: string;
  dependsOnDeadlineId?: string;
};

export const MATTER_TIMELINE_CAP = 24;

export type MatterPulseTimelineKind =
  | "deadline"
  | "hearing"
  | "mail"
  | "document"
  | "task"
  | "approval"
  | "intake";

export type MatterPulseTimelineItem = {
  id: string;
  kind: MatterPulseTimelineKind;
  title: string;
  at: string;
  meta?: string;
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
  parties: MatterParty[];
  counts: {
    documents: number;
    tasks: number;
    files: number;
    deadlines: number;
    mail: number;
    approvals: number;
    materials: number;
  };
  daysUntilHearing: number | null;
  documents: MatterPulseDoc[];
  tasks: MatterPulseTask[];
  files: Array<{ label: string }>;
  materials: MatterMaterialListing[];
  mail: MatterPulseMail[];
  deadlines: MatterPulseDeadline[];
  timeline: MatterPulseTimelineItem[];
  nextActions: string[];
  intakeConfirmedAt?: string;
};

const OPEN_TASK = new Set(["rendered", "rejected", "completed"]);

function hasTimestamp(value: string | undefined): value is string {
  return (
    typeof value === "string" && Boolean(value.trim()) && !Number.isNaN(new Date(value).getTime())
  );
}

export function assembleMatterTimeline(input: {
  deadlines: MatterPulseDeadline[];
  mail: MatterPulseMail[];
  documents: MatterPulseDoc[];
  tasks: MatterPulseTask[];
  approvals: Array<{ approvalId: string; reason: string; requestedAt: string }>;
  intakeConfirmedAt?: string;
  cap?: number;
}): MatterPulseTimelineItem[] {
  const cap = input.cap ?? MATTER_TIMELINE_CAP;
  const items: MatterPulseTimelineItem[] = [];
  for (const d of input.deadlines) {
    if (!hasTimestamp(d.dueAt)) {
      continue;
    }
    const hearing = d.eventKind === "hearing";
    const waiting = d.waitingOnTitle?.trim();
    items.push({
      id: `deadline:${d.deadlineId}`,
      kind: hearing ? "hearing" : "deadline",
      title: d.title,
      at: d.dueAt,
      meta: hearing ? "开庭" : waiting ? `等「${waiting}」完成` : "期限",
    });
  }
  for (const msg of input.mail) {
    if (!hasTimestamp(msg.receivedAt)) {
      continue;
    }
    items.push({
      id: `mail:${msg.id}`,
      kind: "mail",
      title: msg.subject,
      at: msg.receivedAt,
      meta: msg.labelZh,
    });
  }
  for (const doc of input.documents) {
    if (!hasTimestamp(doc.at)) {
      continue;
    }
    items.push({
      id: `doc:${doc.id}`,
      kind: "document",
      title: doc.title,
      at: doc.at,
      meta: doc.status,
    });
  }
  const documentTaskIds = new Set(input.documents.map((doc) => doc.id));
  for (const task of input.tasks) {
    if (documentTaskIds.has(task.taskId) || !hasTimestamp(task.updatedAt)) {
      continue;
    }
    items.push({
      id: `task:${task.taskId}`,
      kind: "task",
      title: task.title,
      at: task.updatedAt,
      meta: "任务",
    });
  }
  for (const ap of input.approvals) {
    if (!hasTimestamp(ap.requestedAt)) {
      continue;
    }
    items.push({
      id: `approval:${ap.approvalId}`,
      kind: "approval",
      title: ap.reason,
      at: ap.requestedAt,
      meta: "待拍板",
    });
  }
  if (hasTimestamp(input.intakeConfirmedAt)) {
    items.push({
      id: "intake:confirmed",
      kind: "intake",
      title: "谈话已写入档案",
      at: input.intakeConfirmedAt,
      meta: "收案",
    });
  }
  return items.toSorted((a, b) => b.at.localeCompare(a.at)).slice(0, cap);
}

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
  const pulseTasks = openTasks
    .slice()
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8)
    .map((t) => ({
      taskId: t.taskId,
      title: t.title?.trim() || t.summary,
      status: t.status,
      updatedAt: t.updatedAt,
    }));
  const pulseDeadlines = openDeadlines
    .slice()
    .toSorted((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, 10)
    .map((d) => {
      const view = annotateDeskDeadline(d, deadlines);
      return {
        deadlineId: view.deadlineId,
        title: view.title,
        dueAt: view.dueAt,
        status: view.status,
        eventKind: view.eventKind,
        daysUntil: daysUntilIso(d.dueAt, now),
        source: view.source,
        sourceLabel: view.sourceLabel,
        released: view.released,
        waitingOnTitle: view.waitingOnTitle,
        dependsOnDeadlineId: view.dependsOnDeadlineId,
      };
    });
  const mailSlice = liveMail.slice(0, 8);
  const materials = listMatterMaterialFiles(workspaceDir, matterId);
  const timeline = assembleMatterTimeline({
    deadlines: pulseDeadlines,
    mail: mailSlice,
    documents,
    tasks: pulseTasks,
    approvals,
    intakeConfirmedAt: brief?.confirmedAt,
  });

  return {
    matterId,
    title: rec.title,
    status: rec.status,
    statusLabel: matterStatusLabel(rec.status),
    matterKind: kind,
    matterKindLabel: MATTER_KIND_LABELS[kind],
    clientId: rec.clientId ?? profile.clientIdFromCase,
    counterparty: rec.counterparty ?? profile.counterparty,
    causeOfAction: rec.causeOfAction ?? profile.causeOfAction,
    ownerLawyerId: rec.ownerLawyerId,
    createdAt: rec.createdAt,
    docket: rec.docket,
    parties: hydrateMatterParties({
      parties: rec.parties,
      clientId: rec.clientId ?? profile.clientIdFromCase,
      counterparty: rec.counterparty ?? profile.counterparty,
    }),
    counts: {
      documents: drafts.length,
      tasks: openTasks.length,
      files: files.length,
      deadlines: openDeadlines.length,
      mail: liveMail.length,
      approvals: approvals.length,
      materials: materials.length,
    },
    daysUntilHearing: daysUntilIso(hearingAt, now),
    documents,
    tasks: pulseTasks,
    files,
    materials,
    mail: mailSlice,
    deadlines: pulseDeadlines,
    timeline,
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
