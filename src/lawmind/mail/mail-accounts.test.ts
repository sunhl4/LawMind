import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listMatterMailMessages } from "../platform/lawyer-automations.js";
import {
  deleteMailAccount,
  listPublicMailAccounts,
  resolveMailAccountForMatter,
  upsertMailAccount,
} from "./mail-accounts.js";
import { getMailAccountSecret } from "./mail-secrets.js";
import { getMailProviderPreset } from "./provider-presets.js";
import { persistFetchedMessages } from "./sync-inbox.js";

const tmpDirs: string[] = [];

function mkRoots(): { workspaceDir: string; lawMindRoot: string } {
  const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mail-"));
  tmpDirs.push(lawMindRoot);
  const workspaceDir = path.join(lawMindRoot, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
  return { workspaceDir, lawMindRoot };
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("mail accounts", () => {
  it("stores public config in workspace and secret outside workspace", () => {
    const { workspaceDir, lawMindRoot } = mkRoots();
    const account = upsertMailAccount(workspaceDir, lawMindRoot, {
      provider: "gmail",
      email: "Lawyer@Gmail.com",
      label: "工作邮箱",
      matterId: "matter-demo",
      watchContacts: [{ email: "Opp@Corp.com", label: "对方法务", note: "合同谈判" }],
      secret: { password: "app-pass-123" },
    });
    expect(account.email).toBe("lawyer@gmail.com");
    expect(account.provider).toBe("gmail");
    expect(account.watchContacts).toEqual([
      { email: "opp@corp.com", label: "对方法务", note: "合同谈判" },
    ]);
    const pub = listPublicMailAccounts(workspaceDir, lawMindRoot);
    expect(pub).toHaveLength(1);
    expect(pub[0]?.hasSecret).toBe(true);
    expect(JSON.stringify(pub[0])).not.toContain("app-pass-123");
    const secretFile = path.join(lawMindRoot, "mail-secrets.json");
    expect(fs.existsSync(secretFile)).toBe(true);
    expect(getMailAccountSecret(lawMindRoot, account.id)?.password).toBe("app-pass-123");
    expect(fs.existsSync(path.join(workspaceDir, "lawmind", "mail-accounts.json"))).toBe(true);
    expect(
      fs.readFileSync(path.join(workspaceDir, "lawmind", "mail-accounts.json"), "utf8"),
    ).not.toContain("app-pass");
  });

  it("resolves matter-bound account first", () => {
    const { workspaceDir, lawMindRoot } = mkRoots();
    upsertMailAccount(workspaceDir, lawMindRoot, {
      provider: "qq",
      email: "a@qq.com",
      secret: { password: "x" },
    });
    const bound = upsertMailAccount(workspaceDir, lawMindRoot, {
      provider: "163",
      email: "b@163.com",
      matterId: "case-1",
      secret: { password: "y" },
    });
    expect(resolveMailAccountForMatter(workspaceDir, "case-1")?.id).toBe(bound.id);
  });

  it("deletes secrets with account", () => {
    const { workspaceDir, lawMindRoot } = mkRoots();
    const account = upsertMailAccount(workspaceDir, lawMindRoot, {
      provider: "imap",
      email: "me@corp.com",
      imapHost: "imap.corp.com",
      smtpHost: "smtp.corp.com",
      secret: { password: "z" },
    });
    expect(deleteMailAccount(workspaceDir, lawMindRoot, account.id)).toBe(true);
    expect(getMailAccountSecret(lawMindRoot, account.id)).toBeNull();
  });

  it("persists fetched messages into matter inbox", () => {
    const { workspaceDir } = mkRoots();
    const matterId = "matter-x";
    const n = persistFetchedMessages(workspaceDir, matterId, [
      {
        id: "msg1",
        from: "a@b.com",
        to: "me@c.com",
        subject: "合同",
        receivedAt: "2026-07-01T00:00:00.000Z",
        bodyText: "请查收",
        attachments: [
          { name: "nda.docx", content: Buffer.from("PK") },
          { name: "banner.jpg", content: Buffer.from("JFIF"), contentType: "image/jpeg" },
        ],
      },
    ]);
    expect(n).toBe(1);
    const listed = listMatterMailMessages(workspaceDir, matterId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.attachments.map((a) => a.name)).toEqual(["nda.docx", "banner.jpg"]);
    expect(listed[0]?.attachments[0]?.relativePath).toContain("nda.docx");
    // 图片附件（合同扫描件/照片页）按 OCR 路径持久化。
    expect(listed[0]?.attachments[1]?.relativePath).toContain("banner.jpg");
    expect(
      fs.existsSync(
        path.join(workspaceDir, "cases", matterId, "mail", "attachments", "msg1", "nda.docx"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceDir, "cases", matterId, "mail", "attachments", "msg1", "banner.jpg"),
      ),
    ).toBe(true);
  });

  it("persists and can clear sendFormat", () => {
    const { workspaceDir, lawMindRoot } = mkRoots();
    const created = upsertMailAccount(workspaceDir, lawMindRoot, {
      provider: "qq",
      email: "me@qq.com",
      sendFormat: {
        fromName: "张三律师",
        closingStyle: "formal",
        signature: "某某律师事务所\n张三 律师",
      },
      secret: { password: "x" },
    });
    expect(created.sendFormat).toEqual({
      fromName: "张三律师",
      closingStyle: "formal",
      signature: "某某律师事务所\n张三 律师",
    });
    const cleared = upsertMailAccount(workspaceDir, lawMindRoot, {
      id: created.id,
      provider: "qq",
      email: "me@qq.com",
      sendFormat: {},
    });
    expect(cleared.sendFormat).toBeUndefined();
  });

  it("exposes provider presets for UI", () => {
    expect(getMailProviderPreset("gmail").imapHost).toBe("imap.gmail.com");
    expect(getMailProviderPreset("microsoft365").authKinds).toContain("graph_client");
  });
});
