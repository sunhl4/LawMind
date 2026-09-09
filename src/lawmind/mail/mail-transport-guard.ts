/**
 * 邮件传输端口门禁：IMAP/SMTP 非 TLS 标准端口默认拒绝，显式 allowInsecure 例外放行
 * （对齐 MCP allowInsecureHttp 先例：显式标志 + 明确警告文案）。
 *
 * 标准加密端口：IMAP 993（implicit TLS）；SMTP 465（implicit）/ 587（STARTTLS）。
 * 其余端口（如 143/25）凭证可能走明文，需律师在账号配置里显式确认。
 */

export const SECURE_IMAP_PORTS: ReadonlySet<number> = new Set([993]);
export const SECURE_SMTP_PORTS: ReadonlySet<number> = new Set([465, 587]);

export type MailTransportPortCheck = { ok: true } | { ok: false; error: string; hint: string };

export function checkImapPortAllowed(
  port: number,
  allowInsecure?: boolean,
): MailTransportPortCheck {
  if (SECURE_IMAP_PORTS.has(port) || allowInsecure === true) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "insecure_imap_port",
    hint: `IMAP 端口 ${port} 非加密标准端口（993），凭证可能明文传输。确需使用请在该邮箱账号上显式开启 allowInsecure。`,
  };
}

export function checkSmtpPortAllowed(
  port: number,
  allowInsecure?: boolean,
): MailTransportPortCheck {
  if (SECURE_SMTP_PORTS.has(port) || allowInsecure === true) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "insecure_smtp_port",
    hint: `SMTP 端口 ${port} 非加密标准端口（465/587），凭证可能明文传输。确需使用请在该邮箱账号上显式开启 allowInsecure。`,
  };
}
