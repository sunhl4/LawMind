/**
 * Mail credentials live next to `.env.lawmind` (LawMind root), never in workspace git tree.
 */

import fs from "node:fs";
import path from "node:path";

export type MailAccountSecret = {
  /** IMAP/SMTP password or app-specific password. */
  password?: string;
  /** Azure AD client secret for Graph. */
  clientSecret?: string;
};

type SecretsFile = {
  schemaVersion: 1;
  secrets: Record<string, MailAccountSecret>;
};

function secretsPath(lawMindRoot: string): string {
  return path.join(path.resolve(lawMindRoot), "mail-secrets.json");
}

function empty(): SecretsFile {
  return { schemaVersion: 1, secrets: {} };
}

function readFile(lawMindRoot: string): SecretsFile {
  const p = secretsPath(lawMindRoot);
  if (!fs.existsSync(p)) {
    return empty();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as SecretsFile;
    if (raw.schemaVersion !== 1 || !raw.secrets || typeof raw.secrets !== "object") {
      return empty();
    }
    return raw;
  } catch {
    return empty();
  }
}

function writeFile(lawMindRoot: string, data: SecretsFile): void {
  const root = path.resolve(lawMindRoot);
  fs.mkdirSync(root, { recursive: true });
  const p = secretsPath(root);
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* best-effort on Windows */
  }
}

export function getMailAccountSecret(
  lawMindRoot: string,
  accountId: string,
): MailAccountSecret | null {
  const row = readFile(lawMindRoot).secrets[accountId];
  if (!row) {
    return null;
  }
  return {
    password: row.password?.trim() || undefined,
    clientSecret: row.clientSecret?.trim() || undefined,
  };
}

export function upsertMailAccountSecret(
  lawMindRoot: string,
  accountId: string,
  patch: MailAccountSecret,
): void {
  const data = readFile(lawMindRoot);
  const prev = data.secrets[accountId] ?? {};
  const next: MailAccountSecret = { ...prev };
  if (patch.password !== undefined) {
    next.password = patch.password.trim() || undefined;
  }
  if (patch.clientSecret !== undefined) {
    next.clientSecret = patch.clientSecret.trim() || undefined;
  }
  if (!next.password && !next.clientSecret) {
    delete data.secrets[accountId];
  } else {
    data.secrets[accountId] = next;
  }
  writeFile(lawMindRoot, data);
}

export function deleteMailAccountSecret(lawMindRoot: string, accountId: string): void {
  const data = readFile(lawMindRoot);
  if (!(accountId in data.secrets)) {
    return;
  }
  delete data.secrets[accountId];
  writeFile(lawMindRoot, data);
}

export function hasMailAccountSecret(lawMindRoot: string, accountId: string): boolean {
  const s = getMailAccountSecret(lawMindRoot, accountId);
  return Boolean(s?.password || s?.clientSecret);
}
