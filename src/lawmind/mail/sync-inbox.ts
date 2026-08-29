/**
 * Sync remote mailbox → cases/<matterId>/mail/inbox JSON (+ attachments).
 */

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

async function fetchForAccount(
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
  try {
    const messages = await fetchForAccount(account, lawMindRoot, opts.limit ?? 25, {
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

/** Sync preferred account for matter (used by automations tick). */
export async function syncMatterMailbox(
  workspaceDir: string,
  lawMindRoot: string,
  matterId: string,
  opts: { limit?: number; includeBody?: boolean } = {},
): Promise<SyncInboxResult | { ok: true; skipped: true; reason: string }> {
  const account = resolveMailAccountForMatter(workspaceDir, matterId);
  if (!account) {
    return { ok: true, skipped: true, reason: "no_mail_account" };
  }
  return syncMailAccountToMatter(workspaceDir, lawMindRoot, account.id, matterId, opts);
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
      hint: "未配置邮箱。请在「交办 → 邮箱配置」中添加账号。",
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
  return {
    ok: true,
    via: account.email,
    messageId: "messageId" in result ? result.messageId : undefined,
  };
}

export function countEnabledMailAccounts(workspaceDir: string): number {
  return listMailAccounts(workspaceDir).filter((a) => a.enabled).length;
}
