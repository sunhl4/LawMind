/**
 * Microsoft Graph mail (application permissions) — list + send.
 */

import type { FetchedMailMessage } from "./imap-client.js";
import type { MailConnectResult } from "./imap-client.js";
import type { MailAccount } from "./mail-accounts.js";
import { getMailAccountSecret } from "./mail-secrets.js";
import type { SmtpSendResult } from "./smtp-client.js";

async function fetchGraphToken(args: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(args.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token_failed:${res.status}:${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("token_missing_access_token");
  }
  return json.access_token;
}

function resolveGraphConfig(
  account: MailAccount,
  lawMindRoot: string,
):
  | { ok: true; tenantId: string; clientId: string; clientSecret: string; mailbox: string }
  | { ok: false; error: string; hint: string } {
  const tenantId = account.tenantId?.trim();
  const clientId = account.clientId?.trim();
  const clientSecret =
    getMailAccountSecret(lawMindRoot, account.id)?.clientSecret?.trim() ||
    process.env.LAWMIND_MAIL_GRAPH_CLIENT_SECRET?.trim();
  const mailbox = (account.graphMailbox || account.email).trim();
  if (!tenantId || !clientId) {
    return {
      ok: false,
      error: "graph_tenant_client_required",
      hint: "Microsoft 365 Graph 需填写租户 ID 与客户端 ID。",
    };
  }
  if (!clientSecret) {
    return {
      ok: false,
      error: "missing_client_secret",
      hint: "请填写客户端密钥，或设置宿主环境变量 LAWMIND_MAIL_GRAPH_CLIENT_SECRET。",
    };
  }
  return { ok: true, tenantId, clientId, clientSecret, mailbox };
}

export async function testGraphMailConnection(
  account: MailAccount,
  lawMindRoot: string,
): Promise<MailConnectResult> {
  const cfg = resolveGraphConfig(account, lawMindRoot);
  if (!cfg.ok) {
    return { ok: false, error: cfg.error, hint: cfg.hint };
  }
  try {
    const token = await fetchGraphToken(cfg);
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.mailbox)}/mailFolders/inbox?$select=totalItemCount,displayName`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: "graph_mailbox_failed",
        hint: `Graph ${res.status}: ${text.slice(0, 160)}`,
      };
    }
    const json = (await res.json()) as { totalItemCount?: number; displayName?: string };
    return {
      ok: true,
      mailbox: json.displayName || "Inbox",
      messageCount: json.totalItemCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "graph_connect_failed", hint: msg.slice(0, 240) };
  }
}

export async function fetchGraphMessages(
  account: MailAccount,
  lawMindRoot: string,
  opts: { limit?: number } = {},
): Promise<FetchedMailMessage[]> {
  const cfg = resolveGraphConfig(account, lawMindRoot);
  if (!cfg.ok) {
    throw new Error(cfg.error);
  }
  const limit = Math.min(50, Math.max(1, opts.limit ?? 25));
  const token = await fetchGraphToken(cfg);
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.mailbox)}/mailFolders/inbox/messages` +
    `?$top=${limit}&$orderby=receivedDateTime%20desc&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`graph_list_failed:${res.status}:${text.slice(0, 160)}`);
  }
  const json = (await res.json()) as {
    value?: Array<{
      id?: string;
      subject?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
      receivedDateTime?: string;
      bodyPreview?: string;
      hasAttachments?: boolean;
    }>;
  };
  const out: FetchedMailMessage[] = [];
  for (const row of json.value ?? []) {
    if (!row.id) {
      continue;
    }
    const fromAddr = row.from?.emailAddress;
    const from = fromAddr?.name
      ? `${fromAddr.name} <${fromAddr.address ?? ""}>`
      : fromAddr?.address || "unknown";
    const to = (row.toRecipients ?? [])
      .map((r) => r.emailAddress?.address)
      .filter(Boolean)
      .join(", ");
    const attachments: FetchedMailMessage["attachments"] = [];
    if (row.hasAttachments) {
      const attUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.mailbox)}/messages/${encodeURIComponent(row.id)}/attachments`;
      const attRes = await fetch(attUrl, { headers: { authorization: `Bearer ${token}` } });
      if (attRes.ok) {
        const attJson = (await attRes.json()) as {
          value?: Array<{
            "@odata.type"?: string;
            name?: string;
            contentBytes?: string;
            contentType?: string;
          }>;
        };
        for (const att of attJson.value ?? []) {
          if (att["@odata.type"] !== "#microsoft.graph.fileAttachment" || !att.contentBytes) {
            continue;
          }
          attachments.push({
            name: att.name || "attachment",
            content: Buffer.from(att.contentBytes, "base64"),
            contentType: att.contentType,
          });
        }
      }
    }
    out.push({
      id: `graph-${row.id}`,
      from,
      to,
      subject: row.subject?.trim() || "(无主题)",
      receivedAt: row.receivedDateTime || new Date().toISOString(),
      bodyText: (row.bodyPreview || "").trim(),
      attachments,
    });
  }
  return out;
}

export async function sendGraphMail(
  account: MailAccount,
  lawMindRoot: string,
  mail: { to: string; subject: string; body: string },
): Promise<SmtpSendResult> {
  const cfg = resolveGraphConfig(account, lawMindRoot);
  if (!cfg.ok) {
    return { ok: false, error: cfg.error, hint: cfg.hint };
  }
  try {
    const token = await fetchGraphToken(cfg);
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.mailbox)}/sendMail`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: mail.subject,
          body: { contentType: "Text", content: mail.body },
          toRecipients: [{ emailAddress: { address: mail.to } }],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: "graph_send_failed",
        hint: `Graph ${res.status}: ${text.slice(0, 160)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "graph_send_failed", hint: msg.slice(0, 240) };
  }
}
