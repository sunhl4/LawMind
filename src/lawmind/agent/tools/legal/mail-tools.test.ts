import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upsertMailAccount } from "../../../mail/mail-accounts.js";
import {
  listOpenAutomationInbox,
  writeMatterMailMessage,
} from "../../../platform/lawyer-automations.js";
import type { AgentContext } from "../../types.js";
import { listMailAttachments, listMailInbox, prepareOutboundMail } from "./mail-tools.js";

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mail-tools-"));
}

function makeCtx(ws: string, matterId?: string): AgentContext {
  return {
    workspaceDir: ws,
    sessionId: "s1",
    actorId: "lawyer",
    matterId,
  };
}

describe("mail list tools", () => {
  it("list_mail_inbox and list_mail_attachments return local messages", async () => {
    const ws = tmpWorkspace();
    const matterId = "m_mail_1";
    writeMatterMailMessage(ws, matterId, {
      id: "msg1",
      from: "对方 <a@b.com>",
      to: "me@firm.com",
      subject: "合同请审",
      receivedAt: "2026-08-01T10:00:00.000Z",
      bodyText: "附件为合同",
      attachments: [{ name: "c.docx", relativePath: "mail/attachments/msg1/c.docx" }],
    });
    const inbox = await listMailInbox.execute({ limit: 10 }, makeCtx(ws, matterId));
    expect(inbox.ok).toBe(true);
    expect((inbox.data as { count: number }).count).toBe(1);

    const atts = await listMailAttachments.execute({}, makeCtx(ws, matterId));
    expect(atts.ok).toBe(true);
    const rows = (atts.data as { attachments: Array<{ workspaceRelativePath: string }> })
      .attachments;
    expect(rows[0]?.workspaceRelativePath).toBe("cases/m_mail_1/mail/attachments/msg1/c.docx");
  });

  it("prepare_outbound_mail appends account 落款", async () => {
    const ws = tmpWorkspace();
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mail-root-"));
    const matterId = "m_mail_sig";
    upsertMailAccount(ws, lawMindRoot, {
      provider: "qq",
      email: "me@qq.com",
      matterId,
      sendFormat: {
        closingStyle: "formal",
        signature: "某某律师事务所\n张三 律师",
      },
      secret: { password: "x" },
    });
    const result = await prepareOutboundMail.execute(
      {
        matter_id: matterId,
        to: "client@x.com",
        subject: "修订稿",
        body: "请查收附件。",
      },
      makeCtx(ws, matterId),
    );
    expect(result.ok).toBe(true);
    const inbox = listOpenAutomationInbox(ws);
    expect(inbox[0]?.pendingSend?.body).toContain("此致");
    expect(inbox[0]?.pendingSend?.body).toContain("某某律师事务所");
  });

  it("stamps opposing-counsel and privileged attachment names on the 待拍板 item", async () => {
    const ws = tmpWorkspace();
    const matterId = "m_mail_priv";
    const rel = path.join("artifacts", "内部策略-底线.docx");
    fs.mkdirSync(path.join(ws, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "x");
    const result = await prepareOutboundMail.execute(
      {
        matter_id: matterId,
        to: "opposing@x.com",
        subject: "回复对方律师",
        body: "致对方律师：请查收。",
        attachment_paths: [rel],
      },
      makeCtx(ws, matterId),
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      audience?: string;
      attachmentPrivilegeFlags?: string[];
      message?: string;
    };
    expect(data.audience).toBe("opposing");
    expect(data.attachmentPrivilegeFlags?.length).toBeGreaterThan(0);
    expect(data.message).toMatch(/对方|附件/);
  });
});
