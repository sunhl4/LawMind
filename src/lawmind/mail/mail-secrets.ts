/**
 * Mail credentials live next to `.env.lawmind` (LawMind root), never in workspace git tree.
 *
 * schemaVersion 2：AES-256-GCM 加密落盘（0600）。密钥分层——Electron 主进程经
 * keyVault（safeStorage）保管并以 `LAWMIND_MAIL_SECRETS_KEY` 注入子进程；
 * headless（CLI / 测试 / lawmindd）降级为工作区外 0600 key 文件
 * （`~/.lawmind/keys/mail-secrets.key`，首次自动生成）。
 * 既有 v1 明文文件读取时自动迁移为加密存储（临时文件 + rename 原子替换，
 * 明文不再滞留该路径；闪存块级擦除不可移植，见 SECURITY 报告残余说明）。
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseHexKey, resolveKeyFileKey } from "../platform/local-key-store.js";

export const MAIL_SECRETS_KEY_ENV = "LAWMIND_MAIL_SECRETS_KEY";
const MAIL_SECRETS_KEY_NAME = "mail-secrets";

export type MailAccountSecret = {
  /** IMAP/SMTP password or app-specific password. */
  password?: string;
  /** Azure AD client secret for Graph. */
  clientSecret?: string;
};

/** 明文载荷结构（v1 文件即此结构的明文 JSON；v2 为其加密信封）。 */
type SecretsData = {
  schemaVersion: 1;
  secrets: Record<string, MailAccountSecret>;
};

type SecretsFileV2 = {
  schemaVersion: 2;
  cipher: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
};

function secretsPath(lawMindRoot: string): string {
  return path.join(path.resolve(lawMindRoot), "mail-secrets.json");
}

function empty(): SecretsData {
  return { schemaVersion: 1, secrets: {} };
}

/** 加密首选密钥（env 优先）；读取解密时尝试全部本机密钥（env + key 文件并存场景）。 */
function resolveMailSecretsKeys(create: boolean): Buffer[] {
  const out: Buffer[] = [];
  const envKey = parseHexKey(process.env[MAIL_SECRETS_KEY_ENV]);
  if (envKey) {
    out.push(envKey);
  }
  const fileKey = resolveKeyFileKey({ name: MAIL_SECRETS_KEY_NAME, create });
  if (fileKey && !out.some((k) => k.equals(fileKey))) {
    out.push(fileKey);
  }
  return out;
}

function encryptData(key: Buffer, data: SecretsData): SecretsFileV2 {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return {
    schemaVersion: 2,
    cipher: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: payload.toString("base64"),
  };
}

function decryptData(key: Buffer, file: SecretsFileV2): SecretsData | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.iv, "base64"));
    decipher.setAuthTag(Buffer.from(file.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(file.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const raw = JSON.parse(plain) as SecretsData;
    if (raw.schemaVersion !== 1 || !raw.secrets || typeof raw.secrets !== "object") {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

type LoadResult =
  | { status: "ok"; data: SecretsData; legacyPlaintext: boolean }
  | { status: "missing" }
  | { status: "undecryptable" };

function loadSecrets(lawMindRoot: string): LoadResult {
  const p = secretsPath(lawMindRoot);
  if (!fs.existsSync(p)) {
    return { status: "missing" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
  } catch {
    return { status: "missing" };
  }
  if (!raw || typeof raw !== "object") {
    return { status: "missing" };
  }
  const row = raw as {
    schemaVersion?: unknown;
    cipher?: unknown;
    data?: unknown;
    secrets?: unknown;
  };
  if (row.schemaVersion === 2 && row.cipher === "aes-256-gcm" && typeof row.data === "string") {
    const file = raw as unknown as SecretsFileV2;
    for (const key of resolveMailSecretsKeys(true)) {
      const data = decryptData(key, file);
      if (data) {
        return { status: "ok", data, legacyPlaintext: false };
      }
    }
    // 密钥缺失/不匹配：按无凭证处理但拒绝覆盖（writeFile 侧防误毁）。
    console.warn("[LawMind] mail-secrets.json 无法解密（密钥缺失或不匹配）；不会覆盖原文件。");
    return { status: "undecryptable" };
  }
  if (row.schemaVersion === 1 && row.secrets && typeof row.secrets === "object") {
    return {
      status: "ok",
      data: { schemaVersion: 1, secrets: row.secrets as Record<string, MailAccountSecret> },
      legacyPlaintext: true,
    };
  }
  return { status: "missing" };
}

function readFile(lawMindRoot: string): SecretsData {
  const loaded = loadSecrets(lawMindRoot);
  if (loaded.status !== "ok") {
    return empty();
  }
  if (loaded.legacyPlaintext) {
    // v1 明文 → 读取即迁移为加密存储；迁移失败不阻断读取（下次再试）。
    try {
      writeFile(lawMindRoot, loaded.data);
    } catch (err) {
      console.warn(
        "[LawMind] mail-secrets 明文迁移加密失败:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return loaded.data;
}

function writeFile(lawMindRoot: string, data: SecretsData): void {
  const key = resolveMailSecretsKeys(true)[0];
  if (!key) {
    throw new Error("mail_secrets_key_unavailable");
  }
  // 防误毁：磁盘上存在但任何本机密钥都解不开的密文，拒绝覆盖。
  if (loadSecrets(lawMindRoot).status === "undecryptable") {
    throw new Error("mail_secrets_undecryptable");
  }
  const root = path.resolve(lawMindRoot);
  fs.mkdirSync(root, { recursive: true });
  const p = secretsPath(root);
  const tmp = `${p}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, `${JSON.stringify(encryptData(key, data), null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    /* best-effort on Windows */
  }
  fs.renameSync(tmp, p);
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
