/**
 * Workspace mail account registry (`lawmind/mail-accounts.json`) — no secrets.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  deleteMailAccountSecret,
  hasMailAccountSecret,
  upsertMailAccountSecret,
  type MailAccountSecret,
} from "./mail-secrets.js";
import { sanitizeMailSendFormat, type MailSendFormat } from "./mail-send-format.js";
import {
  getMailProviderPreset,
  type MailAuthKind,
  type MailProviderId,
} from "./provider-presets.js";
import { sanitizeWatchContacts, type MailWatchContact } from "./watch-contacts.js";

export type { MailWatchContact, MailSendFormat };

export type MailAccount = {
  id: string;
  label: string;
  provider: MailProviderId;
  email: string;
  authKind: MailAuthKind;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  /**
   * 显式例外：允许 IMAP/SMTP 非 TLS 标准端口（非 993/465/587）连接，凭证可能明文传输。
   * 缺省拒绝（对齐 MCP allowInsecureHttp 先例）。
   */
  allowInsecure?: boolean;
  /** When set, automations for this matter prefer this account. */
  matterId?: string;
  tenantId?: string;
  clientId?: string;
  /** Graph mailbox UPN (defaults to email). */
  graphMailbox?: string;
  /**
   * Counterpart addresses to track. Empty = all inbox traffic.
   * Non-empty = only sync messages involving these addresses.
   */
  watchContacts: MailWatchContact[];
  /** 发件显示名 / 结束语 / 落款。无则发信不附加格式。 */
  sendFormat?: MailSendFormat;
  enabled: boolean;
  lastSyncAt?: string;
  lastSyncError?: string;
  lastTestAt?: string;
  lastTestOk?: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Safe for API list responses. */
export type MailAccountPublic = MailAccount & {
  hasSecret: boolean;
  providerLabel: string;
};

type AccountsFile = {
  schemaVersion: 1;
  accounts: MailAccount[];
};

export function mailAccountsPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "mail-accounts.json");
}

function empty(): AccountsFile {
  return { schemaVersion: 1, accounts: [] };
}

function readFile(workspaceDir: string): AccountsFile {
  const p = mailAccountsPath(workspaceDir);
  if (!fs.existsSync(p)) {
    return empty();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as AccountsFile;
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.accounts)) {
      return empty();
    }
    return {
      schemaVersion: 1,
      accounts: raw.accounts
        .map((a) => normalizeAccount(a))
        .filter((a): a is MailAccount => a !== null),
    };
  } catch {
    return empty();
  }
}

function writeFile(workspaceDir: string, data: AccountsFile): void {
  const dir = path.dirname(mailAccountsPath(workspaceDir));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mailAccountsPath(workspaceDir), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeAccount(row: unknown): MailAccount | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const o = row as Partial<MailAccount>;
  if (
    typeof o.id !== "string" ||
    typeof o.email !== "string" ||
    typeof o.provider !== "string" ||
    typeof o.authKind !== "string" ||
    typeof o.enabled !== "boolean"
  ) {
    return null;
  }
  return {
    id: o.id,
    label: typeof o.label === "string" ? o.label : o.email,
    provider: o.provider,
    email: o.email,
    authKind: o.authKind,
    imapHost: o.imapHost,
    imapPort: o.imapPort,
    smtpHost: o.smtpHost,
    smtpPort: o.smtpPort,
    smtpSecure: o.smtpSecure,
    allowInsecure: o.allowInsecure === true ? true : undefined,
    matterId: o.matterId,
    tenantId: o.tenantId,
    clientId: o.clientId,
    graphMailbox: o.graphMailbox,
    watchContacts: sanitizeWatchContacts(o.watchContacts),
    sendFormat: sanitizeMailSendFormat(o.sendFormat),
    enabled: o.enabled,
    lastSyncAt: o.lastSyncAt,
    lastSyncError: o.lastSyncError,
    lastTestAt: o.lastTestAt,
    lastTestOk: o.lastTestOk,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : new Date(0).toISOString(),
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date(0).toISOString(),
  };
}

export function listMailAccounts(workspaceDir: string): MailAccount[] {
  return readFile(workspaceDir)
    .accounts.map((a) => normalizeAccount(a))
    .filter((a): a is MailAccount => a !== null)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getMailAccount(workspaceDir: string, id: string): MailAccount | null {
  return listMailAccounts(workspaceDir).find((a) => a.id === id) ?? null;
}

export function toPublicMailAccount(lawMindRoot: string, account: MailAccount): MailAccountPublic {
  const preset = getMailProviderPreset(account.provider);
  return {
    ...account,
    hasSecret: hasMailAccountSecret(lawMindRoot, account.id),
    providerLabel: preset.label,
  };
}

export function listPublicMailAccounts(
  workspaceDir: string,
  lawMindRoot: string,
): MailAccountPublic[] {
  return listMailAccounts(workspaceDir).map((a) => toPublicMailAccount(lawMindRoot, a));
}

export type UpsertMailAccountInput = {
  id?: string;
  label?: string;
  provider: MailProviderId;
  email: string;
  authKind?: MailAuthKind;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  /** 显式允许非 TLS 标准端口（非 993/465/587）；缺省拒绝。 */
  allowInsecure?: boolean;
  matterId?: string | null;
  tenantId?: string;
  clientId?: string;
  graphMailbox?: string;
  /** Pass `[]` to clear; omit to keep existing on update. */
  watchContacts?: MailWatchContact[];
  /** Pass `null`/`{}` to clear; omit to keep existing on update. */
  sendFormat?: MailSendFormat | null;
  enabled?: boolean;
  secret?: MailAccountSecret;
};

export function upsertMailAccount(
  workspaceDir: string,
  lawMindRoot: string,
  input: UpsertMailAccountInput,
): MailAccount {
  const preset = getMailProviderPreset(input.provider);
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("invalid_email");
  }
  const authKind = input.authKind ?? preset.defaultAuthKind;
  if (!preset.authKinds.includes(authKind)) {
    throw new Error("unsupported_auth_kind");
  }
  const now = new Date().toISOString();
  const data = readFile(workspaceDir);
  const existing = input.id ? data.accounts.find((a) => a.id === input.id) : undefined;
  const id = existing?.id ?? input.id ?? randomUUID();
  const account: MailAccount = {
    id,
    label: (input.label?.trim() || existing?.label || email).slice(0, 120),
    provider: input.provider,
    email,
    authKind,
    imapHost: input.imapHost?.trim() || existing?.imapHost || undefined,
    imapPort: input.imapPort ?? existing?.imapPort,
    smtpHost: input.smtpHost?.trim() || existing?.smtpHost || undefined,
    smtpPort: input.smtpPort ?? existing?.smtpPort,
    smtpSecure: input.smtpSecure ?? existing?.smtpSecure,
    allowInsecure: input.allowInsecure ?? existing?.allowInsecure,
    matterId:
      input.matterId === null
        ? undefined
        : input.matterId?.trim() || existing?.matterId || undefined,
    tenantId: input.tenantId?.trim() || existing?.tenantId || undefined,
    clientId: input.clientId?.trim() || existing?.clientId || undefined,
    graphMailbox: input.graphMailbox?.trim() || existing?.graphMailbox || undefined,
    watchContacts:
      input.watchContacts !== undefined
        ? sanitizeWatchContacts(input.watchContacts)
        : sanitizeWatchContacts(existing?.watchContacts),
    sendFormat:
      input.sendFormat !== undefined
        ? sanitizeMailSendFormat(input.sendFormat)
        : existing?.sendFormat,
    enabled: input.enabled ?? existing?.enabled ?? true,
    lastSyncAt: existing?.lastSyncAt,
    lastSyncError: existing?.lastSyncError,
    lastTestAt: existing?.lastTestAt,
    lastTestOk: existing?.lastTestOk,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (input.provider === "imap" && !account.imapHost) {
    throw new Error("imap_host_required");
  }
  if (authKind === "graph_client" && (!account.tenantId || !account.clientId)) {
    throw new Error("graph_tenant_client_required");
  }

  const idx = data.accounts.findIndex((a) => a.id === id);
  if (idx >= 0) {
    data.accounts[idx] = account;
  } else {
    data.accounts.push(account);
  }
  writeFile(workspaceDir, data);

  if (input.secret) {
    upsertMailAccountSecret(lawMindRoot, id, input.secret);
  }

  return account;
}

export function saveMailAccount(workspaceDir: string, account: MailAccount): void {
  const data = readFile(workspaceDir);
  const idx = data.accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) {
    data.accounts[idx] = account;
  } else {
    data.accounts.push(account);
  }
  writeFile(workspaceDir, data);
}

export function deleteMailAccount(workspaceDir: string, lawMindRoot: string, id: string): boolean {
  const data = readFile(workspaceDir);
  const next = data.accounts.filter((a) => a.id !== id);
  if (next.length === data.accounts.length) {
    return false;
  }
  writeFile(workspaceDir, { schemaVersion: 1, accounts: next });
  deleteMailAccountSecret(lawMindRoot, id);
  return true;
}

/** Prefer matter-bound account, else first enabled. */
export function resolveMailAccountForMatter(
  workspaceDir: string,
  matterId: string,
): MailAccount | null {
  const accounts = listMailAccounts(workspaceDir).filter((a) => a.enabled);
  const bound = accounts.find((a) => a.matterId === matterId);
  if (bound) {
    return bound;
  }
  return accounts[0] ?? null;
}
