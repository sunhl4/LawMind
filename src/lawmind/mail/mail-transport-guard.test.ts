import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testImapConnection } from "./imap-client.js";
import type { MailAccount } from "./mail-accounts.js";
import { upsertMailAccountSecret } from "./mail-secrets.js";
import {
  checkImapPortAllowed,
  checkSmtpPortAllowed,
  SECURE_IMAP_PORTS,
  SECURE_SMTP_PORTS,
} from "./mail-transport-guard.js";
import { sendSmtpMail } from "./smtp-client.js";

const tmpDirs: string[] = [];

function mkRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mail-guard-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function accountWith(patch: Partial<MailAccount>): MailAccount {
  return {
    id: "acc-guard",
    label: "t",
    provider: "imap",
    email: "me@corp.example",
    authKind: "password",
    watchContacts: [],
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...patch,
  };
}

describe("mail transport port guard", () => {
  it("allows standard TLS ports by default", () => {
    expect(SECURE_IMAP_PORTS.has(993)).toBe(true);
    expect(SECURE_SMTP_PORTS.has(465)).toBe(true);
    expect(SECURE_SMTP_PORTS.has(587)).toBe(true);
    expect(checkImapPortAllowed(993).ok).toBe(true);
    expect(checkSmtpPortAllowed(465).ok).toBe(true);
    expect(checkSmtpPortAllowed(587).ok).toBe(true);
  });

  it("rejects non-TLS ports by default, allows with explicit allowInsecure", () => {
    const imap = checkImapPortAllowed(143);
    expect(imap.ok).toBe(false);
    if (!imap.ok) {
      expect(imap.error).toBe("insecure_imap_port");
      expect(imap.hint).toMatch(/allowInsecure/);
    }
    expect(checkImapPortAllowed(143, true).ok).toBe(true);

    const smtp = checkSmtpPortAllowed(25);
    expect(smtp.ok).toBe(false);
    if (!smtp.ok) {
      expect(smtp.error).toBe("insecure_smtp_port");
    }
    expect(checkSmtpPortAllowed(25, true).ok).toBe(true);
  });

  it("testImapConnection refuses non-993 port before any network I/O", async () => {
    const root = mkRoot();
    upsertMailAccountSecret(root, "acc-guard", { password: "x" });
    const result = await testImapConnection(
      accountWith({ imapHost: "imap.corp.example", imapPort: 143 }),
      root,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("insecure_imap_port");
    }
  });

  it("testImapConnection with allowInsecure proceeds past the guard", async () => {
    const root = mkRoot();
    upsertMailAccountSecret(root, "acc-guard", { password: "x" });
    // 127.0.0.1 关闭端口：快速 ECONNREFUSED，证明已越过端口门禁进入连接阶段。
    const result = await testImapConnection(
      accountWith({ imapHost: "127.0.0.1", imapPort: 9143, allowInsecure: true }),
      root,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("imap_connect_failed");
    }
  });

  it("sendSmtpMail refuses non-465/587 port before any network I/O", async () => {
    const root = mkRoot();
    upsertMailAccountSecret(root, "acc-guard", { password: "x" });
    const result = await sendSmtpMail(
      accountWith({ smtpHost: "smtp.corp.example", smtpPort: 25, smtpSecure: false }),
      root,
      { to: "a@b.example", subject: "s", body: "b" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("insecure_smtp_port");
      expect(result.hint).toMatch(/allowInsecure/);
    }
  });

  it("sendSmtpMail with allowInsecure proceeds past the guard", async () => {
    const root = mkRoot();
    upsertMailAccountSecret(root, "acc-guard", { password: "x" });
    const result = await sendSmtpMail(
      accountWith({
        smtpHost: "127.0.0.1",
        smtpPort: 9125,
        smtpSecure: false,
        allowInsecure: true,
      }),
      root,
      { to: "a@b.example", subject: "s", body: "b" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("smtp_send_failed");
    }
  });
});
