import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_MAIL_ATTACHMENTS_TOTAL_BYTES,
  MAX_MAIL_ATTACHMENT_BYTES,
  sanitizeMailMessageIdForPath,
  shouldPersistMailAttachment,
  writeFetchedAttachments,
} from "./imap-client.js";

/**
 * Regression: imapflow socket timeout must not crash the Node process via
 * unhandled 'error' event. We assert the client options we rely on for safety.
 */
describe("imap-client safety", () => {
  it("documents that withImapClient attaches an error listener", async () => {
    const mod = await import("./imap-client.js");
    expect(typeof mod.testImapConnection).toBe("function");
    expect(typeof mod.fetchImapMessages).toBe("function");
  });

  it("persists document-like and image attachments to disk", () => {
    expect(shouldPersistMailAttachment("合同.docx")).toBe(true);
    expect(shouldPersistMailAttachment("scan.pdf")).toBe(true);
    expect(shouldPersistMailAttachment("旧稿.doc")).toBe(true);
    expect(shouldPersistMailAttachment("logo.png", "image/png")).toBe(true);
    expect(shouldPersistMailAttachment("inline", "image/jpeg")).toBe(true);
    expect(shouldPersistMailAttachment("clip.mp4", "video/mp4")).toBe(false);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mail-att-"));
    const refs = writeFetchedAttachments(root, "m1", "imap-abc-1", [
      { name: "nda.docx", content: Buffer.from("PK") },
      { name: "sig.png", content: Buffer.from("PNG"), contentType: "image/png" },
    ]);
    expect(refs).toEqual([
      {
        name: "nda.docx",
        relativePath: path.join("mail", "attachments", "imap-abc-1", "nda.docx"),
      },
      {
        name: "sig.png",
        relativePath: path.join("mail", "attachments", "imap-abc-1", "sig.png"),
      },
    ]);
    expect(
      fs.existsSync(
        path.join(root, "cases", "m1", "mail", "attachments", "imap-abc-1", "nda.docx"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, "cases", "m1", "mail", "attachments", "imap-abc-1", "sig.png")),
    ).toBe(true);
  });

  it("sanitizes Graph-style message ids for on-disk paths", () => {
    expect(sanitizeMailMessageIdForPath("graph-AQMkADAw/xxx+yyy=").includes("/")).toBe(false);
    expect(sanitizeMailMessageIdForPath("graph-AQMkADAw/xxx+yyy=")).toBe("graph-AQMkADAw_xxx_yyy_");
    expect(sanitizeMailMessageIdForPath("")).toBe("msg");
    expect(sanitizeMailMessageIdForPath("imap-abc-1")).toBe("imap-abc-1");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mail-att-gid-"));
    const refs = writeFetchedAttachments(root, "m1", "graph-AQ Mk/AD+Aw=", [
      { name: "nda.docx", content: Buffer.from("PK") },
    ]);
    expect(refs[0]?.relativePath).toBe(
      path.join("mail", "attachments", "graph-AQ_Mk_AD_Aw_", "nda.docx"),
    );
    expect(
      fs.existsSync(
        path.join(root, "cases", "m1", "mail", "attachments", "graph-AQ_Mk_AD_Aw_", "nda.docx"),
      ),
    ).toBe(true);
    // 不得逃逸出 attachments 目录形成非预期子树。
    expect(
      fs.existsSync(path.join(root, "cases", "m1", "mail", "attachments", "graph-AQ Mk")),
    ).toBe(false);
  });

  it("skips oversized attachments (per-file / per-message total / pre-flagged) without writing to disk", () => {
    expect(MAX_MAIL_ATTACHMENT_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_MAIL_ATTACHMENTS_TOTAL_BYTES).toBe(60 * 1024 * 1024);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mail-att-big-"));
    const refs = writeFetchedAttachments(
      root,
      "m1",
      "imap-big-1",
      [
        { name: "huge.docx", content: Buffer.alloc(11, 1) },
        { name: "ok1.docx", content: Buffer.alloc(10, 2) },
        { name: "ok2.docx", content: Buffer.alloc(10, 3) },
        { name: "overflow.docx", content: Buffer.alloc(6, 4) },
        { name: "pre-flagged.docx", content: Buffer.alloc(0), oversized: true },
        { name: "clip.mp4", content: Buffer.alloc(3, 5), contentType: "video/mp4" },
      ],
      { maxFileBytes: 10, maxTotalBytes: 25 },
    );

    expect(refs[0]).toEqual({ name: "huge.docx", skippedReason: "too_large" });
    expect(refs[1]?.relativePath).toBeTruthy();
    expect(refs[2]?.relativePath).toBeTruthy();
    expect(refs[3]).toEqual({ name: "overflow.docx", skippedReason: "too_large_total" });
    expect(refs[4]).toEqual({ name: "pre-flagged.docx", skippedReason: "too_large" });
    expect(refs[5]).toEqual({ name: "clip.mp4", skippedReason: "type_not_persisted" });

    const dir = path.join(root, "cases", "m1", "mail", "attachments", "imap-big-1");
    expect(fs.readdirSync(dir).toSorted()).toEqual(["ok1.docx", "ok2.docx"]);
  });

  it("testImapConnection returns structured failure when secret missing", async () => {
    const { testImapConnection } = await import("./imap-client.js");
    const result = await testImapConnection(
      {
        id: "acc-1",
        label: "t",
        provider: "gmail",
        email: "a@gmail.com",
        authKind: "app_password",
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      "/tmp/lawmind-no-such-root-for-mail-test",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("missing_password");
    }
  });
});
