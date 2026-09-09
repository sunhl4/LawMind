/**
 * SMTP send via nodemailer (after lawyer approval).
 */

import fs from "node:fs";
import nodemailer from "nodemailer";
import type { MailAccount } from "./mail-accounts.js";
import type { ResolvedMailAttachment } from "./mail-attachments.js";
import { getMailAccountSecret } from "./mail-secrets.js";
import { formatMailFromAddress } from "./mail-send-format.js";
import { checkSmtpPortAllowed } from "./mail-transport-guard.js";
import { resolveSmtpEndpoints } from "./provider-presets.js";

export type SmtpSendResult =
  | { ok: true; messageId?: string }
  | { ok: false; error: string; hint?: string };

export type SmtpMailPayload = {
  to: string;
  subject: string;
  body: string;
  attachments?: ResolvedMailAttachment[];
};

export async function sendSmtpMail(
  account: MailAccount,
  lawMindRoot: string,
  mail: SmtpMailPayload,
): Promise<SmtpSendResult> {
  const secret = getMailAccountSecret(lawMindRoot, account.id);
  const password = secret?.password?.trim();
  if (!password) {
    return { ok: false, error: "missing_password", hint: "邮箱未配置授权码，无法发信。" };
  }
  const { host, port, secure } = resolveSmtpEndpoints(account.provider, {
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpSecure: account.smtpSecure,
  });
  if (!host) {
    return { ok: false, error: "missing_smtp_host", hint: "请填写 SMTP 主机。" };
  }
  // 非 TLS 标准端口（465/587）默认拒绝，显式 allowInsecure 例外放行。
  const portCheck = checkSmtpPortAllowed(port, account.allowInsecure);
  if (!portCheck.ok) {
    return { ok: false, error: portCheck.error, hint: portCheck.hint };
  }
  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user: account.email, pass: password },
      requireTLS: !secure && port === 587,
      // 与 IMAP 同型超时，避免 SMTP 主机挂起时卡住 automation tick。
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    const attachments = (mail.attachments ?? []).map((a) => ({
      filename: a.filename,
      content: fs.readFileSync(a.absolutePath),
      contentType: a.contentType,
    }));
    const from = formatMailFromAddress(account.email, account.sendFormat);
    const info = await transport.sendMail({
      from: from.name ? { name: from.name, address: from.address } : from.address,
      to: mail.to,
      subject: mail.subject,
      text: mail.body,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "smtp_send_failed", hint: msg.slice(0, 240) };
  }
}
