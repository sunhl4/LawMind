/**
 * Mail provider presets — IMAP/SMTP hosts for common Chinese & global mailboxes.
 */

export type MailProviderId = "gmail" | "outlook" | "microsoft365" | "qq" | "163" | "imap";

export type MailAuthKind = "password" | "app_password" | "graph_client";

export type MailProviderPreset = {
  id: MailProviderId;
  label: string;
  description: string;
  authKinds: MailAuthKind[];
  defaultAuthKind: MailAuthKind;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** Lawyer-facing hint for app passwords / OAuth. */
  credentialHint: string;
};

export const MAIL_PROVIDER_PRESETS: MailProviderPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    description: "Google 邮箱（需开启 IMAP，使用应用专用密码）",
    authKinds: ["app_password"],
    defaultAuthKind: "app_password",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    credentialHint: "Google 账号 → 安全性 → 两步验证 → 应用专用密码。不要使用普通登录密码。",
  },
  {
    id: "outlook",
    label: "Outlook.com",
    description: "个人 Outlook / Hotmail / Live",
    authKinds: ["password", "app_password"],
    defaultAuthKind: "app_password",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    credentialHint:
      "建议在 Microsoft 账号中创建「应用密码」。若机构禁用基础身份验证，请改用 Microsoft 365（Graph）。",
  },
  {
    id: "microsoft365",
    label: "Microsoft 365",
    description: "工作/学校邮箱（IMAP 或 Graph 应用权限）",
    authKinds: ["app_password", "graph_client"],
    defaultAuthKind: "app_password",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    credentialHint:
      "IMAP：使用应用密码。Graph：在 Azure 应用注册中授予 Mail.Read / Mail.Send，并填写租户与客户端密钥。",
  },
  {
    id: "qq",
    label: "QQ 邮箱",
    description: "mail.qq.com",
    authKinds: ["app_password"],
    defaultAuthKind: "app_password",
    imapHost: "imap.qq.com",
    imapPort: 993,
    smtpHost: "smtp.qq.com",
    smtpPort: 465,
    smtpSecure: true,
    credentialHint: "QQ 邮箱设置 → 账户 → 开启 IMAP/SMTP → 生成授权码（非 QQ 密码）。",
  },
  {
    id: "163",
    label: "163 邮箱",
    description: "mail.163.com",
    authKinds: ["app_password"],
    defaultAuthKind: "app_password",
    imapHost: "imap.163.com",
    imapPort: 993,
    smtpHost: "smtp.163.com",
    smtpPort: 465,
    smtpSecure: true,
    credentialHint: "163 邮箱设置 → POP3/SMTP/IMAP → 开启并获取授权码。",
  },
  {
    id: "imap",
    label: "自定义 IMAP/SMTP",
    description: "企业邮箱或其他提供商（手动填写主机）",
    authKinds: ["password", "app_password"],
    defaultAuthKind: "password",
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    credentialHint: "向贵所 IT 索取 IMAP/SMTP 主机、端口与授权方式（常为授权码）。",
  },
];

export function getMailProviderPreset(id: MailProviderId): MailProviderPreset {
  const found = MAIL_PROVIDER_PRESETS.find((p) => p.id === id);
  if (!found) {
    return MAIL_PROVIDER_PRESETS[MAIL_PROVIDER_PRESETS.length - 1];
  }
  return found;
}

export function resolveImapEndpoints(
  provider: MailProviderId,
  overrides?: { imapHost?: string; imapPort?: number },
): { host: string; port: number } {
  const preset = getMailProviderPreset(provider);
  const host = overrides?.imapHost?.trim() || preset.imapHost;
  const port = overrides?.imapPort && overrides.imapPort > 0 ? overrides.imapPort : preset.imapPort;
  return { host, port };
}

export function resolveSmtpEndpoints(
  provider: MailProviderId,
  overrides?: { smtpHost?: string; smtpPort?: number; smtpSecure?: boolean },
): { host: string; port: number; secure: boolean } {
  const preset = getMailProviderPreset(provider);
  const host = overrides?.smtpHost?.trim() || preset.smtpHost;
  const port = overrides?.smtpPort && overrides.smtpPort > 0 ? overrides.smtpPort : preset.smtpPort;
  const secure = overrides?.smtpSecure ?? preset.smtpSecure;
  return { host, port, secure };
}
