/**
 * Lawyer Automations — recurring scheduled tasks (Cursor Automations analogue).
 * Persist under `lawmind/automations/`; results queue under `lawmind/automation-inbox/`.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type AutomationScheduleKind = "daily" | "weekly" | "once";

export type AutomationSchedule =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "once"; runAt: string };

export type AutomationPresetId =
  | "renewal-monitor"
  | "client-weekly-update"
  | "mail-inbox-digest"
  | "mail-contract-review"
  | "custom";

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
  status: "open" | "acknowledged" | "approved_send" | "dismissed";
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
    description: "读取本案邮件匣，整理要点与附件清单，推送到待我拍板。",
    needsMail: true,
    defaultSchedule: { kind: "daily", hour: 8, minute: 30 },
    defaultAllowSend: false,
  },
  {
    id: "mail-contract-review",
    title: "邮件合同初审",
    description: "下载/解读邮件附件中的合同，启动合同审查工作流，待你签批。",
    templateId: "contract-review",
    needsMail: true,
    defaultSchedule: { kind: "daily", hour: 9, minute: 0 },
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

/** Next run after `from` for a schedule (local wall clock). */
export function computeNextRunAt(schedule: AutomationSchedule, from: Date = new Date()): string {
  if (schedule.kind === "once") {
    const t = Date.parse(schedule.runAt);
    if (!Number.isFinite(t)) {
      return new Date(from.getTime() + 86_400_000).toISOString();
    }
    return new Date(Math.max(t, from.getTime() + 1000)).toISOString();
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

export function saveAutomation(workspaceDir: string, automation: LawyerAutomation): void {
  const dir = automationsDir(workspaceDir);
  ensureDir(dir);
  const file = path.join(dir, `${automation.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(automation, null, 2)}\n`, "utf8");
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
  const schedule = input.schedule ?? preset.defaultSchedule;
  const id = randomUUID();
  const notifyEmail =
    sanitizeNotifyEmail(input.notifyEmail) || extractNotifyEmail(input.instruction);
  const automation: LawyerAutomation = {
    id,
    title: input.title?.trim() || preset.title,
    enabled: input.enabled !== false,
    presetId: preset.id,
    templateId: preset.templateId,
    matterId: input.matterId.trim(),
    instruction: input.instruction?.trim() || undefined,
    schedule,
    nextRunAt: computeNextRunAt(schedule, now),
    allowSendEmailAfterApproval: input.allowSendEmailAfterApproval ?? preset.defaultAllowSend,
    notifyEmail,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  saveAutomation(workspaceDir, automation);
  return automation;
}

/** Map free-text lawyer instruction to a preset + cleaned title. */
export function inferAutomationFromInstruction(text: string): {
  presetId: AutomationPresetId;
  title: string;
  instruction: string;
  allowSendEmailAfterApproval: boolean;
} {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  if (/邮件|邮箱|inbox|gmail|outlook/.test(raw) && /合同|审阅|审查|附件/.test(raw)) {
    return {
      presetId: "mail-contract-review",
      title: "邮件合同初审",
      instruction: raw,
      allowSendEmailAfterApproval: false,
    };
  }
  if (/邮件|邮箱|收件|来信/.test(raw)) {
    return {
      presetId: "mail-inbox-digest",
      title: "邮箱收件整理",
      instruction: raw,
      allowSendEmailAfterApproval: false,
    };
  }
  if (/续签|到期|终止通知/.test(raw)) {
    return {
      presetId: "renewal-monitor",
      title: "合同续签盯梢",
      instruction: raw,
      allowSendEmailAfterApproval: false,
    };
  }
  if (/客户|周报|进展备忘|update/.test(lower) || /发给客户|回客户/.test(raw)) {
    return {
      presetId: "client-weekly-update",
      title: "客户进展周报",
      instruction: raw,
      allowSendEmailAfterApproval: /发信|发送|邮件给客户/.test(raw),
    };
  }
  return {
    presetId: "custom",
    title: raw.slice(0, 40) || "自定义交办",
    instruction: raw,
    allowSendEmailAfterApproval: false,
  };
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
  fs.writeFileSync(path.join(dir, `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`, "utf8");
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
  fs.writeFileSync(
    path.join(dir, `${message.id}.json`),
    `${JSON.stringify(message, null, 2)}\n`,
    "utf8",
  );
}

export function queueOutboundMail(
  workspaceDir: string,
  matterId: string,
  mail: { to: string; subject: string; body: string },
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
  mail: { to: string; subject: string; body: string },
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

export function buildMailDigestSummary(messages: LocalMailMessage[]): string {
  if (messages.length === 0) {
    return "本期邮箱匣无新邮件。请在「交办 → 邮箱配置」连接真实邮箱并点「立即同步」。";
  }
  const lines = messages.slice(0, 12).map((m, i) => {
    const att =
      m.attachments.length > 0 ? `；附件 ${m.attachments.map((a) => a.name).join("、")}` : "";
    return `${i + 1}. ${m.receivedAt.slice(0, 10)} · ${m.from} · ${m.subject}${att}`;
  });
  return `共 ${messages.length} 封邮件：\n${lines.join("\n")}`;
}

export function buildMailContractReviewSummary(messages: LocalMailMessage[]): {
  summary: string;
  attachmentNames: string[];
} {
  const withAtt = messages.filter((m) => m.attachments.length > 0);
  const names = withAtt.flatMap((m) => m.attachments.map((a) => a.name));
  if (names.length === 0) {
    return {
      summary:
        "未发现带合同附件的邮件。请确认对方已发来 PDF/Word 等文件，或到「交办 → 邮箱配置」重新同步。",
      attachmentNames: [],
    };
  }
  const summary = [
    `发现 ${names.length} 个附件，建议按合同审查流程处理：`,
    ...names.map((n, i) => `${i + 1}. ${n}`),
    "",
    "建议下一步：在对话中交办「对本附件做合同初审」，或打开文书台签批修订稿。",
  ].join("\n");
  return { summary, attachmentNames: names };
}
