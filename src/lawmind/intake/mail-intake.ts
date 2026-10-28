/**
 * 收案邮箱 → 收件库。整个邮箱增量同步，每封信一条来件，入库后立即判案。
 * 自己发出又出现在收件箱里的信（抄送自己）不入库。
 */

import { fetchGraphMessagesPage } from "../mail/graph-mail.js";
import {
  fetchImapMessagesSince,
  MAX_MAIL_ATTACHMENT_BYTES,
  MAX_MAIL_ATTACHMENTS_TOTAL_BYTES,
  shouldPersistMailAttachment,
  type FetchedMailMessage,
} from "../mail/imap-client.js";
import {
  getMailAccount,
  listMailAccounts,
  saveMailAccount,
  type MailAccount,
} from "../mail/mail-accounts.js";
import { buildIntakeMatterIndex } from "./matter-index.js";
import type { IntakeMatterIndex } from "./resolve.js";
import {
  findIntakeItemId,
  putIntakeBlob,
  readIntakeState,
  recordIntakeItem,
  updateIntakeState,
  type IntakeMailCursor,
} from "./store.js";
import { triageIntakeItem } from "./triage.js";
import type { IntakeAttachment, NewIntakeItem } from "./types.js";

/** 第一次同步只收最近 7 天的信，免得把整箱旧信倒进待归档。 */
const FIRST_SYNC_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 25;

export type IntakeMailFetch = (
  account: MailAccount,
  lawMindRoot: string,
  cursor: IntakeMailCursor,
) => Promise<{ messages: FetchedMailMessage[]; cursor: IntakeMailCursor }>;

export const defaultIntakeMailFetch: IntakeMailFetch = async (account, lawMindRoot, cursor) => {
  if (account.authKind === "graph_client") {
    const page = await fetchGraphMessagesPage(account, lawMindRoot, {
      limit: BATCH_LIMIT,
      includeBody: true,
      receivedSince: cursor.receivedSince ?? cursor.bootstrapSince,
      nextLink: cursor.graphNextLink,
    });
    const messages = page.messages;
    const newest = messages.reduce(
      (max, m) => (m.receivedAt > max ? m.receivedAt : max),
      cursor.receivedSince ?? "",
    );
    return {
      messages,
      cursor: {
        ...(newest ? { receivedSince: newest } : {}),
        ...(page.nextLink ? { graphNextLink: page.nextLink } : {}),
      },
    };
  }
  const res = await fetchImapMessagesSince(account, lawMindRoot, {
    sinceUid: cursor.lastUid,
    uidValidity: cursor.uidValidity,
    limit: BATCH_LIMIT,
  });
  return { messages: res.messages, cursor: { uidValidity: res.uidValidity, lastUid: res.lastUid } };
};

export type IntakeMailSyncResult =
  | {
      ok: true;
      accountId: string;
      fetched: number;
      recorded: number;
      autoAttached: number;
    }
  | { ok: false; accountId: string; error: string; hint?: string };

function bareAddress(raw: string): string | undefined {
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(raw)?.[1];
  const bare = angle ?? /^[^\s<>]+@[^\s<>]+$/.exec(raw.trim())?.[0];
  return bare?.trim().toLowerCase() || undefined;
}

function intakeAttachments(
  workspaceDir: string,
  attachments: FetchedMailMessage["attachments"],
): IntakeAttachment[] {
  let persisted = 0;
  return attachments.slice(0, 50).map((att, i) => {
    const name = att.name.trim().slice(0, 255) || `附件-${i + 1}`;
    const base = {
      name,
      size: att.content.length,
      ...(att.contentType ? { contentType: att.contentType.slice(0, 200) } : {}),
    };
    if (!shouldPersistMailAttachment(name, att.contentType)) {
      return { ...base, skippedReason: "type_not_persisted" as const };
    }
    if (att.oversized === true || att.content.length > MAX_MAIL_ATTACHMENT_BYTES) {
      return { ...base, skippedReason: "too_large" as const };
    }
    if (persisted + att.content.length > MAX_MAIL_ATTACHMENTS_TOTAL_BYTES) {
      return { ...base, skippedReason: "too_large_total" as const };
    }
    persisted += att.content.length;
    return { ...base, sha256: putIntakeBlob(workspaceDir, att.content) };
  });
}

export function intakeEmailExternalKey(accountId: string, providerMessageId: string): string {
  return `email:${accountId}:${providerMessageId}`;
}

export function fetchedMessageToIntake(
  workspaceDir: string,
  account: MailAccount,
  msg: FetchedMailMessage,
): NewIntakeItem {
  const address = msg.fromAddress ?? bareAddress(msg.from);
  return {
    channel: "email",
    externalKey: intakeEmailExternalKey(account.id, msg.id),
    receivedAt: msg.receivedAt,
    from: { display: msg.from, ...(address ? { address } : {}) },
    to: msg.to,
    subject: msg.subject,
    text: msg.bodyText,
    thread: {
      ...(msg.messageId ? { messageId: msg.messageId } : {}),
      ...(msg.inReplyTo ? { inReplyTo: msg.inReplyTo } : {}),
      ...(msg.references ? { references: msg.references } : {}),
      ...(msg.conversationId ? { conversationId: msg.conversationId } : {}),
    },
    ...(msg.dmarc ? { dmarc: msg.dmarc } : {}),
    attachments: intakeAttachments(workspaceDir, msg.attachments),
    source: { accountId: account.id, providerMessageId: msg.id },
  };
}

export async function syncIntakeMailbox(
  workspaceDir: string,
  lawMindRoot: string,
  accountId: string,
  opts?: { fetch?: IntakeMailFetch; index?: IntakeMatterIndex; now?: Date },
): Promise<IntakeMailSyncResult> {
  const account = getMailAccount(workspaceDir, accountId);
  if (!account || !account.enabled || account.intakeInbox !== true) {
    return { ok: false, accountId, error: "not_intake_inbox", hint: "这不是启用中的收案邮箱。" };
  }
  const now = opts?.now ?? new Date();
  const at = now.toISOString();
  const cursor = readIntakeState(workspaceDir).mail[accountId] ?? {};
  const firstSync = cursor.initializedAt === undefined;
  const fetchCursor = firstSync
    ? {
        ...cursor,
        bootstrapSince: new Date(now.getTime() - FIRST_SYNC_WINDOW_MS).toISOString(),
      }
    : cursor;
  try {
    const fetched = await (opts?.fetch ?? defaultIntakeMailFetch)(
      account,
      lawMindRoot,
      fetchCursor,
    );
    const fetchedCursor: IntakeMailCursor = {
      ...fetched.cursor,
      ...(fetched.cursor.graphNextLink ? { graphNextLink: fetched.cursor.graphNextLink } : {}),
    };
    const index = opts?.index ?? buildIntakeMatterIndex(workspaceDir);
    const own = account.email.trim().toLowerCase();
    const cutoff = firstSync ? now.getTime() - FIRST_SYNC_WINDOW_MS : undefined;
    let recorded = 0;
    let autoAttached = 0;
    for (const msg of fetched.messages.toSorted((a, b) =>
      a.receivedAt.localeCompare(b.receivedAt),
    )) {
      if (cutoff !== undefined && Date.parse(msg.receivedAt) < cutoff) {
        continue;
      }
      if ((msg.fromAddress ?? bareAddress(msg.from)) === own) {
        continue;
      }
      const externalKey = intakeEmailExternalKey(account.id, msg.id);
      if (findIntakeItemId(workspaceDir, { externalKey, messageId: msg.messageId })) {
        continue;
      }
      const { item, created } = recordIntakeItem(
        workspaceDir,
        fetchedMessageToIntake(workspaceDir, account, msg),
        { now },
      );
      if (!created) {
        continue;
      }
      recorded += 1;
      if (triageIntakeItem(workspaceDir, item, index, { now }).status === "attached") {
        autoAttached += 1;
      }
    }
    const nextCursor: IntakeMailCursor = {
      ...fetchedCursor,
      initializedAt: cursor.initializedAt ?? at,
      attemptedAt: at,
      syncedAt: at,
      error: undefined,
    };
    if (account.authKind === "graph_client" && !fetchedCursor.graphNextLink) {
      nextCursor.receivedSince =
        fetchedCursor.receivedSince ?? cursor.receivedSince ?? fetchCursor.bootstrapSince ?? at;
      nextCursor.graphNextLink = undefined;
    }
    nextCursor.bootstrapSince = undefined;
    updateIntakeState(workspaceDir, (state) => ({
      ...state,
      mail: {
        ...state.mail,
        [accountId]: nextCursor,
      },
    }));
    saveMailAccount(workspaceDir, { ...account, lastSyncAt: at, lastSyncError: undefined });
    return { ok: true, accountId, fetched: fetched.messages.length, recorded, autoAttached };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 240);
    updateIntakeState(workspaceDir, (state) => ({
      ...state,
      mail: {
        ...state.mail,
        [accountId]: {
          ...cursor,
          initializedAt: cursor.initializedAt,
          attemptedAt: at,
          error: message,
        },
      },
    }));
    saveMailAccount(workspaceDir, { ...account, lastSyncError: message });
    return { ok: false, accountId, error: "sync_failed", hint: message };
  }
}

export function listIntakeMailAccounts(workspaceDir: string): MailAccount[] {
  return listMailAccounts(workspaceDir).filter((a) => a.enabled && a.intakeInbox === true);
}
