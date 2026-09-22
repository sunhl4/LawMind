import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetLocalKeyStoreCacheForTests } from "../platform/local-key-store.js";
import {
  deleteMailAccountSecret,
  getMailAccountSecret,
  hasMailAccountSecret,
  MAIL_SECRETS_KEY_ENV,
  upsertMailAccountSecret,
} from "./mail-secrets.js";

const tmpDirs: string[] = [];

function mkRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mail-secrets-"));
  tmpDirs.push(dir);
  return dir;
}

function secretsFileRaw(lawMindRoot: string): string {
  return fs.readFileSync(path.join(lawMindRoot, "mail-secrets.json"), "utf8");
}

afterEach(() => {
  delete process.env[MAIL_SECRETS_KEY_ENV];
  resetLocalKeyStoreCacheForTests();
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("mail-secrets encrypted storage", () => {
  it("encrypts at rest: round trip works and file contains no plaintext", () => {
    const root = mkRoot();
    upsertMailAccountSecret(root, "acc-1", {
      password: "imap-app-pass-xyz",
      clientSecret: "azure-client-secret-123",
    });
    const raw = secretsFileRaw(root);
    const parsed = JSON.parse(raw) as { schemaVersion: number; cipher?: string };
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.cipher).toBe("aes-256-gcm");
    expect(raw).not.toContain("imap-app-pass-xyz");
    expect(raw).not.toContain("azure-client-secret-123");
    if (process.platform !== "win32") {
      expect(fs.statSync(path.join(root, "mail-secrets.json")).mode & 0o777).toBe(0o600);
    }

    const got = getMailAccountSecret(root, "acc-1");
    expect(got?.password).toBe("imap-app-pass-xyz");
    expect(got?.clientSecret).toBe("azure-client-secret-123");
    expect(hasMailAccountSecret(root, "acc-1")).toBe(true);

    deleteMailAccountSecret(root, "acc-1");
    expect(getMailAccountSecret(root, "acc-1")).toBeNull();
  });

  it("migrates legacy plaintext v1 file to encrypted storage on read", () => {
    const root = mkRoot();
    const legacy = {
      schemaVersion: 1,
      secrets: { "acc-legacy": { password: "plain-pass-456" } },
    };
    fs.writeFileSync(path.join(root, "mail-secrets.json"), `${JSON.stringify(legacy, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });

    // 读取即迁移：值仍可读，磁盘上明文消失。
    expect(getMailAccountSecret(root, "acc-legacy")?.password).toBe("plain-pass-456");
    const raw = secretsFileRaw(root);
    expect(raw).not.toContain("plain-pass-456");
    expect((JSON.parse(raw) as { schemaVersion: number }).schemaVersion).toBe(2);
    // 迁移后再次读取（走解密路径）值不变。
    expect(getMailAccountSecret(root, "acc-legacy")?.password).toBe("plain-pass-456");
  });

  it("uses LAWMIND_MAIL_SECRETS_KEY env key when present (Electron-injected)", () => {
    const root = mkRoot();
    process.env[MAIL_SECRETS_KEY_ENV] = "ab".repeat(32);
    upsertMailAccountSecret(root, "acc-env", { password: "env-key-pass" });
    expect(getMailAccountSecret(root, "acc-env")?.password).toBe("env-key-pass");
  });

  it("refuses to clobber an undecryptable file (wrong key) instead of destroying secrets", () => {
    const root = mkRoot();
    process.env[MAIL_SECRETS_KEY_ENV] = "ab".repeat(32);
    upsertMailAccountSecret(root, "acc-1", { password: "precious" });

    // 换一把密钥（且 key 文件目录指向空目录）：解不开 → 读为空、写拒绝。
    process.env[MAIL_SECRETS_KEY_ENV] = "cd".repeat(32);
    const emptyKeyDir = mkRoot();
    const prevKeyDir = process.env.LAWMIND_KEY_DIR;
    process.env.LAWMIND_KEY_DIR = emptyKeyDir;
    resetLocalKeyStoreCacheForTests();
    try {
      expect(getMailAccountSecret(root, "acc-1")).toBeNull();
      expect(() => upsertMailAccountSecret(root, "acc-2", { password: "x" })).toThrow(
        /mail_secrets_undecryptable/,
      );
      // 原密文仍在，未被覆盖。
      expect(secretsFileRaw(root)).toContain("aes-256-gcm");
    } finally {
      if (prevKeyDir === undefined) {
        delete process.env.LAWMIND_KEY_DIR;
      } else {
        process.env.LAWMIND_KEY_DIR = prevKeyDir;
      }
    }
  });
});
