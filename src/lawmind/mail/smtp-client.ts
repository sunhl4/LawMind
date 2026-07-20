/**
 * SMTP send via nodemailer (after lawyer approval).
 */

import nodemailer from "nodemailer";
import type { MailAccount } from "./mail-accounts.js";
import { getMailAccountSecret } from "./mail-secrets.js";
import { resolveSmtpEndpoints } from "./provider-presets.js";

export type SmtpSendResult =
  | { ok: true; messageId?: string }
  | { ok: false; error: string; hint?: string };

export async function sendSmtpMail(
  account: MailAccount,
  lawMindRoot: string,
  mail: { to: string; subject: string; body: string },
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
  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user: account.email, pass: password },
      requireTLS: !secure && port === 587,
    });
    const info = await transport.sendMail({
      from: account.email,
      to: mail.to,
      subject: mail.subject,
      text: mail.body,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "smtp_send_failed", hint: msg.slice(0, 240) };
  }
}
