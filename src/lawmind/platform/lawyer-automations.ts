/**
 * Lawyer Automations — recurring scheduled tasks (Cursor Automations analogue).
 * Persist under `lawmind/automations/`; results queue under `lawmind/automation-inbox/`.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { ensureDocxForAttachment } from "../mail/convert-to-docx.js";
import { sanitizeMailMessageIdForPath } from "../mail/imap-client.js";
import {
  classifyContractAttachment,
  isReviewableContractAttachment,
  isTrackedWordAttachment,
  type ContractAttachmentKind,
} from "../mail/mail-contract-formats.js";
import {
  inferAutomationFromInstruction,
  type AutomationPresetId,
} from "./infer-automation-from-instruction.js";
import { buildMailContractShortPathInstruction } from "./mail-contract-short-path-instruction.js";

export { buildMailContractShortPathInstruction } from "./mail-contract-short-path-instruction.js";
export {
  inferAutomationFromInstruction,
  type AutomationPresetId,
} from "./infer-automation-from-instruction.js";

export type AutomationScheduleKind = "daily" | "weekly" | "once" | "interval";

export type AutomationSchedule =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "once"; runAt: string }
  /** Recurring poll: every N minutes (clamped 5…10080). */
  | { kind: "interval"; everyMinutes: number };

/** Min/max for interval schedules (minutes). */
export const AUTOMATION_INTERVAL_MIN_MINUTES = 5;
export const AUTOMATION_INTERVAL_MAX_MINUTES = 7 * 24 * 60;

export type LawyerAutomation = {
  id: string;
  title: string;
  enabled: boolean;
  presetId: AutomationPresetId;
  /** Collaboration workflow template id when applicable. */
  templateId?: string;
  matterId: string;
  /** Custom natural-language instruction (preset custom or extra hint). */
  instruction?: string;
  schedule: AutomationSchedule;
  nextRunAt: string;
  lastRunAt?: string;
  lastJobId?: string;
  lastResultSummary?: string;
  /** 最近一次运行失败的结构化错误码（runner 兜底写入）。 */
  lastErrorCode?: string;
  /** 最近一次运行失败的截断错误消息（runner 兜底写入）。 */
  lastErrorMessage?: string;
  allowSendEmailAfterApproval: boolean;
  /** Client / outbound recipient for approve-send (never a placeholder). */
  notifyEmail?: string;
  createdAt: string;
  updatedAt: string;
};

export type AutomationInboxItem = {
  id: string;
  automationId: string;
  matterId: string;
  title: string;
  summary: string;
  status:
    | "open"
    | "acknowledged"
    | "approved_send"
    /** 已批准并远程发出成功。 */
    | "sent_remote"
    /** 已批准但远程发信失败，仅落本地 sent 归档。 */
    | "approved_local_only"
    | "dismissed";
  createdAt: string;
  /** Optional draft / job / mail paths for follow-up. */
  draftTaskId?: string;
  jobId?: string;
  mailMessageIds?: string[];
  /** Pending outbound mail after lawyer approval (P3). */
  pendingSend?: {
    to: string;
    subject: string;
    body: string;
    /** Workspace-relative paths (e.g. artifacts/….tracked.docx); sent only after approve_send. */
    attachmentRelativePaths?: string[];
  };
};

export type AutomationPresetMeta = {
  id: AutomationPresetId;
  title: string;
  description: string;
  templateId?: string;
  needsMail: boolean;
  defaultSchedule: AutomationSchedule;
  defaultAllowSend: boolean;
};

export const AUTOMATION_PRESETS: AutomationPresetMeta[] = [
  {
    id: "renewal-monitor",
    title: "合同续签盯梢",
    description: "按设定周期扫描本案合同到期与续签条款，把提醒推给你拍板。",
    templateId: "renewal-monitor",
    needsMail: false,
    defaultSchedule: { kind: "weekly", weekday: 1, hour: 9, minute: 0 },
    defaultAllowSend: false,
  },
  {
    id: "client-weekly-update",
    title: "客户进展周报",
    description: "每周起草给客户的进展备忘；默认只进拍板，批准后再发信。",
    templateId: "client-update-memo",
    needsMail: false,
    defaultSchedule: { kind: "weekly", weekday: 1, hour: 10, minute: 0 },
    defaultAllowSend: true,
  },
  {
    id: "mail-inbox-digest",
    title: "邮箱收件整理",
    description: "按设定间隔读取本案邮件匣，整理要点与附件清单，推送到待我拍板。",
    needsMail: true,
    defaultSchedule: { kind: "interval", everyMinutes: 30 },
    defaultAllowSend: false,
  },
  {
    id: "mail-contract-review",
    title: "邮件合同审阅改稿",
    description:
      "同步邮件附件后走短路径改稿（约 4–8 步：分析→最小改→审阅痕迹→待拍板），勿在对话里反复搜案卷。Word 原件直接痕迹；其它格式意见书。批准后方可外发。",
    templateId: "mail-contract-redline",
    needsMail: true,
    defaultSchedule: { kind: "interval", everyMinutes: 30 },
    defaultAllowSend: false,
  },
  {
    id: "custom",
    title: "自定义交办",
    description: "用一句话交代要办的事（适合律师习惯，无需写脚本）。",
    needsMail: false,
    defaultSchedule: { kind: "daily", hour: 9, minute: 0 },
    defaultAllowSend: false,
  },
];

export function automationsDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "automations");
}

export function automationInboxDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "automation-inbox");
}

export function matterMailInboxDir(workspaceDir: string, matterId: string): string {
  return path.join(path.resolve(workspaceDir), "cases", matterId, "mail", "inbox");
}

export function matterMailSentDir(workspaceDir: string, matterId: string): string {
  return path.join(path.resolve(workspaceDir), "cases", matterId, "mail", "sent");
}

export function matterMailOutboxDir(workspaceDir: string, matterId: string): string {
  return path.join(path.resolve(workspaceDir), "cases", matterId, "mail", "outbox");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function clampHour(n: number): number {
  if (!Number.isFinite(n)) {
    return 9;
  }
  return Math.min(23, Math.max(0, Math.floor(n)));
}

function clampMinute(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(59, Math.max(0, Math.floor(n)));
}

export function clampEveryMinutes(n: number): number {
  if (!Number.isFinite(n)) {
    return 30;
  }
  return Math.min(
    AUTOMATION_INTERVAL_MAX_MINUTES,
    Math.max(AUTOMATION_INTERVAL_MIN_MINUTES, Math.floor(n)),
  );
}

/** Next run after `from` for a schedule (local wall clock). */
export function computeNextRunAt(schedule: AutomationSchedule, from: Date = new Date()): string {
  if (schedule.kind === "once") {
    const t = Date.parse(schedule.runAt);
    if (!Number.isFinite(t)) {
      return new Date(from.getTime() + 86_400_000).toISOString();
    }
    return new Date(Math.max(t, from.getTime() + 1000)).toISOString();
  }

  if (schedule.kind === "interval") {
    const mins = clampEveryMinutes(schedule.everyMinutes);
    return new Date(from.getTime() + mins * 60_000).toISOString();
  }

  const hour = clampHour(schedule.hour);
  const minute = clampMinute(schedule.minute);
  const cursor = new Date(from.getTime());

  const atLocal = (d: Date): Date => {
    const x = new Date(d);
    x.setSeconds(0, 0);
    x.setHours(hour, minute, 0, 0);
    return x;
  };

  if (schedule.kind === "daily") {
    let candidate = atLocal(cursor);
    if (candidate.getTime() <= from.getTime()) {
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      candidate = atLocal(next);
    }
    return candidate.toISOString();
  }

  const weekday = ((schedule.weekday % 7) + 7) % 7;
  for (let i = 0; i < 8; i += 1) {
    const d = new Date(cursor);
    d.setDate(d.getDate() + i);
    if (d.getDay() !== weekday) {
      continue;
    }
    const candidate = atLocal(d);
    if (candidate.getTime() > from.getTime()) {
      return candidate.toISOString();
    }
  }
  const fallback = new Date(cursor);
  fallback.setDate(fallback.getDate() + 7);
  return atLocal(fallback).toISOString();
}

export function listAutomations(workspaceDir: string): LawyerAutomation[] {
  const dir = automationsDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: LawyerAutomation[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as LawyerAutomation;
      if (raw?.id && raw.matterId && raw.schedule) {
        out.push(raw);
      }
    } catch {
      /* skip */
    }
  }
  return out.toSorted((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
}

export function getAutomation(workspaceDir: string, id: string): LawyerAutomation | null {
  const file = path.join(automationsDir(workspaceDir), `${id}.json`);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as LawyerAutomation;
  } catch {
    return null;
  }
}

/** Atomically claim a due automation so desktop + lawmindd cannot double-fire. */
export function claimDueAutomation(
  workspaceDir: string,
  id: string,
  now: Date = new Date(),
): LawyerAutomation | null {
  const file = path.join(automationsDir(workspaceDir), `${id}.json`);
  if (!fs.existsSync(file)) {
    return null;
  }
  return withExclusiveFileLock(`${file}.lock`, () => {
    let current: LawyerAutomation;
    try {
      current = JSON.parse(fs.readFileSync(file, "utf8")) as LawyerAutomation;
    } catch {
      return null;
    }
    if (!current?.enabled || Date.parse(current.nextRunAt) > now.getTime()) {
      return null;
    }
    const claimed: LawyerAutomation = {
      ...current,
      nextRunAt: new Date(now.getTime() + 3_600_000).toISOString(),
      updatedAt: now.toISOString(),
    };
    writeJsonAtomic(file, claimed);
    return current;
  });
}

export function saveAutomation(workspaceDir: string, automation: LawyerAutomation): void {
  const dir = automationsDir(workspaceDir);
  ensureDir(dir);
  const file = path.join(dir, `${automation.id}.json`);
  withExclusiveFileLock(`${file}.lock`, () => {
    writeJsonAtomic(file, automation);
  });
}

export function deleteAutomation(workspaceDir: string, id: string): boolean {
  const file = path.join(automationsDir(workspaceDir), `${id}.json`);
  if (!fs.existsSync(file)) {
    return false;
  }
  fs.unlinkSync(file);
  return true;
}

export type CreateAutomationInput = {
  title?: string;
  presetId: AutomationPresetId;
  matterId: string;
  instruction?: string;
  schedule?: AutomationSchedule;
  enabled?: boolean;
  allowSendEmailAfterApproval?: boolean;
  notifyEmail?: string;
};

/** First plausible email in free text, or undefined. Rejects example.com placeholders. */
export function extractNotifyEmail(text: string | undefined): string | undefined {
  const raw = text?.trim() ?? "";
  if (!raw) {
    return undefined;
  }
  const m = raw.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  const email = m?.[0]?.toLowerCase();
  if (!email || email.endsWith("@example.com") || email.endsWith(".example")) {
    return undefined;
  }
  return email;
}

export function sanitizeNotifyEmail(raw: string | undefined): string | undefined {
  const t = raw?.trim().toLowerCase() ?? "";
  if (!t || !/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(t)) {
    return undefined;
  }
  if (t.endsWith("@example.com") || t.endsWith(".example")) {
    return undefined;
  }
  return t;
}

export function createAutomation(
  workspaceDir: string,
  input: CreateAutomationInput,
  now: Date = new Date(),
): LawyerAutomation {
  const preset = AUTOMATION_PRESETS.find((p) => p.id === input.presetId) ?? AUTOMATION_PRESETS[4];
  const rawSchedule = input.schedule ?? preset.defaultSchedule;
  const schedule: AutomationSchedule =
    rawSchedule.kind === "interval"
      ? { kind: "interval", everyMinutes: clampEveryMinutes(rawSchedule.everyMinutes) }
      : rawSchedule;
  const id = randomUUID();
  const notifyEmail =
    sanitizeNotifyEmail(input.notifyEmail) || extractNotifyEmail(input.instruction);
  // Interval jobs: first fire soon (next local-server tick), then every N minutes.
  const nextRunAt =
    schedule.kind === "interval"
      ? new Date(now.getTime() + 1000).toISOString()
      : computeNextRunAt(schedule, now);
  const automation: LawyerAutomation = {
    id,
    title: input.title?.trim() || preset.title,
    enabled: input.enabled !== false,
    presetId: preset.id,
    templateId: preset.templateId,
    matterId: input.matterId.trim(),
    instruction: input.instruction?.trim() || undefined,
    schedule,
    nextRunAt,
    allowSendEmailAfterApproval: input.allowSendEmailAfterApproval ?? preset.defaultAllowSend,
    notifyEmail,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  saveAutomation(workspaceDir, automation);
  return automation;
}

export function listOpenAutomationInbox(
  workspaceDir: string,
  matterId?: string,
): AutomationInboxItem[] {
  const dir = automationInboxDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: AutomationInboxItem[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const item = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as AutomationInboxItem;
      if (item.status !== "open") {
        continue;
      }
      if (matterId && item.matterId !== matterId) {
        continue;
      }
      out.push(item);
    } catch {
      /* skip */
    }
  }
  return out.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveAutomationInboxItem(workspaceDir: string, item: AutomationInboxItem): void {
  const dir = automationInboxDir(workspaceDir);
  ensureDir(dir);
  const file = path.join(dir, `${item.id}.json`);
  withExclusiveFileLock(`${file}.lock`, () => {
    writeJsonAtomic(file, item);
  });
}

export function getAutomationInboxItem(
  workspaceDir: string,
  id: string,
): AutomationInboxItem | null {
  const file = path.join(automationInboxDir(workspaceDir), `${id}.json`);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as AutomationInboxItem;
  } catch {
    return null;
  }
}

export type LocalMailMessage = {
  id: string;
  from: string;
  to: string;
  subject: string;
  receivedAt: string;
  bodyText: string;
  attachments: Array<{ name: string; relativePath?: string }>;
};

/** Read local matter mailbox JSON messages (P2 connector stub / drop-folder). */
export function listMatterMailMessages(workspaceDir: string, matterId: string): LocalMailMessage[] {
  const dir = matterMailInboxDir(workspaceDir, matterId);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: LocalMailMessage[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(dir, name), "utf8"),
      ) as Partial<LocalMailMessage>;
      if (!raw.subject && !raw.bodyText) {
        continue;
      }
      out.push({
        id: raw.id?.trim() || name.replace(/\.json$/i, ""),
        from: raw.from?.trim() || "unknown",
        to: raw.to?.trim() || "",
        subject: raw.subject?.trim() || "(无主题)",
        receivedAt: raw.receivedAt?.trim() || new Date(0).toISOString(),
        bodyText: raw.bodyText?.trim() || "",
        attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
      });
    } catch {
      /* skip */
    }
  }
  return out.toSorted((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function writeMatterMailMessage(
  workspaceDir: string,
  matterId: string,
  message: LocalMailMessage,
): void {
  const dir = matterMailInboxDir(workspaceDir, matterId);
  ensureDir(dir);
  // 文件名用消毒后的 id（Graph id 含 / 等字符）；JSON 内保留原始 id 供展示与对账。
  fs.writeFileSync(
    path.join(dir, `${sanitizeMailMessageIdForPath(message.id)}.json`),
    `${JSON.stringify(message, null, 2)}\n`,
    "utf8",
  );
}

export type OutboundMailPayload = {
  to: string;
  subject: string;
  body: string;
  attachmentRelativePaths?: string[];
};

export function queueOutboundMail(
  workspaceDir: string,
  matterId: string,
  mail: OutboundMailPayload,
): string {
  const dir = matterMailOutboxDir(workspaceDir, matterId);
  ensureDir(dir);
  const id = randomUUID();
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    `${JSON.stringify({ id, ...mail, status: "pending_approval", createdAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  return id;
}

/** After lawyer approval: move outbox → sent (local send simulation). */
export function commitOutboundMail(
  workspaceDir: string,
  matterId: string,
  mail: OutboundMailPayload,
): string {
  const dir = matterMailSentDir(workspaceDir, matterId);
  ensureDir(dir);
  const id = randomUUID();
  const payload = {
    id,
    ...mail,
    status: "sent",
    sentAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return id;
}

/** Matter-relative attachment path → workspace-relative `cases/<matterId>/…`. */
export function toWorkspaceMailAttachmentPath(
  matterId: string,
  matterRelativePath: string | undefined,
  fileName: string,
): string | undefined {
  const mid = matterId.trim();
  if (!mid) {
    return undefined;
  }
  const rel = (matterRelativePath ?? "").trim().replace(/\\/g, "/");
  if (rel && !rel.includes("..") && !path.isAbsolute(rel)) {
    return path.posix.join("cases", mid, rel);
  }
  const name = fileName.trim().replace(/\\/g, "/");
  if (!name || name.includes("..") || name.includes("/")) {
    return undefined;
  }
  return path.posix.join("cases", mid, "mail", "attachments", name);
}

export type MailContractAttachmentRef = {
  name: string;
  /** Workspace-relative path of the original attachment. */
  workspaceRelativePath: string;
  messageId: string;
  from: string;
  subject: string;
  kind: ContractAttachmentKind;
};

/** tracked = Word 审阅痕迹；opinion = PDF/图片/未能转换的旧格式 → 意见书级审查. */
export type MailContractReviewMode = "tracked" | "opinion";

export type MailContractReviewBuild = {
  summary: string;
  attachmentNames: string[];
  /** Prefer first entry as default baseline (newest mail, best format). */
  attachmentRefs: MailContractAttachmentRef[];
  reviewMode: MailContractReviewMode;
  /**
   * Workspace-relative Word path (.doc/.docx) for contract_edit_baseline_path.
   */
  preferredBaselinePath?: string;
  /** Original preferred attachment (any supported format). */
  preferredSourcePath?: string;
  /** Reply hint from newest message with a contract attachment. */
  replyToEmail?: string;
  workflowInstruction: string;
};

/** Extract bare email from `Name <a@b.com>` or plain address. */
export function extractEmailAddress(fromOrTo: string): string | undefined {
  const angle = fromOrTo.match(/<([^>]+@[^>]+)>/);
  if (angle?.[1]) {
    return angle[1].trim().toLowerCase();
  }
  const bare = fromOrTo.trim().match(/^[^\s<>]+@[^\s<>]+$/);
  return bare ? bare[0].toLowerCase() : undefined;
}

function pickPreferredContractRef(
  refs: MailContractAttachmentRef[],
): MailContractAttachmentRef | undefined {
  return (
    refs.find((r) => r.kind === "tracked_word") ??
    refs.find((r) => r.kind === "convertible_word") ??
    refs.find((r) => r.kind === "analyzable") ??
    refs[0]
  );
}

function buildMailBlocksForRefs(
  messages: LocalMailMessage[],
  matterId: string,
  refs: MailContractAttachmentRef[],
): string {
  const msgIds = new Set(refs.map((r) => r.messageId));
  return messages
    .filter((m) => msgIds.has(m.id))
    .slice(0, 5)
    .map((m, i) => {
      const body = (m.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
      const attLines = m.attachments
        .filter(
          (a) =>
            isReviewableContractAttachment(a.name) ||
            isReviewableContractAttachment(a.relativePath ?? ""),
        )
        .map((a) => {
          const p = toWorkspaceMailAttachmentPath(matterId, a.relativePath, a.name);
          const kind = classifyContractAttachment(a.name);
          return p ? `  - \`${p}\`（${a.name} · ${kind}）` : `  - ${a.name}（${kind}）`;
        })
        .join("\n");
      return [
        `### 邮件 ${i + 1}`,
        `- 发件人：${m.from}`,
        `- 主题：${m.subject}`,
        `- 时间：${m.receivedAt}`,
        `- 正文摘要：${body || "（无正文）"}`,
        `- 合同类附件：`,
        attLines || "  - （无）",
      ].join("\n");
    })
    .join("\n\n");
}

function buildTrackedWorkflowInstruction(params: {
  matterId: string;
  preferredBaselinePath?: string;
  replyToEmail?: string;
  mailBlocks: string;
}): string {
  if (params.preferredBaselinePath?.trim()) {
    return buildMailContractShortPathInstruction({
      matterId: params.matterId,
      preferredBaselinePath: params.preferredBaselinePath.trim(),
      replyToEmail: params.replyToEmail,
      mailBlocks: params.mailBlocks,
    });
  }
  return [
    "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】",
    `matterId=\`${params.matterId.trim()}\``,
    params.replyToEmail ? `建议回复收件人：${params.replyToEmail}` : "",
    "",
    "## 相关邮件与附件（路径已给出，勿再检索）",
    params.mailBlocks,
    "",
    "## 执行约束",
    "- 勿 `search_workspace` / `search_matter` / `read_project_file` / `list_templates` / `get_matter_summary`；勿再问审查重点/己方立场。",
    "- `analyze_document` 一次且通读全文与批注/对方修订。",
    "- **最小修改（跨度硬门禁·条数不限）**：落改用 `apply_surgical_edits`（附 `craft_check`）。能改几个字就只改几个字；段内只改有问题的句子；含句读 find≤12 字。",
    "- 整句/整段删写会被硬门禁跳过；勿整节重写进 `update_draft.sections`。其余争点 deferred。",
    "- `redlinePending=0` 不得 `render_tracked_draft`。",
    "",
    "## 按序执行",
    "1. redline：`analyze_document` → `draft_document`/`update_draft`（`contract_edit_baseline_path` + `seed_sections_from_baseline=true`）→ `apply_surgical_edits`（最短字/词锚定）→ `render_tracked_draft` 写入源文件同目录（原名_日期_01.docx，不打开 Word）。勿另开完整意见书流程。",
    "2. handoff：`prepare_outbound_mail`（to=对方邮箱，附件=上一步路径）；不要 `send_email`。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildOpinionWorkflowInstruction(params: {
  matterId: string;
  preferredSourcePath?: string;
  replyToEmail?: string;
  mailBlocks: string;
}): string {
  return [
    "【邮件合同审阅 · 意见书短路径（非 Word（.doc/.docx）原件）】",
    `matterId=\`${params.matterId.trim()}\``,
    params.preferredSourcePath ? `默认分析附件：\`${params.preferredSourcePath}\`` : "",
    params.replyToEmail ? `建议回复收件人：${params.replyToEmail}` : "",
    "",
    "## 相关邮件与附件（路径已给出，勿再检索）",
    params.mailBlocks,
    "",
    "## 执行约束",
    "- 路径已钉选：勿再 `search_workspace` / `search_matter` / `read_project_file` / `list_templates`。",
    "- `analyze_document` 通读默认附件（通常 1 次即可）。",
    "- 质量按 Opinion Craft：覆盖完整、可追溯、缓办诚实；勿空摘要交差。",
    "- 外发须 `prepare_outbound_mail` 待拍板；勿 `send_email`。",
    "",
    "## Opinion Craft（指针）",
    "通读附件后输出可核验意见书（结论/风险/建议）；缓办须写理由；禁止臆造法条；勿空摘要交差。",
    "",
    "## 按序执行",
    "1. opinion：`analyze_document`(默认附件) → `draft_document`（`contract.review`：结论/风险/修改建议）。",
    "2. handoff：`prepare_outbound_mail`（附件=意见书路径）；不要 `send_email`。",
  ]
    .filter(Boolean)
    .join("\n");
}

function finalizeMailContractReviewBuild(
  matterId: string,
  messages: LocalMailMessage[],
  refs: MailContractAttachmentRef[],
  overrides?: {
    reviewMode?: MailContractReviewMode;
    preferredBaselinePath?: string;
    preferredSourcePath?: string;
    convertNote?: string;
  },
): MailContractReviewBuild {
  const preferred = pickPreferredContractRef(refs);
  const preferredSourcePath = overrides?.preferredSourcePath ?? preferred?.workspaceRelativePath;
  let reviewMode: MailContractReviewMode = overrides?.reviewMode ?? "opinion";
  if (!overrides?.reviewMode) {
    if (overrides?.preferredBaselinePath || preferred?.kind === "tracked_word") {
      reviewMode = "tracked";
    } else if (preferred?.kind === "convertible_word") {
      reviewMode = "tracked";
    } else {
      reviewMode = "opinion";
    }
  }
  if (overrides?.preferredBaselinePath) {
    reviewMode = "tracked";
  }

  const preferredBaselinePath =
    overrides?.preferredBaselinePath ??
    (preferred?.kind === "tracked_word" ? preferred.workspaceRelativePath : undefined);
  const replyToEmail = extractEmailAddress(preferred?.from ?? "");
  const mailBlocks = buildMailBlocksForRefs(messages, matterId, refs);

  const kindLabel = (k: ContractAttachmentKind) =>
    k === "tracked_word"
      ? "Word(.doc/.docx)"
      : k === "convertible_word"
        ? "其他文字格式(wps/rtf/odt)"
        : k === "analyzable"
          ? "PDF/图片/文本"
          : "其他";

  const modeLine =
    reviewMode === "tracked"
      ? "将启动「邮件合同审阅改稿」工作流（最小修改 + 原文件审阅痕迹）。"
      : "将启动「邮件合同审阅」工作流（意见书级审查；原件非 Word，不做审阅痕迹）。";

  const summary = [
    `发现 ${refs.length} 个合同类附件，${modeLine}`,
    ...refs.map(
      (r, i) => `${i + 1}. \`${r.workspaceRelativePath}\`（${kindLabel(r.kind)}）← ${r.subject}`,
    ),
    "",
    overrides?.convertNote ?? "",
    preferredBaselinePath
      ? `默认 Word 基线：\`${preferredBaselinePath}\``
      : preferredSourcePath
        ? `默认分析附件：\`${preferredSourcePath}\``
        : "",
    "完成后请在文书台签批；批准发送前不会对外发信。",
  ]
    .filter(Boolean)
    .join("\n");

  const workflowInstruction =
    reviewMode === "tracked"
      ? buildTrackedWorkflowInstruction({
          matterId,
          preferredBaselinePath: preferredBaselinePath ?? preferredSourcePath,
          replyToEmail,
          mailBlocks,
        })
      : buildOpinionWorkflowInstruction({
          matterId,
          preferredSourcePath,
          replyToEmail,
          mailBlocks,
        });

  return {
    summary,
    attachmentNames: refs.map((r) => r.name),
    attachmentRefs: refs,
    reviewMode,
    preferredBaselinePath,
    preferredSourcePath,
    replyToEmail,
    workflowInstruction,
  };
}

export function buildMailContractReviewSummary(
  messages: LocalMailMessage[],
  matterId: string,
): MailContractReviewBuild {
  const empty: MailContractReviewBuild = {
    summary:
      "未发现带合同附件的邮件。请确认对方已发来 PDF/Word/图片等文件，或到「交办 → 邮箱配置」重新同步。",
    attachmentNames: [],
    attachmentRefs: [],
    reviewMode: "opinion",
    workflowInstruction: "",
  };
  const refs: MailContractAttachmentRef[] = [];
  for (const m of messages) {
    for (const att of m.attachments) {
      if (
        !isReviewableContractAttachment(att.name) &&
        !isReviewableContractAttachment(att.relativePath ?? "")
      ) {
        continue;
      }
      const workspaceRelativePath = toWorkspaceMailAttachmentPath(
        matterId,
        att.relativePath,
        att.name,
      );
      if (!workspaceRelativePath) {
        continue;
      }
      const kind = classifyContractAttachment(att.name || workspaceRelativePath);
      if (kind === "other") {
        continue;
      }
      refs.push({
        name: att.name,
        workspaceRelativePath,
        messageId: m.id,
        from: m.from,
        subject: m.subject,
        kind,
      });
    }
  }
  if (refs.length === 0) {
    const names = messages.flatMap((m) => m.attachments.map((a) => a.name));
    if (names.length === 0) {
      return empty;
    }
    return {
      summary: [
        `发现 ${names.length} 个附件，但无一为可审阅合同格式（Word/PDF/图片等）：`,
        ...names.map((n, i) => `${i + 1}. ${n}`),
        "",
        "请对方提供 .docx / .doc / .pdf 或清晰扫描件图片，或在对话中手动交办审查。",
      ].join("\n"),
      attachmentNames: names,
      attachmentRefs: [],
      reviewMode: "opinion",
      workflowInstruction: "",
    };
  }

  return finalizeMailContractReviewBuild(matterId, messages, refs);
}

/**
 * Convert .doc/.wps/… to sibling .docx when possible, then rebuild instructions.
 * Call from the automation runner before enqueueing the workflow.
 */
export async function materializeMailContractReviewBaselines(
  workspaceDir: string,
  messages: LocalMailMessage[],
  matterId: string,
  built: MailContractReviewBuild,
): Promise<MailContractReviewBuild> {
  if (built.attachmentRefs.length === 0) {
    return built;
  }
  const preferred =
    built.attachmentRefs.find((r) => r.workspaceRelativePath === built.preferredSourcePath) ??
    pickPreferredContractRef(built.attachmentRefs);
  if (!preferred) {
    return built;
  }

  // .doc / .docx are first-class baselines — no conversion step.
  if (
    isTrackedWordAttachment(preferred.workspaceRelativePath) ||
    preferred.kind === "tracked_word"
  ) {
    return finalizeMailContractReviewBuild(matterId, messages, built.attachmentRefs, {
      reviewMode: "tracked",
      preferredBaselinePath: preferred.workspaceRelativePath,
      preferredSourcePath: preferred.workspaceRelativePath,
    });
  }

  if (preferred.kind === "convertible_word") {
    const converted = await ensureDocxForAttachment(workspaceDir, preferred.workspaceRelativePath);
    if (converted.ok) {
      return finalizeMailContractReviewBuild(matterId, messages, built.attachmentRefs, {
        reviewMode: "tracked",
        preferredBaselinePath: converted.relativePath,
        preferredSourcePath: preferred.workspaceRelativePath,
        convertNote: converted.converted
          ? converted.fidelity === "lossy"
            ? `已将 \`${preferred.workspaceRelativePath}\` 转为可审阅基线 \`${converted.relativePath}\`（${converted.tool ?? "converter"}，**有损**：原字体/审阅修订可能丢失；请安装 Microsoft Word 后重跑以高保真导出）。`
            : `已将 \`${preferred.workspaceRelativePath}\` 转为可审阅基线 \`${converted.relativePath}\`（${converted.tool ?? "converter"}，保留原格式/审阅痕迹）。`
          : undefined,
      });
    }
    return finalizeMailContractReviewBuild(matterId, messages, built.attachmentRefs, {
      reviewMode: "opinion",
      preferredSourcePath: preferred.workspaceRelativePath,
      convertNote: `未能处理 \`${preferred.workspaceRelativePath}\`（${converted.error}），改走意见书级审查。`,
    });
  }

  return finalizeMailContractReviewBuild(matterId, messages, built.attachmentRefs, {
    reviewMode: "opinion",
    preferredSourcePath: preferred.workspaceRelativePath,
  });
}

import { classifyMailMessage, MAIL_TRIAGE_LABEL_ZH } from "../desk/mail-triage.js";

export function buildMailDigestSummary(messages: LocalMailMessage[]): string {
  if (messages.length === 0) {
    return "本期邮箱匣无新邮件。请在「交办 → 邮箱配置」连接真实邮箱并点「立即同步」。";
  }
  const lines = messages.slice(0, 12).map((m, i) => {
    const att =
      m.attachments.length > 0 ? `；附件 ${m.attachments.map((a) => a.name).join("、")}` : "";
    const label = classifyMailMessage({
      from: m.from,
      subject: m.subject,
      bodyText: m.bodyText,
      attachmentNames: m.attachments.map((a) => a.name),
    });
    return `${i + 1}. 【${MAIL_TRIAGE_LABEL_ZH[label]}】${m.receivedAt.slice(0, 10)} · ${m.from} · ${m.subject}${att}`;
  });
  const replyCount = messages.filter(
    (m) =>
      classifyMailMessage({
        from: m.from,
        subject: m.subject,
        bodyText: m.bodyText,
        attachmentNames: m.attachments.map((a) => a.name),
      }) === "needs_reply",
  ).length;
  const head =
    replyCount > 0
      ? `共 ${messages.length} 封，其中 ${replyCount} 封待回复。`
      : `共 ${messages.length} 封邮件：`;
  return `${head}\n${lines.join("\n")}`;
}
