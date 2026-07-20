/**
 * IMAP fetch / connection test via imapflow + mailparser.
 */

import fs from "node:fs";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { MailAccount } from "./mail-accounts.js";
import { getMailAccountSecret } from "./mail-secrets.js";
import { resolveImapEndpoints } from "./provider-presets.js";

export type FetchedMailMessage = {
  id: string;
  from: string;
  to: string;
  subject: string;
  receivedAt: string;
  bodyText: string;
  attachments: Array<{ name: string; content: Buffer; contentType?: string }>;
};

export type MailConnectResult =
  | { ok: true; mailbox: string; messageCount?: number }
  | { ok: false; error: string; hint?: string };

function formatAddress(
  value: { text?: string; value?: Array<{ name?: string; address?: string }> } | undefined,
): string {
  if (!value) {
    return "";
  }
  if (value.text?.trim()) {
    return value.text.trim();
  }
  const first = value.value?.[0];
  if (!first) {
    return "";
  }
  if (first.name && first.address) {
    return `${first.name} <${first.address}>`;
  }
  return first.address ?? first.name ?? "";
}

async function withImapClient<T>(
  account: MailAccount,
  lawMindRoot: string,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const secret = getMailAccountSecret(lawMindRoot, account.id);
  const password = secret?.password?.trim();
  if (!password) {
    throw new Error("missing_password");
  }
  const { host, port } = resolveImapEndpoints(account.provider, {
    imapHost: account.imapHost,
    imapPort: account.imapPort,
  });
  if (!host) {
    throw new Error("missing_imap_host");
  }
  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user: account.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: true },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  // imapflow emits 'error' on socket timeout; without a listener Node crashes the process.
  let socketError: Error | null = null;
  client.on("error", (err: Error) => {
    socketError = err instanceof Error ? err : new Error(String(err));
  });
  try {
    await client.connect();
    if (socketError) {
      throw socketError;
    }
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function testImapConnection(
  account: MailAccount,
  lawMindRoot: string,
): Promise<MailConnectResult> {
  try {
    return await withImapClient(account, lawMindRoot, async (client) => {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const status = client.mailbox;
        const messageCount =
          status && typeof status === "object" && "exists" in status
            ? Number((status as { exists?: number }).exists ?? 0)
            : undefined;
        return { ok: true as const, mailbox: "INBOX", messageCount };
      } finally {
        lock.release();
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("missing_password")) {
      return {
        ok: false,
        error: "missing_password",
        hint: "请填写授权码/应用专用密码后重试。",
      };
    }
    if (msg.includes("missing_imap_host")) {
      return { ok: false, error: "missing_imap_host", hint: "自定义 IMAP 需填写主机地址。" };
    }
    return {
      ok: false,
      error: "imap_connect_failed",
      hint: msg.slice(0, 240),
    };
  }
}

export async function fetchImapMessages(
  account: MailAccount,
  lawMindRoot: string,
  opts: { limit?: number } = {},
): Promise<FetchedMailMessage[]> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 25));
  return withImapClient(account, lawMindRoot, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const status = client.mailbox;
      const exists =
        status && typeof status === "object" && "exists" in status
          ? Number((status as { exists?: number }).exists ?? 0)
          : 0;
      if (exists <= 0) {
        return [];
      }
      const from = Math.max(1, exists - limit + 1);
      const out: FetchedMailMessage[] = [];
      for await (const msg of client.fetch(`${from}:*`, {
        uid: true,
        envelope: true,
        source: true,
        internalDate: true,
      })) {
        const uid = String(msg.uid);
        const source = msg.source;
        if (!source) {
          continue;
        }
        const parsed = await simpleParser(source);
        const attachments = (parsed.attachments ?? []).map((att) => ({
          name: att.filename?.trim() || `attachment-${uid}`,
          content: Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content),
          contentType: att.contentType,
        }));
        const receivedAt =
          (msg.internalDate instanceof Date
            ? msg.internalDate.toISOString()
            : parsed.date?.toISOString()) || new Date().toISOString();
        out.push({
          id: `imap-${account.id.slice(0, 8)}-${uid}`,
          from: formatAddress(parsed.from as never) || account.email,
          to: formatAddress(parsed.to as never),
          subject: parsed.subject?.trim() || "(无主题)",
          receivedAt,
          bodyText: (
            parsed.text ||
            (typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : "") ||
            ""
          )
            .trim()
            .slice(0, 20_000),
          attachments,
        });
      }
      return out.toSorted((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    } finally {
      lock.release();
    }
  });
}

/** Document-like attachments worth persisting for lawyer workflows; skip inline noise. */
const PERSIST_ATTACHMENT_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".wps",
  ".rtf",
  ".odt",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".md",
  ".csv",
  ".zip",
  ".7z",
  ".rar",
]);

const PERSIST_ATTACHMENT_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats",
  "application/vnd.ms-",
  "application/rtf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip",
];

export function shouldPersistMailAttachment(name: string, contentType?: string): boolean {
  const base = name.trim().toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot > 0 && PERSIST_ATTACHMENT_EXTENSIONS.has(base.slice(dot))) {
    return true;
  }
  const ct = (contentType ?? "").trim().toLowerCase();
  if (!ct || ct.startsWith("image/") || ct.startsWith("audio/") || ct.startsWith("video/")) {
    return false;
  }
  return PERSIST_ATTACHMENT_CONTENT_TYPES.some((p) => ct.startsWith(p));
}

export type PersistedMailAttachmentRef = {
  name: string;
  /** Present only when binary was written under matter mail/attachments. */
  relativePath?: string;
};

/**
 * Persist document attachments under matter mail/attachments.
 * Inline images / non-document parts are recorded by name only (not copied to disk).
 */
export function writeFetchedAttachments(
  workspaceDir: string,
  matterId: string,
  messageId: string,
  attachments: FetchedMailMessage["attachments"],
): PersistedMailAttachmentRef[] {
  if (attachments.length === 0) {
    return [];
  }
  let dirCreated = false;
  const dir = path.join(
    path.resolve(workspaceDir),
    "cases",
    matterId,
    "mail",
    "attachments",
    messageId,
  );
  return attachments.map((att, i) => {
    const displayName = att.name.trim() || `附件-${i + 1}`;
    if (!shouldPersistMailAttachment(displayName, att.contentType)) {
      return { name: displayName };
    }
    if (!dirCreated) {
      fs.mkdirSync(dir, { recursive: true });
      dirCreated = true;
    }
    const safeName =
      displayName.replace(/[^\w.\u4e00-\u9fff-]+/g, "_").slice(0, 120) || `file-${i}`;
    const full = path.join(dir, safeName);
    fs.writeFileSync(full, att.content);
    return {
      name: displayName,
      relativePath: path.join("mail", "attachments", messageId, safeName),
    };
  });
}
