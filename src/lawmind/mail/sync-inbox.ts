/**
 * Sync remote mailbox → cases/<matterId>/mail/inbox JSON (+ attachments).
 */

import { loadMatter } from "../adapters/matter-storage/index.js";
import { rememberIntakeThreadRef } from "../intake/store.js";
import { writeMatterMailMessage, type LocalMailMessage } from "../platform/lawyer-automations.js";
import { fetchGraphMessages, testGraphMailConnection } from "./graph-mail.js";
import { sendGraphMail } from "./graph-mail.js";
import {
  fetchImapMessages,
  testImapConnection,
  writeFetchedAttachments,
  type FetchedMailMessage,
} from "./imap-client.js";
import {
  getMailAccount,
  listMailAccounts,
  resolveMailAccountForMatter,
  saveMailAccount,
  type MailAccount,
} from "./mail-accounts.js";
import { applyMailSendFormat } from "./mail-send-format.js";
import { sendSmtpMail } from "./smtp-client.js";
import { messageMatchesWatchContacts } from "./watch-contacts.js";

export type SyncInboxResult =
  | {
      ok: true;
      accountId: string;
      fetched: number;
      written: number;
      filteredOut: number;
      watchMode: "all" | "contacts";
    }
  | { ok: false; error: string; hint?: string; accountId?: string };

export async function fetchMessagesForAccount(
  account: MailAccount,
  lawMindRoot: string,
  limit: number,
  opts?: { includeBody?: boolean },
): Promise<FetchedMailMessage[]> {
  if (account.authKind === "graph_client") {
    return fetchGraphMessages(account, lawMindRoot, { limit, includeBody: opts?.includeBody });
  }
  return fetchImapMessages(account, lawMindRoot, { limit });
}

export async function testMailAccountConnection(
  account: MailAccount,
  lawMindRoot: string,
): Promise<
  { ok: true; mailbox: string; messageCount?: number } | { ok: false; error: string; hint?: string }
> {
  if (account.authKind === "graph_client") {
    return testGraphMailConnection(account, lawMindRoot);
  }
  return testImapConnection(account, lawMindRoot);
}

export function persistFetchedMessages(
  workspaceDir: string,
  matterId: string,
  messages: FetchedMailMessage[],
): number {
  let written = 0;
  for (const msg of messages) {
    const attachments = writeFetchedAttachments(workspaceDir, matterId, msg.id, msg.attachments);
    const local: LocalMailMessage = {
      id: msg.id,
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      receivedAt: msg.receivedAt,
      bodyText: msg.bodyText,
      attachments,
    };
    writeMatterMailMessage(workspaceDir, matterId, local);
    written += 1;
  }
  return written;
}

export async function syncMailAccountToMatter(
  workspaceDir: string,
  lawMindRoot: string,
  accountId: string,
  matterId: string,
  opts: { limit?: number; includeBody?: boolean } = {},
): Promise<SyncInboxResult> {
  const account = getMailAccount(workspaceDir, accountId);
  if (!account) {
    return { ok: false, error: "account_not_found", hint: "邮箱账号不存在。" };
  }
  if (!account.enabled) {
    return { ok: false, error: "account_disabled", hint: "请先启用该邮箱账号。", accountId };
  }
  // 收案邮箱是全局统一收件库：整箱同步会绕过判案，把别的案子的来信也拉进本案。
  // 误点「同步」或调用旧接口时在这里兜底；收案邮箱只走 syncIntakeMailbox。
  if (account.intakeInbox === true) {
    return {
      ok: false,
      error: "intake_inbox",
      hint: "这是收案邮箱：来信会先进「待归案」，不能整箱同步到某一个案件。",
      accountId,
    };
  }
  if (!loadMatter(workspaceDir, matterId)) {
    return {
      ok: false,
      error: "matter_not_found",
      hint: "案件不存在或已删除，不能把邮箱同步进去。",
      accountId,
    };
  }
  try {
    const messages = await fetchMessagesForAccount(account, lawMindRoot, opts.limit ?? 25, {
      includeBody: opts.includeBody,
    });
    const contacts = account.watchContacts ?? [];
    const matched = messages.filter((m) => messageMatchesWatchContacts(m, contacts));
    const written = persistFetchedMessages(workspaceDir, matterId, matched);
    saveMailAccount(workspaceDir, {
      ...account,
      lastSyncAt: new Date().toISOString(),
      lastSyncError: undefined,
      updatedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      accountId,
      fetched: messages.length,
      written,
      filteredOut: messages.length - matched.length,
      watchMode: contacts.length === 0 ? "all" : "contacts",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    saveMailAccount(workspaceDir, {
      ...account,
      lastSyncError: msg.slice(0, 240),
      updatedAt: new Date().toISOString(),
    });
    return {
      ok: false,
      error: "sync_failed",
      hint: msg.slice(0, 240),
      accountId,
    };
  }
}

/**
 * Sync preferred account for matter (used by automations tick).
 * 配了收案邮箱后只同步明确绑在本案的邮箱：收案邮箱的来信由判案归档进本地匣，
 * 不能被某个案件的办件整箱拉走。
 */
export async function syncMatterMailbox(
  workspaceDir: string,
  lawMindRoot: string,
  matterId: string,
  opts: { limit?: number; includeBody?: boolean } = {},
): Promise<
  SyncInboxResult | { ok: true; skipped: true; reason: "no_mail_account" | "intake_inbox" }
> {
  const enabled = listMailAccounts(workspaceDir).filter((a) => a.enabled);
  const hasIntake = enabled.some((a) => a.intakeInbox === true);
  const account = enabled.find((a) => a.intakeInbox !== true && a.matterId === matterId);
  if (account) {
    return syncMailAccountToMatter(workspaceDir, lawMindRoot, account.id, matterId, opts);
  }
  if (hasIntake) {
    return { ok: true, skipped: true, reason: "intake_inbox" };
  }
  const fallback = enabled.find((a) => a.intakeInbox !== true && !a.matterId);
  if (!fallback) {
    return { ok: true, skipped: true, reason: "no_mail_account" };
  }
  return syncMailAccountToMatter(workspaceDir, lawMindRoot, fallback.id, matterId, opts);
}

export async function sendMailViaAccount(
  workspaceDir: string,
  lawMindRoot: string,
  matterId: string,
  mail: {
    to: string;
    subject: string;
    body: string;
    attachmentRelativePaths?: string[];
  },
  accountId?: string,
): Promise<
  { ok: true; via: string; messageId?: string } | { ok: false; error: string; hint?: string }
> {
  const account = accountId
    ? getMailAccount(workspaceDir, accountId)
    : resolveMailAccountForMatter(workspaceDir, matterId);
  if (!account) {
    return {
      ok: false,
      error: "no_mail_account",
      hint: "未配置邮箱。请在「设置 → 自动办件」里添加。",
    };
  }
  const { resolveOutboundAttachmentPaths } = await import("./mail-attachments.js");
  const resolved = resolveOutboundAttachmentPaths(workspaceDir, mail.attachmentRelativePaths);
  if (!resolved.ok) {
    return { ok: false, error: "bad_attachment", hint: resolved.error };
  }
  const payload = {
    to: mail.to,
    subject: mail.subject,
    body: applyMailSendFormat(mail.body, account.sendFormat),
    attachments: resolved.files,
  };
  const result =
    account.authKind === "graph_client"
      ? await sendGraphMail(account, lawMindRoot, payload)
      : await sendSmtpMail(account, lawMindRoot, payload);
  if (!result.ok) {
    return result;
  }
  const messageId = "messageId" in result ? result.messageId : undefined;
  if (messageId) {
    try {
      // 对方回这封信时凭 In-Reply-To 认回本案。
      rememberIntakeThreadRef(workspaceDir, messageId, matterId);
    } catch {
      /* 记线程失败不影响已发出的信 */
    }
  }
  return {
    ok: true,
    via: account.email,
    messageId,
  };
}

export function countEnabledMailAccounts(workspaceDir: string): number {
  return listMailAccounts(workspaceDir).filter((a) => a.enabled).length;
}
