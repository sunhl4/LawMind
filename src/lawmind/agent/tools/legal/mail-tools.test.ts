import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMatterIfMissing } from "../../../application/services/matter-write-service.js";
import { saveDeliveryPacket } from "../../../delivery/packet-store.js";
import { createDeliveryPacket } from "../../../delivery/packet.js";
import { createAdmission } from "../../../intake/admission.js";
import { upsertMailAccount } from "../../../mail/mail-accounts.js";
import {
  listOpenAutomationInbox,
  writeMatterMailMessage,
} from "../../../platform/lawyer-automations.js";
import type { AgentContext } from "../../types.js";
import {
  listMailAttachments,
  listMailInbox,
  prepareOutboundMail,
  sendEmail,
} from "./mail-tools.js";

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

describe("mail tool copy", () => {
  it("uses 签批发送 in lawyer-facing outbound copy", () => {
    const blob = [listMailInbox, listMailAttachments, sendEmail, prepareOutboundMail]
      .map((tool) => JSON.stringify(tool.definition))
      .join("\n");
    expect(blob).not.toContain("批准发送");
    expect(blob).toContain("签批发送");
  });
});

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
    createMatterIfMissing(ws, { matterId, title: "签名测试", status: "active" });
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
    createMatterIfMissing(ws, { matterId, title: "特权测试", status: "active" });
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

  it("binds prepare_outbound_mail to a delivery packet and rejects packet-external attachments", async () => {
    const ws = tmpWorkspace();
    const matterId = "m_packet_send";
    createMatterIfMissing(ws, { matterId, title: "交付包外发", status: "active" });
    const a = path.join("matters", matterId, "deliverables", "a.md");
    const b = path.join("matters", matterId, "deliverables", "b.md");
    fs.mkdirSync(path.join(ws, "matters", matterId, "deliverables"), { recursive: true });
    fs.writeFileSync(path.join(ws, a), "意见");
    fs.writeFileSync(path.join(ws, b), "附件");
    fs.mkdirSync(path.join(ws, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(ws, "artifacts", "extra.docx"), "包外");
    const packet = createDeliveryPacket({
      matterId,
      packetId: "pkt_mail",
      title: "客户交付包",
      audience: "client",
      sections: [
        {
          sectionId: "s1",
          kind: "opinion",
          title: "意见",
          documents: [
            { docId: "a", path: a, required: true },
            { docId: "b", path: b },
          ],
        },
      ],
    });
    saveDeliveryPacket(ws, packet);

    const prepared = await prepareOutboundMail.execute(
      {
        matter_id: matterId,
        to: "client@x.com",
        subject: "交付包",
        body: "请查收整包。",
        packet_id: packet.packetId,
        attachment_paths: [a],
      },
      makeCtx(ws, matterId),
    );
    expect(prepared.ok).toBe(true);
    const inbox = listOpenAutomationInbox(ws);
    expect(inbox).toHaveLength(1);
    // 显式只给 a，但整包外发按包内顺序补齐 a + b
    expect(inbox[0]?.pendingSend?.attachmentRelativePaths).toEqual([a, b]);
    expect(inbox[0]?.pendingSend?.binding?.packet).toEqual({
      packetId: packet.packetId,
      packetHash: expect.stringMatching(/^[a-f0-9]{32}$/),
    });
    expect(inbox[0]?.summary).toContain("交付包");

    const outside = await prepareOutboundMail.execute(
      {
        matter_id: matterId,
        to: "client@x.com",
        subject: "夹带",
        body: "夹带包外文件。",
        packet_id: packet.packetId,
        attachment_paths: ["artifacts/extra.docx"],
      },
      makeCtx(ws, matterId),
    );
    expect(outside.ok).toBe(false);
    expect(outside.error).toContain("不在交付包");
  });

  it("blocks outbound tools for an intake matter whose admission is not accepted", async () => {
    const ws = tmpWorkspace();
    const matterId = "m_admission_hold";
    createMatterIfMissing(ws, { matterId, title: "待收案", status: "intake" });
    createAdmission(ws, { matterId, ownerLawyerId: "lawyer:desktop" });

    const prepared = await prepareOutboundMail.execute(
      {
        matter_id: matterId,
        to: "client@x.com",
        subject: "修订稿",
        body: "请查收。",
      },
      makeCtx(ws, matterId),
    );
    expect(prepared.ok).toBe(false);
    expect(prepared.data).toMatchObject({ admissionGate: "prospective" });
    expect(listOpenAutomationInbox(ws)).toHaveLength(0);

    const sent = await sendEmail.execute(
      {
        matter_id: matterId,
        to: "client@x.com",
        subject: "修订稿",
        body: "请查收。",
      },
      makeCtx(ws, matterId),
    );
    expect(sent.ok).toBe(false);
    expect(sent.data).toMatchObject({ admissionGate: "prospective" });
  });
});
